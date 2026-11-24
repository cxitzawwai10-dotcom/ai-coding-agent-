import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGPTAccountStore } from "../src/providers/chatgpt-account-store.js";

const secret = "test-vault-secret-that-is-long-enough-123";
const sample = (subject, email) => ({ issuer: "https://auth.openai.com", subject, clientId: "oaiapp_test123", email, name: "Test", idToken: "id-token", tokens: { access_token: "access-secret-" + subject, refresh_token: "refresh-secret", expires_in: 3600 }, scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], extAgentHostId: "urn:uuid:test" });

test("stores multiple verified ChatGPT accounts encrypted and switches active account", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-store-"));
  try {
    const filePath = path.join(dir, "accounts.json");
    const store = new ChatGPTAccountStore({ filePath, masterSecret: secret });
    const first = await store.saveVerifiedAccount(sample("sub-1", "one@example.test"));
    const second = await store.saveVerifiedAccount(sample("sub-2", "two@example.test"));
    assert.equal((await store.listAccounts()).length, 2);
    assert.equal((await store.getActiveAccount()).id, second.id);
    await store.selectAccount(first.id);
    assert.equal((await store.getActiveAccount()).tokens.accessToken, "access-secret-sub-1");
    assert.doesNotMatch(await readFile(filePath, "utf8"), /access-secret|refresh-secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("account store rejects identity-only records missing the required registration details", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-invalid-"));
  try {
    const store = new ChatGPTAccountStore({ filePath: path.join(dir, "accounts.json"), masterSecret: secret });
    await assert.rejects(store.saveVerifiedAccount({ issuer: "wrong", subject: "sub", clientId: "bad", email: "x", tokens: {}, scopes: [], extAgentHostId: "x" }), /incomplete/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("vault key must be strong", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-secret-"));
  try { assert.throws(() => new ChatGPTAccountStore({ filePath: path.join(dir, "accounts.json"), masterSecret: "short" }), /at least 32/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
