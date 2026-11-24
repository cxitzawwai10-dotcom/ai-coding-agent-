import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const VERSION = 1;
const MAX_ACCOUNTS = 100;
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";
const BUNDLE_AAD = Buffer.from("AI-CODING-AGENT-CHATGPT-CREDENTIALS-V1");
const MIN_BUNDLE_PASSPHRASE = 16;

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
    const encrypted = item?.encryptedTokens;
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        item.issuer !== "https://auth.openai.com" || typeof item.subject !== "string" || !item.subject ||
        typeof item.clientId !== "string" || !/^oaiapp_[A-Za-z0-9_-]+$/.test(item.clientId) ||
        typeof item.email !== "string" || !Array.isArray(item.scopes) || item.scopes.some(scope => typeof scope !== "string") ||
        typeof item.expiresAt !== "string" || !item.extAgentHostId ||
        !encrypted || typeof encrypted.iv !== "string" || typeof encrypted.tag !== "string" || typeof encrypted.data !== "string") {
      throw new Error("ChatGPT account store contains an invalid record.");
    }
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
    return { id: item.id, email: item.email, name: item.name, subject: item.subject, clientId: item.clientId, scopes: [...item.scopes], planUsageEnabled: item.scopes.includes(REQUIRED_SCOPE), needsReauth: item.needsReauth === true, expiresAt: item.expiresAt, isActive: this.state.activeAccountId === item.id };
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
      item.needsReauth = false;
      next.activeAccountId = item.id;
      return item;
    });
    return this.#public(account);
  }
  async listAccounts() { await this.queue; await this.ready; return this.state.accounts.map(item => this.#public(item)); }
  async getAccountForAuthorization(id) {
    await this.queue; await this.ready;
    const item = this.state.accounts.find(a => a.id === id);
    if (!item) return null;
    return { ...this.#public(item), tokens: unseal(item.encryptedTokens, this.key), extAgentHostId: item.extAgentHostId };
  }
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
  async clearCredentials(id) {
    return this.#mutate(next => {
      const found = next.accounts.find(a => a.id === id);
      if (!found) throw new Error("ChatGPT account not found.");
      const previous = unseal(found.encryptedTokens, this.key);
      found.encryptedTokens = seal({ accessToken: "", refreshToken: null, idToken: previous.idToken }, this.key);
      found.expiresAt = new Date(0).toISOString();
      found.needsReauth = true;
      return this.#public(found);
    });
  }
  async exportCredentialBundle(id, passphrase) {
    if (typeof passphrase !== "string" || passphrase.length < MIN_BUNDLE_PASSPHRASE) throw new Error("Credential transfer passphrase must contain at least 16 characters.");
    const account = await this.getAccountForAuthorization(id);
    if (!account) throw new Error("ChatGPT account not found.");
    const payload = {
      version: 1,
      account: {
        issuer: account.issuer,
        subject: account.subject,
        clientId: account.clientId,
        email: account.email,
        name: account.name,
        idToken: account.tokens.idToken,
        tokens: {
          access_token: account.tokens.accessToken,
          refresh_token: account.tokens.refreshToken,
          expires_in: Math.max(0, (Date.parse(account.expiresAt) - Date.now()) / 1000)
        },
        scopes: account.scopes
      }
    };
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(BUNDLE_AAD);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return {
      version: 1,
      kdf: "scrypt",
      cipher: "aes-256-gcm",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: encrypted.toString("base64")
    };
  }
  async importCredentialBundle(bundle, passphrase, extAgentHostId) {
    if (typeof passphrase !== "string" || passphrase.length < MIN_BUNDLE_PASSPHRASE) throw new Error("Credential transfer passphrase must contain at least 16 characters.");
    if (!bundle || bundle.version !== 1 || bundle.kdf !== "scrypt" || bundle.cipher !== "aes-256-gcm" ||
        !["salt", "iv", "tag", "ciphertext"].every(key => typeof bundle[key] === "string")) {
      throw new Error("Credential transfer file has an unsupported format.");
    }
    const ciphertext = Buffer.from(bundle.ciphertext, "base64");
    if (!ciphertext.length || ciphertext.length > 1024 * 1024) throw new Error("Credential transfer file exceeds its size limit.");
    let payload;
    try {
      const salt = Buffer.from(bundle.salt, "base64");
      const iv = Buffer.from(bundle.iv, "base64");
      const tag = Buffer.from(bundle.tag, "base64");
      if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted credential metadata.");
      const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(BUNDLE_AAD);
      decipher.setAuthTag(tag);
      payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    } catch {
      throw new Error("Credential transfer could not be decrypted. Check the file and passphrase.");
    }
    const item = payload?.account;
    if (payload?.version !== 1 || !item || item.issuer !== "https://auth.openai.com" ||
        typeof item.subject !== "string" || !item.subject || !/^oaiapp_[A-Za-z0-9_-]+$/.test(item.clientId || "") ||
        typeof item.email !== "string" || typeof item.idToken !== "string" ||
        typeof item.tokens?.access_token !== "string" || !item.tokens.access_token ||
        (item.tokens.refresh_token !== null && typeof item.tokens.refresh_token !== "string") ||
        !Array.isArray(item.scopes) || item.scopes.some(scope => typeof scope !== "string")) {
      throw new Error("Credential transfer contains an invalid ChatGPT account record.");
    }
    return this.saveVerifiedAccount({
      issuer: item.issuer, subject: item.subject, clientId: item.clientId,
      email: item.email, name: typeof item.name === "string" ? item.name : "",
      idToken: item.idToken, tokens: item.tokens, scopes: item.scopes,
      extAgentHostId
    });
  }
  async updateTokens(id, tokens, scopes) {
    const item = await this.#mutate(next => {
      const found = next.accounts.find(a => a.id === id);
      if (!found) throw new Error("ChatGPT account not found.");
      const previous = unseal(found.encryptedTokens, this.key);
      found.encryptedTokens = seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous.refreshToken, idToken: previous.idToken }, this.key);
      found.expiresAt = new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000).toISOString();
      found.needsReauth = false;
      if (Array.isArray(scopes) && scopes.length) found.scopes = [...new Set(scopes)];
      return found;
    });
    return this.#public(item);
  }
}
