const DEFAULT_TIMEOUT_MS = 60000;
export class ProviderClient {
  constructor({ accountVault, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!accountVault || typeof fetchImpl !== "function") throw new Error("ProviderClient requires an account vault and fetch implementation.");
    this.accountVault = accountVault; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async generate({ prompt, model, systemInstruction = "" }) {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000) throw new Error("Prompt must be 1-100000 characters.");
    const account = await this.accountVault.getActiveAccount();
    if (!account) throw new Error("No active AI provider account is selected.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response, payload;
      if (account.provider === "gemini") {
        const selectedModel = model || "gemini-2.5-flash";
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(selectedModel)) throw new Error("Invalid Gemini model ID.");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
        response = await this.fetchImpl(url, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-goog-api-key": account.apiKey }, body: JSON.stringify({ systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined, contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
        payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 429 && /quota|daily|limit/i.test(JSON.stringify(payload))) await this.accountVault.markDailyQuotaExceeded(account.id);
          throw new Error(`Gemini request failed (HTTP ${response.status}).`);
        }
        return { provider: "gemini", model: selectedModel, text: payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "", usage: payload.usageMetadata || null };
      }
      throw new Error("The configured OpenAI-compatible provider requires an explicit supported endpoint adapter; arbitrary endpoints are disabled.");
    } finally { clearTimeout(timer); }
  }
}
