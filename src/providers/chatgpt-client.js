const API_BASE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";

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
  }
  cancelActiveRequests() {
    this.accountEpoch++;
    for (const controller of this.controllers) controller.abort(new Error("ChatGPT account changed."));
    this.controllers.clear();
    this.models = [];
    this.modelsForAccountId = null;
  }
  async #tokens() {
    const account = await this.accountStore.getActiveAccount();
    if (!account) throw new Error("Sign in with ChatGPT and select an account first.");
    if (!account.scopes.includes(PLAN_SCOPE)) throw new Error("This ChatGPT account has identity sign-in only; ChatGPT plan usage permission was not granted.");
    if (Date.parse(account.expiresAt) <= Date.now() + 60000) {
      if (!account.tokens.refreshToken) throw new Error("ChatGPT session expired. Sign in again to reconnect this account.");
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.tokens.refreshToken, client_id: account.clientId, resource: API_BASE });
      const response = await this.fetchImpl("https://auth.openai.com/api/accounts/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
      const refreshed = await response.json().catch(() => ({}));
      if (!response.ok || !refreshed.access_token) throw new Error("ChatGPT session refresh failed (HTTP " + response.status + "). Sign in again.");
      await this.accountStore.updateTokens(account.id, refreshed);
      return refreshed.access_token;
    }
    return account.tokens.accessToken;
  }
  async listModels() {
    const account = await this.accountStore.getActiveAccount();
    if (!account) throw new Error("No active ChatGPT account.");
    const token = await this.#tokens();
    const response = await this.fetchImpl(API_BASE + "/models", { headers: { authorization: "Bearer " + token, accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("ChatGPT model catalog request failed (HTTP " + response.status + ").");
    const rows = Array.isArray(payload.models) ? payload.models : [];
    this.models = rows.filter(item => item && item.visibility === "list" && typeof item.slug === "string" && typeof item.display_name === "string").map(item => ({ id: item.slug, name: item.display_name }));
    this.modelsForAccountId = account.id;
    return this.models;
  }
  async generate({ prompt, model, systemInstruction = "" }) {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000) throw new Error("Prompt must be 1-100000 characters.");
    const epoch = this.accountEpoch;
    const account = await this.accountStore.getActiveAccount();
    if (!account) throw new Error("No active ChatGPT account.");
    if (this.modelsForAccountId !== account.id) await this.listModels();
    if (epoch !== this.accountEpoch) throw new Error("ChatGPT account changed before the request started.");
    if (!this.models.some(item => item.id === model)) throw new Error("Select a model available to the active ChatGPT account.");
    const token = await this.#tokens();
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
      if (!response.ok) throw new Error("ChatGPT inference failed (HTTP " + response.status + ").");
      if (!response.body) throw new Error("ChatGPT did not return a response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", output = "", completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
          if (!data || data === "[DONE]") continue;
          let event; try { event = JSON.parse(data); } catch { continue; }
          if (event.type === "response.output_text.delta") output += event.delta || "";
          else if (event.type === "response.failed") throw new Error("ChatGPT response failed: " + (event.response?.error?.code || "unknown_error"));
          else if (event.type === "response.completed") completed = true;
          else if (event.type === "response.incomplete") throw new Error("ChatGPT response was incomplete.");
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
