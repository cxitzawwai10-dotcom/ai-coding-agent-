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

test("exports and imports an authenticated encrypted credential bundle without exposing tokens", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-transfer-"));
  try {
    const passphrase = "long-transfer-passphrase-keep-safe";
    const source = new ChatGPTAccountStore({filePath:path.join(dir,"source.json"),masterSecret:secret});
    const original = await source.saveVerifiedAccount(sample("transfer-sub","transfer@example.test"));
    const bundle = await source.exportCredentialBundle(original.id,passphrase);
    const serialized = JSON.stringify(bundle);
    assert.doesNotMatch(serialized,/access-secret|refresh-secret|id-token/);
    const destination = new ChatGPTAccountStore({filePath:path.join(dir,"destination.json"),masterSecret:secret});
    const imported = await destination.importCredentialBundle(bundle,passphrase,"urn:uuid:destination-host");
    const active = await destination.getActiveAccount();
    assert.equal(imported.email,"transfer@example.test");
    assert.equal(active.tokens.accessToken,"access-secret-transfer-sub");
    assert.equal(active.tokens.refreshToken,"refresh-secret");
    assert.equal(active.extAgentHostId,"urn:uuid:destination-host");
    await assert.rejects(destination.importCredentialBundle(bundle,"wrong-transfer-passphrase","urn:uuid:destination-host"),/could not be decrypted/);
    const altered={...bundle,tag:Buffer.alloc(16,7).toString("base64")};
    await assert.rejects(destination.importCredentialBundle(altered,passphrase,"urn:uuid:destination-host"),/could not be decrypted/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("credential transfer requires a long passphrase", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-transfer-pass-"));
  try {
    const store = new ChatGPTAccountStore({filePath:path.join(dir,"accounts.json"),masterSecret:secret});
    const account = await store.saveVerifiedAccount(sample("pass-sub","pass@example.test"));
    await assert.rejects(store.exportCredentialBundle(account.id,"too-short"),/at least 16/);
    await assert.rejects(store.importCredentialBundle({}, "too-short", "urn:uuid:host"),/at least 16/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("persists an explicitly empty refreshed scope set instead of retaining revoked grants", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-empty-scopes-"));
  try {
    const store = new ChatGPTAccountStore({ filePath: path.join(dir, "accounts.json"), masterSecret: secret });
    const account = await store.saveVerifiedAccount(sample("empty-scope-sub", "empty-scope@example.test"));
    await store.updateTokens(account.id, {
      access_token: "rotated-without-grants",
      refresh_token: "rotated-refresh",
      expires_in: 3600
    }, []);
    const listed = (await store.listAccounts())[0];
    assert.deepEqual(listed.scopes, []);
    assert.equal(listed.planUsageEnabled, false);
    const active = await store.getActiveAccount();
    assert.deepEqual(active.scopes, []);
    assert.equal(active.tokens.accessToken, "rotated-without-grants");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
