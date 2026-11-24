import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const VERSION = 1;
const MAX_ACCOUNTS = 100;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function masterKey(value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("AI_AGENT_VAULT_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(value, "utf8").digest();
}
function encryptSecret(secret, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") };
}
function decryptSecret(record, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8");
}
function validateState(state) {
  if (!state || state.version !== VERSION || !Array.isArray(state.accounts) || state.accounts.length > MAX_ACCOUNTS) {
    throw new Error("Account vault has an unsupported or invalid format.");
  }
  const ids = new Set();
  for (const account of state.accounts) {
    if (!account || typeof account.id !== "string" || ids.has(account.id) ||
        !["gemini", "openai"].includes(account.provider) ||
        typeof account.label !== "string" || !account.encryptedSecret ||
        !Number.isFinite(Date.parse(account.createdAt)) ||
        (account.cooldownUntil !== null && !Number.isFinite(Date.parse(account.cooldownUntil)))) {
      throw new Error("Account vault contains an invalid account.");
    }
    ids.add(account.id);
  }
  if (state.activeAccountId !== null && !ids.has(state.activeAccountId)) throw new Error("Account vault active account is invalid.");
  return state;
}

export class AccountVault {
  constructor({ filePath, masterSecret = process.env.AI_AGENT_VAULT_KEY, clock = () => Date.now() }) {
    this.store = new JsonStore(filePath);
    this.key = masterKey(masterSecret);
    this.clock = clock;
    this.state = null;
    this.ready = this.#load();
  }
  async #load() {
    const state = await this.store.read({ version: VERSION, accounts: [], activeAccountId: null });
    this.state = validateState(state);
  }
  async #save(next) {
    validateState(next);
    await this.store.write(next);
    this.state = next;
  }
  async addAccount({ provider, label, apiKey }) {
    await this.ready;
    if (!["gemini", "openai"].includes(provider)) throw new Error("Unsupported AI provider.");
    if (typeof label !== "string" || !label.trim() || label.length > 80) throw new Error("Account label must be 1-80 characters.");
    if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("Invalid API key.");
    if (this.state.accounts.length >= MAX_ACCOUNTS) throw new Error("Account limit reached.");
    const account = { id: randomUUID(), provider, label: label.trim(), encryptedSecret: encryptSecret(apiKey, this.key), createdAt: new Date(this.clock()).toISOString(), cooldownUntil: null, quotaExceededAt: null };
    const next = structuredClone(this.state);
    next.accounts.push(account);
    if (!next.activeAccountId) next.activeAccountId = account.id;
    await this.#save(next);
    return this.#public(account);
  }
  #public(account) {
    return { id: account.id, provider: account.provider, label: account.label, createdAt: account.createdAt, cooldownUntil: account.cooldownUntil, isActive: this.state.activeAccountId === account.id, maskedKey: "••••••••" };
  }
  async listAccounts() {
    await this.ready;
    return this.state.accounts.map(account => this.#public(account));
  }
  async getActiveAccount() {
    await this.ready;
    const account = this.state.accounts.find(item => item.id === this.state.activeAccountId);
    if (!account) return null;
    if (account.cooldownUntil && Date.parse(account.cooldownUntil) > this.clock()) {
      throw new Error("The selected account is in provider quota cooldown. Select an eligible account only if its own provider limits permit use.");
    }
    return { ...this.#public(account), apiKey: decryptSecret(account.encryptedSecret, this.key) };
  }
  async selectAccount(id) {
    await this.ready;
    const account = this.state.accounts.find(item => item.id === id);
    if (!account) throw new Error("AI account not found.");
    if (account.cooldownUntil && Date.parse(account.cooldownUntil) > this.clock()) throw new Error("This account is in quota cooldown.");
    const next = structuredClone(this.state); next.activeAccountId = id; await this.#save(next);
    return this.#public(account);
  }
  async removeAccount(id) {
    await this.ready;
    const next = structuredClone(this.state);
    const before = next.accounts.length;
    next.accounts = next.accounts.filter(account => account.id !== id);
    if (next.accounts.length === before) return false;
    if (next.activeAccountId === id) next.activeAccountId = null;
    await this.#save(next); return true;
  }
  async markDailyQuotaExceeded(id) {
    await this.ready;
    const next = structuredClone(this.state);
    const account = next.accounts.find(item => item.id === id);
    if (!account) throw new Error("AI account not found.");
    if (!account.quotaExceededAt) {
      account.quotaExceededAt = new Date(this.clock()).toISOString();
      account.cooldownUntil = new Date(this.clock() + COOLDOWN_MS).toISOString();
    }
    if (next.activeAccountId === id) next.activeAccountId = null;
    await this.#save(next);
    return this.#public(account);
  }
  async clearExpiredCooldowns() {
    await this.ready;
    const next = structuredClone(this.state); let changed = false;
    for (const account of next.accounts) {
      if (account.cooldownUntil && Date.parse(account.cooldownUntil) <= this.clock()) {
        account.cooldownUntil = null; account.quotaExceededAt = null; changed = true;
      }
    }
    if (changed) await this.#save(next);
  }
}
