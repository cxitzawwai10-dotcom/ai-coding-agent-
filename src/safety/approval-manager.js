import { randomBytes, createHash } from "node:crypto";

export class ApprovalManager {
  constructor({ ttlMs = 5 * 60 * 1000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Invalid approval token lifetime.");
    this.ttlMs = ttlMs;
    this.pending = new Map();
    this.tokens = new Map();
  }

  snapshot(input) {
    const json = JSON.stringify(input);
    if (json === undefined) throw new Error("Approval input must be JSON-serializable.");
    return JSON.parse(json);
  }

  fingerprint(id, input) {
    return createHash("sha256").update(JSON.stringify([id, input])).digest("hex");
  }

  request(id, input) {
    if (typeof id !== "string" || !id) throw new Error("Invalid approval tool ID.");
    const savedInput = this.snapshot(input);
    const requestId = randomBytes(24).toString("hex");
    const expiresAt = Date.now() + this.ttlMs;
    this.pending.set(requestId, {
      id,
      input: savedInput,
      fingerprint: this.fingerprint(id, savedInput),
      expiresAt
    });
    return { requestId, toolId: id, input: this.snapshot(savedInput), expiresAt };
  }

  approve(requestId) {
    const request = this.pending.get(requestId);
    if (!request) throw new Error("Approval request not found or expired.");
    this.pending.delete(requestId);
    if (request.expiresAt <= Date.now()) throw new Error("Approval request expired.");
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    this.tokens.set(tokenHash, {
      id: request.id,
      fingerprint: request.fingerprint,
      expiresAt: Date.now() + this.ttlMs
    });
    return token;
  }

  reject(requestId) {
    return this.pending.delete(requestId);
  }

  verify(id, input, options = {}) {
    const token = options?.approvalToken;
    if (typeof token !== "string") return false;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = this.tokens.get(tokenHash);
    if (!record) return false;
    this.tokens.delete(tokenHash);
    let fingerprint;
    try {
      fingerprint = this.fingerprint(id, this.snapshot(input));
    } catch { return false; }
    return record.expiresAt > Date.now() &&
      record.id === id &&
      record.fingerprint === fingerprint;
  }

  clear() {
    this.pending.clear();
    this.tokens.clear();
  }
}
