import { randomBytes, createHash } from "node:crypto";

export class ApprovalManager {
  constructor({ ttlMs = 5 * 60 * 1000, maxPending = 1000, maxTokens = 1000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Invalid approval token lifetime.");
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new Error("Invalid pending approval limit.");
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error("Invalid approval token limit.");
    this.ttlMs = ttlMs;
    this.maxPending = maxPending;
    this.maxTokens = maxTokens;
    this.pending = new Map();
    this.tokens = new Map();
  }

  snapshot(input) {
    const json = JSON.stringify(input);
    if (json === undefined) throw new Error("Approval input must be JSON-serializable.");
    return JSON.parse(json);
  }

  fingerprint(id, input, binding = null) {
    return createHash("sha256").update(JSON.stringify([id, binding, input])).digest("hex");
  }

  cleanupExpired(now = Date.now()) {
    for (const [id, item] of this.pending) if (item.expiresAt <= now) this.pending.delete(id);
    for (const [hash, item] of this.tokens) if (item.expiresAt <= now) this.tokens.delete(hash);
  }

  request(id, input, binding = null) {
    this.cleanupExpired();
    if (typeof id !== "string" || !id) throw new Error("Invalid approval tool ID.");
    if (this.pending.size >= this.maxPending) throw new Error("Too many pending approval requests.");
    const saved = this.snapshot(input);
    const requestId = randomBytes(24).toString("hex");
    const expiresAt = Date.now() + this.ttlMs;
    this.pending.set(requestId, { id, input: saved, binding, fingerprint: this.fingerprint(id, saved, binding), expiresAt });
    return { requestId, toolId: id, input: this.snapshot(saved), expiresAt };
  }

  approve(requestId) {
    this.cleanupExpired();
    const request = this.pending.get(requestId);
    if (!request) throw new Error("Approval request not found or expired.");
    this.pending.delete(requestId);
    if (request.expiresAt <= Date.now()) throw new Error("Approval request expired.");
    if (this.tokens.size >= this.maxTokens) throw new Error("Too many active approval tokens.");
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    this.tokens.set(hash, { id: request.id, fingerprint: request.fingerprint, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  reject(requestId) { return this.pending.delete(requestId); }

  verify(id, input, options = {}, binding = null) {
    this.cleanupExpired();
    const token = options?.approvalToken;
    if (typeof token !== "string") return false;
    const hash = createHash("sha256").update(token).digest("hex");
    const record = this.tokens.get(hash);
    if (!record) return false;
    this.tokens.delete(hash);
    let fingerprint;
    try { fingerprint = this.fingerprint(id, this.snapshot(input), binding); }
    catch { return false; }
    return record.expiresAt > Date.now() && record.id === id && record.fingerprint === fingerprint;
  }

  clear() { this.pending.clear(); this.tokens.clear(); }
}
