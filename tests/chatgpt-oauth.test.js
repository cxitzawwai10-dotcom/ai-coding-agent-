import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ChatGPTOAuth } from "../src/providers/chatgpt-oauth.js";

function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function makeIdToken(privateKey, clientId, nonce) {
  const header = encode({ alg: "RS256", typ: "JWT", kid: "test-key" });
  const claims = encode({ iss: "https://auth.openai.com", aud: clientId, sub: "account-subject", email: "person@example.test", name: "Person", exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), nonce });
  const input = header + "." + claims;
  return input + "." + sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
}

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

test("validates the OAuth state, issued client ID, ID-token signature, nonce and granted scopes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-oauth-callback-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let saved;
    const accountStore = {
      async listAccounts(){return [];},
      async saveVerifiedAccount(value){saved=value;return {id:"stored-account",email:value.email};}
    };
    const fetchImpl = async (url, options={}) => {
      if (url === "https://auth.openai.com/api/accounts/oauth/token") {
        const params = new URLSearchParams(options.body);
        assert.equal(params.get("grant_type"),"authorization_code");
        assert.ok(params.get("code_verifier"));
        return {ok:true,json:async()=>({id_token:makeIdToken(privateKey,"oaiapp_issued123",nonce),access_token:"access-token",refresh_token:"refresh-token",expires_in:3600,scope:"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"})};
      }
      if (url === "https://auth.openai.com/.well-known/jwks.json") return {ok:true,json:async()=>({keys:[{...publicKey.export({format:"jwk"}),kid:"test-key",use:"sig",alg:"RS256"}]})};
      throw new Error("Unexpected OAuth URL: "+url);
    };
    let nonce;
    const oauth = new ChatGPTOAuth({accountStore,hostIdPath:path.join(dir,"host.json"),fetchImpl});
    const start = await oauth.beginLogin({redirectUri:"http://127.0.0.1:1455/auth/openai/callback"});
    const auth = new URL(start.authorizationUrl);
    nonce = auth.searchParams.get("nonce");
    const state = auth.searchParams.get("state");
    await assert.rejects(oauth.handleCallback("http://127.0.0.1:1455/auth/openai/callback?code=bad&client_id=oaiapp_issued123&state=wrong"),/state is invalid/);
    const account = await oauth.handleCallback("http://127.0.0.1:1455/auth/openai/callback?code=valid&client_id=oaiapp_issued123&state="+encodeURIComponent(state));
    assert.equal(account.id,"stored-account");
    assert.equal(saved.subject,"account-subject");
    assert.equal(saved.clientId,"oaiapp_issued123");
    assert.ok(saved.scopes.includes("chatgpt.tokens.use.direct"));
    assert.match(saved.extAgentHostId,/^urn:uuid:/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("revokes the renewable ChatGPT session before removing an account", async () => {
  const calls=[];
  let removed=false;
  const accountStore={
    async getAccountForAuthorization(id){assert.equal(id,"account-id");return {id,clientId:"oaiapp_revoke",tokens:{refreshToken:"refresh-secret"}};},
    async removeAccount(id){assert.equal(id,"account-id");removed=true;return true;}
  };
  const oauth=new ChatGPTOAuth({accountStore,hostIdPath:"/tmp/unused-chatgpt-host-"+Date.now()+".json",fetchImpl:async(url,options={})=>{
    calls.push({url,options});
    if(url==="https://auth.openai.com/.well-known/openid-configuration")return {ok:true,json:async()=>({revocation_endpoint:"https://auth.openai.com/api/accounts/oauth/revoke"})};
    if(url==="https://auth.openai.com/api/accounts/oauth/revoke")return {status:200,ok:true};
    throw new Error("Unexpected URL");
  }});
  const result=await oauth.revokeAccount("account-id");
  assert.equal(result.removed,true);
  assert.equal(result.remoteRevocationConfirmed,true);
  assert.equal(removed,true);
  const form=new URLSearchParams(calls[1].options.body);
  assert.equal(form.get("token"),"refresh-secret");
  assert.equal(form.get("token_type_hint"),"refresh_token");
  assert.equal(form.get("client_id"),"oaiapp_revoke");
});
