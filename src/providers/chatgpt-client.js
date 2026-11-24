const API_BASE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";

async function readErrorPayload(response) {
  if (typeof response.text !== "function") return typeof response.json === "function" ? await response.json().catch(() => ({})) : {};
  const raw = await response.text().catch(() => "");
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return { detail: raw.slice(0, 1000) }; }
}
function apiFailure(label, response, payload) {
  const error = payload?.error;
  const code = typeof error === "object" ? error?.code : (payload?.code || error);
  const detail = (typeof error === "object" ? error?.message : null) || payload?.detail || payload?.message || (typeof error === "string" ? error : "");
  const requestId = response.headers?.get?.("x-request-id");
  const retryAfter = response.headers?.get?.("retry-after");
  const metadata = [code ? "code=" + code : null, requestId ? "request_id=" + requestId : null, retryAfter ? "retry_after=" + retryAfter : null].filter(Boolean).join(", ");
  const hints = {
    subscription_sharing_user_not_eligible: "This ChatGPT account or workspace is not eligible for plan usage. Choose an eligible account; do not retry the same request.",
    subscription_sharing_usage_limit_exceeded: "Pause requests using this ChatGPT plan and review ChatGPT Settings → Usage. Do not assume a reset time.",
    subscription_sharing_usage_unavailable: "Plan usage availability is temporarily unavailable. Preserve credentials and retry later with bounded backoff.",
    subscription_sharing_unsupported_capability: "The request uses an unsupported capability. Review the error parameter and remove that feature before retrying.",
    subscription_sharing_route_not_supported: "This request route is not supported for ChatGPT plan usage. Use POST /v1/responses.",
    subscription_sharing_invalid_user: "The subscriber context could not be validated. Check the selected account and reconnect only if revocation or terminal refresh failure is confirmed."
  };
  const hint = hints[code] || (response.status === 503 ? "Temporary service or routing failure; preserve credentials and retry later with bounded backoff." : "");
  return label + " (HTTP " + response.status + (metadata ? "; " + metadata : "") + ")." + (detail ? " " + String(detail).slice(0, 1000) : "") + (hint ? " " + hint : "");
}

