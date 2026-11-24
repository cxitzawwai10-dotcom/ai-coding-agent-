import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGPTOAuth } from "../src/providers/chatgpt-oauth.js";

test("builds the documented loopback OAuth authorization request with PKCE and account-specific client ID", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-oauth-"));
  try {
    const accountStore = { async listAccounts(){return [];} };
    const oauth = new ChatGPTOAuth({accountStore,hostIdPath:path.join(dir,"host.json"),fetchImpl:async()=>{throw new Error("not called");}});
    const result = await oauth.beginLogin({redirectUri:"http://127.0.0.1:1455/auth/openai/callback"});
    const url = new URL(result.authorizationUrl);
    assert.equal(url.origin,"https://auth.openai.com");
    assert.equal(url.searchParams.get("client_id"),"dynamic_agent_client");
    assert.equal(url.searchParams.get("redirect_uri"),"http://127.0.0.1:1455/auth/openai/callback");
    assert.equal(url.searchParams.get("code_challenge_method"),"S256");
    assert.match(url.searchParams.get("scope"),/chatgpt.tokens.use.direct/);
    await assert.rejects(oauth.beginLogin({redirectUri:"https://example.test/auth/openai/callback"}),/127.0.0.1 loopback/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
