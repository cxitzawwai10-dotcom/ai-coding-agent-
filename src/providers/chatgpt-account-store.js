import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const VERSION = 1;
const MAX_ACCOUNTS = 100;
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";

function keyFromSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AI_AGENT_VAULT_KEY must contain at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
}
function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function unseal(record, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8"));
}
function validate(state) {
  if (!state || state.version !== VERSION || !Array.isArray(state.accounts) || state.accounts.length > MAX_ACCOUNTS) throw new Error("ChatGPT account store has an invalid format.");
  const ids = new Set();
  for (const item of state.accounts) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) || item.issuer !== "https://auth.openai.com" || typeof item.subject !== "string" || typeof item.clientId !== "string" || typeof item.email !== "string" || !item.encryptedTokens) throw new Error("ChatGPT account store contains an invalid record.");
    ids.add(item.id);
  }
  if (state.activeAccountId !== null && !ids.has(state.activeAccountId)) throw new Error("Active ChatGPT account does not exist.");
  return state;
}

export class ChatGPTAccountStore {
  constructor({ filePath, masterSecret = process.env.AI_AGENT_VAULT_KEY }) {
    this.store = new JsonStore(filePath);
    this.key = keyFromSecret(masterSecret);
    this.state = null;
    this.queue = Promise.resolve();
    this.ready = this.#load();
  }
  async #load() { this.state = validate(await this.store.read({ version: VERSION, accounts: [], activeAccountId: null })); }
  async #mutate(fn) {
    const op = this.queue.then(async () => {
      await this.ready;
      const next = structuredClone(this.state);
      const result = await fn(next);
      validate(next);
      await this.store.write(next);
      this.state = next;
      return result;
    });
    this.queue = op.catch(() => {});
    return op;
  }
  #public(item) {
    return { id: item.id, email: item.email, name: item.name, subject: item.subject, clientId: item.clientId, scopes: [...item.scopes], planUsageEnabled: item.scopes.includes(REQUIRED_SCOPE), expiresAt: item.expiresAt, isActive: this.state.activeAccountId === item.id };
  }
  async saveVerifiedAccount({ issuer, subject, clientId, email, name = "", idToken, tokens, scopes, extAgentHostId }) {
    if (issuer !== "https://auth.openai.com" || !subject || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || typeof email !== "string" || !idToken || !tokens?.access_token || !Array.isArray(scopes) || !extAgentHostId) throw new Error("Verified ChatGPT account data is incomplete.");
    const account = await this.#mutate(next => {
      let item = next.accounts.find(a => a.issuer === issuer && a.subject === subject && a.clientId === clientId);
      if (!item) {
        if (next.accounts.length >= MAX_ACCOUNTS) throw new Error("ChatGPT account limit reached.");
        item = { id: randomUUID(), issuer, subject, clientId, email, name, extAgentHostId, scopes: [], expiresAt: null, encryptedTokens: null, createdAt: new Date().toISOString() };
        next.accounts.push(item);
      }
      item.email = email;
      item.name = name;
      item.extAgentHostId = extAgentHostId;
      item.scopes = [...new Set(scopes)];
      item.expiresAt = new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000).toISOString();
      item.encryptedTokens = seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, idToken }, this.key);
      next.activeAccountId = item.id;
      return item;
    });
    return this.#public(account);
  }
  async listAccounts() { await this.queue; await this.ready; return this.state.accounts.map(item => this.#public(item)); }
  async getActiveAccount() {
    await this.queue; await this.ready;
    const item = this.state.accounts.find(a => a.id === this.state.activeAccountId);
    if (!item) return null;
    return { ...this.#public(item), tokens: unseal(item.encryptedTokens, this.key), extAgentHostId: item.extAgentHostId };
  }
  async selectAccount(id) {
    const item = await this.#mutate(next => {
      const found = next.accounts.find(a => a.id === id);
      if (!found) throw new Error("ChatGPT account not found.");
      next.activeAccountId = id;
      return found;
    });
    return this.#public(item);
  }
  async removeAccount(id) {
    return this.#mutate(next => {
      const old = next.accounts.length;
      next.accounts = next.accounts.filter(a => a.id !== id);
      if (next.activeAccountId === id) next.activeAccountId = null;
      return next.accounts.length !== old;
    });
  }
  async updateTokens(id, tokens, scopes) {
    const item = await this.#mutate(next => {
      const found = next.accounts.find(a => a.id === id);
      if (!found) throw new Error("ChatGPT account not found.");
      const previous = unseal(found.encryptedTokens, this.key);
      found.encryptedTokens = seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous.refreshToken, idToken: previous.idToken }, this.key);
      found.expiresAt = new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000).toISOString();
      if (Array.isArray(scopes) && scopes.length) found.scopes = [...new Set(scopes)];
      return found;
    });
    return this.#public(item);
  }
}