export class ChatGPTClient {
  constructor({ accountStore, fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
    if (!accountStore || typeof fetchImpl !== "function") throw new Error("ChatGPTClient requires an account store and fetch.");
    this.accountStore = accountStore;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.controllers = new Set();
    this.accountEpoch = 0;
    this.models = [];
    this.modelsForAccountId = null;
    this.refreshes = new Map();
  }
  cancelActiveRequests() {
    this.accountEpoch++;
    for (const controller of this.controllers) controller.abort(new Error("ChatGPT account changed."));
    this.controllers.clear();
    this.models = [];
    this.modelsForAccountId = null;
  }
  async #tokens(account) {
    if (!account) throw new Error("Sign in with ChatGPT and select an account first.");
    if (!account.scopes.includes(PLAN_SCOPE)) throw new Error("This ChatGPT account has identity sign-in only; ChatGPT plan usage permission was not granted.");
    if (account.needsReauth) throw new Error("This ChatGPT account needs to be reconnected. Choose Reconnect in the account list.");
    if (Date.parse(account.expiresAt) <= Date.now() + 60000) {
      if (!account.tokens.refreshToken) throw new Error("ChatGPT session expired. Sign in again to reconnect this account.");
      if (this.refreshes.has(account.id)) return this.refreshes.get(account.id);
      const refreshPromise = (async () => {
        const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.tokens.refreshToken, client_id: account.clientId, resource: API_BASE });
        const response = await this.fetchImpl("https://auth.openai.com/api/accounts/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
        const refreshed = response.ok ? await response.json().catch(() => ({})) : await readErrorPayload(response);
        if (!response.ok || !refreshed.access_token) {
          const rawError = refreshed.error;
          const code = (typeof rawError === "object" ? rawError?.code : rawError) || refreshed.code;
          if (["invalid_grant","invalid_refresh_token","token_expired","refresh_token_expired","refresh_token_invalidated","refresh_token_reused"].includes(code)) await this.accountStore.clearCredentials(account.id);
          throw new Error(apiFailure("ChatGPT session refresh failed", response, refreshed) + (code ? "" : " Reconnect the account if the session has expired."));
        }
        if (!refreshed.refresh_token || !Number.isFinite(Number(refreshed.expires_in))) throw new Error("ChatGPT refresh response did not include a replacement refresh token and expiry.");
        const refreshedScopes = String(refreshed.scope || "").trim().split(/\s+/).filter(Boolean);
        await this.accountStore.updateTokens(account.id, refreshed, refreshedScopes);
        if (refreshedScopes.length && !refreshedScopes.includes(PLAN_SCOPE)) {
          throw new Error("The refreshed ChatGPT session no longer grants plan-usage permission. Reconnect and explicitly enable ChatGPT plan usage before continuing.");
        }
        return refreshed.access_token;
      })();
      this.refreshes.set(account.id, refreshPromise);
      try { return await refreshPromise; }
      finally { if (this.refreshes.get(account.id) === refreshPromise) this.refreshes.delete(account.id); }
    }
    return account.tokens.accessToken;
  }
  async listModels() {
    const epoch = this.accountEpoch;
    const account = await this.accountStore.getActiveAccount();
    if (!account) throw new Error("No active ChatGPT account.");
    const token = await this.#tokens(account);
    if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed before model discovery completed.");
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("ChatGPT model discovery timed out.")), this.timeoutMs);
    try {
      const response = await this.fetchImpl(API_BASE + "/models", { signal: controller.signal, headers: { authorization: "Bearer " + token, accept: "application/json" } });
      const payload = response.ok ? await response.json().catch(() => ({})) : await readErrorPayload(response);
      if (!response.ok) throw new Error(apiFailure("ChatGPT model catalog request failed", response, payload));
      if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed while refreshing the model list.");
      const rows = Array.isArray(payload.models) ? payload.models : [];
      const models = rows.filter(item => item && item.visibility === "list" && typeof item.slug === "string" && typeof item.display_name === "string").map(item => ({ id: item.slug, name: item.display_name }));
      this.models = models;
      this.modelsForAccountId = account.id;
      return models;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async generate({ prompt, model, systemInstruction = "" }) {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000) throw new Error("Prompt must be 1-100000 characters.");
    const epoch = this.accountEpoch;
    const account = await this.accountStore.getActiveAccount();
    if (!account) throw new Error("No active ChatGPT account.");
    if (this.modelsForAccountId !== account.id) await this.listModels();
    if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed before the request started.");
    const currentAccount = await this.accountStore.getActiveAccount();
    if (!currentAccount || currentAccount.id !== account.id) throw new Error("ChatGPT account changed before the request started.");
    if (!this.models.some(item => item.id === model)) throw new Error("Select a model available to the active ChatGPT account.");
    const token = await this.#tokens(account);
    if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed before the request started.");
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("ChatGPT request timed out.")), this.timeoutMs);
    try {
      const input = [];
      if (systemInstruction) input.push({ role: "system", content: systemInstruction });
      input.push({ role: "user", content: prompt });
      const response = await this.fetchImpl(API_BASE + "/responses", {
        method: "POST", signal: controller.signal,
        headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ model, input, store: false, stream: true })
      });
      if (!response.ok) throw new Error(apiFailure("ChatGPT inference failed", response, await readErrorPayload(response)));
      if (!response.body) throw new Error("ChatGPT did not return a response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", output = "", completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
          if (!data || data === "[DONE]") continue;
          let event; try { event = JSON.parse(data); } catch { continue; }
          if (event.type === "response.output_text.delta") output += event.delta || "";
          else if (event.type === "response.failed") {
            const failure = event.response?.error || {};
            const code = failure.code || "unknown_error";
            const param = failure.param ? "; param=" + failure.param : "";
            const requestId = response.headers?.get?.("x-request-id");
            const request = requestId ? "; request_id=" + requestId : "";
            const recovery = code === "subscription_sharing_usage_limit_exceeded"
              ? " Pause requests using this ChatGPT plan and review ChatGPT Settings → Usage; do not assume a reset time."
              : code === "subscription_sharing_user_not_eligible"
                ? " This ChatGPT account or workspace is not eligible for plan usage; choose an eligible account."
                : code === "subscription_sharing_usage_unavailable"
                  ? " Preserve credentials and retry later with bounded backoff."
                  : "";
            throw new Error("ChatGPT response failed: " + code + param + request + (failure.message ? ". " + String(failure.message).slice(0, 1000) : "") + recovery);
          }
          else if (event.type === "response.completed") completed = true;
          else if (event.type === "response.incomplete") throw new Error("ChatGPT response was incomplete: " + (event.response?.incomplete_details?.reason || "unknown reason"));
        }
      }
      if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed while the request was running.");
      if (!completed) throw new Error("ChatGPT stream ended without response.completed.");
      return { provider: "chatgpt", model, text: output, accountId: account.id };
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}
