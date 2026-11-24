import http from "node:http";
import { createHash, randomBytes, randomUUID, createPublicKey, verify as verifySignature, constants } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = ISSUER + "/api/accounts/authorize";
const TOKEN_URL = ISSUER + "/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const JWKS_URL = ISSUER + "/.well-known/jwks.json";

function b64url(buffer) { return Buffer.from(buffer).toString("base64url"); }
function decodePart(value) { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
function sha(value) { return createHash("sha256").update(value).digest(); }

async function verifyIdToken(token, clientId, nonce, fetchImpl) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("OpenAI returned a malformed ID token.");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!["RS256", "PS256", "ES256"].includes(header.alg) || typeof header.kid !== "string") throw new Error("OpenAI ID token uses an unsupported signing algorithm.");
  const jwksResponse = await fetchImpl(JWKS_URL, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error("Unable to retrieve OpenAI signing keys.");
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.use !== "enc");
  if (!jwk) throw new Error("OpenAI ID token signing key was not found.");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(parts[0] + "." + parts[1]);
  const signature = Buffer.from(parts[2], "base64url");
  let valid = false;
  if (header.alg === "RS256") valid = verifySignature("RSA-SHA256", data, publicKey, signature);
  if (header.alg === "PS256") valid = verifySignature("sha256", data, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature);
  if (header.alg === "ES256") valid = verifySignature("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  const now = Math.floor(Date.now() / 1000);
  const audienceOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) && (claims.aud.length === 1 || claims.azp === clientId) : claims.aud === clientId;
  const notYetValid = Number.isFinite(claims.nbf) && claims.nbf > now + 60;
  if (!valid || claims.iss !== ISSUER || !audienceOk || notYetValid || !Number.isFinite(claims.exp) || claims.exp <= now || claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub) throw new Error("OpenAI ID token validation failed.");
  return claims;
}

export class ChatGPTOAuth {
  constructor({ accountStore, hostIdPath, fetchImpl = globalThis.fetch, clock = () => Date.now() }) {
    if (!accountStore || typeof fetchImpl !== "function") throw new Error("ChatGPTOAuth requires an account store and fetch.");
    this.accountStore = accountStore;
    this.hostIdStore = new JsonStore(hostIdPath, { maxBytes: 4096 });
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.transactions = new Map();
    this.hostIdPromise = null;
  }
  async #hostId() {
    if (!this.hostIdPromise) this.hostIdPromise = (async () => {
      const saved = await this.hostIdStore.read(null);
      if (saved?.extAgentHostId) return saved.extAgentHostId;
      const value = "urn:uuid:" + randomUUID();
      await this.hostIdStore.write({ extAgentHostId: value });
      return value;
    })();
    return this.hostIdPromise;
  }
  async beginLogin({ redirectUri, existingAccountId = null }) {
    const callback = new URL(redirectUri);
    if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || callback.pathname !== "/auth/openai/callback") throw new Error("ChatGPT plan sign-in requires the official 127.0.0.1 loopback callback.");
    for (const [pendingState, pending] of this.transactions) {
      if (this.clock() - pending.createdAt > 10 * 60 * 1000) this.transactions.delete(pendingState);
    }
    if (this.transactions.size >= 10) throw new Error("Too many pending ChatGPT sign-in attempts.");
    const state = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(sha(verifier));
    const hostId = await this.#hostId();
    const existing = existingAccountId ? await this.accountStore.getAccountForAuthorization(existingAccountId) : null;
    if (existingAccountId && !existing) throw new Error("Selected ChatGPT account was not found.");
    const params = new URLSearchParams({
      client_id: existing?.clientId || "dynamic_agent_client",
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state, nonce,
      code_challenge_method: "S256",
      code_challenge: challenge,
      ext_agent_host_id: hostId
    });
    if (!existing) params.set("agent_name_hint", "AI Coding Agent");
    else {
      params.set("login_hint", existing.email);
      if (existing.tokens?.idToken) params.set("id_token_hint", existing.tokens.idToken);
    }
    this.transactions.set(state, { state, nonce, verifier, redirectUri, clientId: existing?.clientId || null, accountId: existing?.id || null, hostId, createdAt: this.clock() });
    return { authorizationUrl: AUTHORIZE_URL + "?" + params.toString(), expiresInSeconds: 600 };
  }
  async handleCallback(urlValue) {
    const url = new URL(urlValue);
    const state = url.searchParams.get("state");
    const tx = state && this.transactions.get(state);
    if (!tx || this.clock() - tx.createdAt > 10 * 60 * 1000) throw new Error("ChatGPT sign-in state is invalid or expired.");
    this.transactions.delete(state);
    if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error") === "access_denied" ? "ChatGPT sign-in or plan-usage permission was declined." : "ChatGPT authorization failed.");
    const code = url.searchParams.get("code");
    const callbackClientId = url.searchParams.get("client_id");
    const clientId = tx.clientId || callbackClientId;
    if (!code || !clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (tx.clientId && callbackClientId && callbackClientId !== tx.clientId)) throw new Error("ChatGPT OAuth callback is missing or changed its issued client ID.");
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: tx.verifier, redirect_uri: tx.redirectUri, resource: RESOURCE });
    const response = await this.fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("ChatGPT token exchange failed (HTTP " + response.status + ").");
    if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string") throw new Error("ChatGPT token response is incomplete.");
    const claims = await verifyIdToken(tokens.id_token, clientId, tx.nonce, this.fetchImpl);
    const scopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
    const accounts = await this.accountStore.listAccounts();
    const old = tx.accountId && accounts.find(a => a.id === tx.accountId);
    if (old && (old.subject !== claims.sub || old.clientId !== clientId)) throw new Error("Reauthorized ChatGPT identity does not match the selected account.");
    return this.accountStore.saveVerifiedAccount({
      issuer: ISSUER, subject: claims.sub, clientId,
      email: typeof claims.email === "string" ? claims.email : (old?.email || "ChatGPT account"),
      name: typeof claims.name === "string" ? claims.name : "",
      idToken: tokens.id_token, tokens, scopes, extAgentHostId: tx.hostId
    });
  }
}
