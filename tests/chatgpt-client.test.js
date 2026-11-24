import test from "node:test";
import assert from "node:assert/strict";
import { ChatGPTClient } from "../src/providers/chatgpt-client.js";

test("uses one official endpoint family, refreshes model list per active account, and streams Responses", async () => {
  let active = { id: "a", scopes: ["chatgpt.tokens.use.direct"], expiresAt: new Date(Date.now()+3600000).toISOString(), clientId: "oaiapp_a", tokens: { accessToken: "token-a" } };
  const urls = [];
  const store = { async getActiveAccount() { return active; } };
  const fetchImpl = async (url, options={}) => {
    urls.push({url,options});
    if (url.endsWith("/models")) return {ok:true,json:async()=>({models:[{visibility:"list",slug:"model-a",display_name:"Model A"}]})};
    if (url.endsWith("/responses")) return {ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\n'));controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed"}\n\n'));controller.close();}})};
    throw new Error("Unexpected URL");
  };
  const client = new ChatGPTClient({accountStore:store,fetchImpl});
  const result = await client.generate({prompt:"hi",model:"model-a"});
  assert.equal(result.text,"hello");
  assert.equal(urls.filter(x=>x.url.endsWith("/models")).length,1);
  assert.equal(urls.find(x=>x.url.endsWith("/responses")).url,"https://api.openai.com/v1/responses");
  const body = JSON.parse(urls.find(x=>x.url.endsWith("/responses")).options.body);
  assert.equal(body.store,false); assert.equal(body.stream,true);
  active = {...active,id:"b",tokens:{accessToken:"token-b"}};
  await client.listModels();
  assert.equal(urls.filter(x=>x.url.endsWith("/models")).length,2);
});

test("does not infer when ChatGPT plan scope is absent", async () => {
  const client = new ChatGPTClient({accountStore:{async getActiveAccount(){return {id:"a",scopes:["openid"],expiresAt:new Date().toISOString(),tokens:{}};}},fetchImpl:async()=>{throw new Error("must not fetch");}});
  await assert.rejects(client.listModels(),/identity sign-in only/);
});

test("serializes rotating refresh-token requests for a single account", async () => {
  const account = { id:"refresh-account", clientId:"oaiapp_refresh", scopes:["chatgpt.tokens.use.direct"], expiresAt:new Date(0).toISOString(), tokens:{accessToken:"old-access",refreshToken:"old-refresh"} };
  let refreshCalls=0, updated=0;
  const store = {
    async getActiveAccount(){return {...account};},
    async updateTokens(id,tokens){assert.equal(id,account.id);updated++;account.tokens={accessToken:tokens.access_token,refreshToken:tokens.refresh_token};account.expiresAt=new Date(Date.now()+Number(tokens.expires_in)*1000).toISOString();}
  };
  const client = new ChatGPTClient({accountStore:store,fetchImpl:async(url,options={})=>{
    if(url.includes("/oauth/token")){refreshCalls++;await new Promise(resolve=>setTimeout(resolve,15));return {ok:true,json:async()=>({access_token:"new-access",refresh_token:"new-refresh",expires_in:3600})};}
    if(url.endsWith("/models")){assert.equal(options.headers.authorization,"Bearer new-access");return {ok:true,json:async()=>({models:[]})};}
    throw new Error("Unexpected URL");
  }});
  await Promise.all([client.listModels(),client.listModels()]);
  assert.equal(refreshCalls,1);
  assert.equal(updated,1);
});

test("clears a terminally revoked refresh token without switching accounts", async () => {
  let cleared = null;
  const account = {id:"revoked",clientId:"oaiapp_revoked",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(0).toISOString(),tokens:{accessToken:"old",refreshToken:"revoked"}};
  const client = new ChatGPTClient({accountStore:{async getActiveAccount(){return account;},async clearCredentials(id){cleared=id;}},fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:"invalid_grant"})})});
  await assert.rejects(client.listModels(),/refresh failed/);
  assert.equal(cleared,"revoked");
});

test("account switching aborts model discovery and prevents stale models from replacing the new account catalog", async () => {
  let active = {id:"old",clientId:"oaiapp_old",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"old-token"}};
  let oldStarted;
  const started = new Promise(resolve=>oldStarted=resolve);
  const fetchImpl = async (url,options={}) => {
    if (!url.endsWith("/models")) throw new Error("Unexpected URL");
    if (options.headers.authorization === "Bearer old-token") {
      oldStarted();
      return await new Promise((resolve,reject)=>{
        options.signal.addEventListener("abort",()=>reject(options.signal.reason || new Error("aborted")),{once:true});
      });
    }
    return {ok:true,json:async()=>({models:[{visibility:"list",slug:"new-model",display_name:"New Model"}]})};
  };
  const store={async getActiveAccount(){return active;}};
  const client=new ChatGPTClient({accountStore:store,fetchImpl});
  const stale=client.listModels();
  await started;
  client.cancelActiveRequests();
  active={id:"new",clientId:"oaiapp_new",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"new-token"}};
  await assert.rejects(stale);
  const models=await client.listModels();
  assert.deepEqual(models,[{id:"new-model",name:"New Model"}]);
  assert.equal(client.modelsForAccountId,"new");
});

test("never sends a request using the previous account after a switch during token preparation", async () => {
  let active={id:"old",clientId:"oaiapp_old",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"old-token"}};
  let release;
  const wait=new Promise(resolve=>release=resolve);
  const store={async getActiveAccount(){await wait;return active;}};
  const client=new ChatGPTClient({accountStore:store,fetchImpl:async()=>{throw new Error("must not call fetch");}});
  const pending=client.listModels();
  client.cancelActiveRequests();
  active={id:"new",clientId:"oaiapp_new",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"new-token"}};
  release();
  await assert.rejects(pending,/account changed/);
});

test("preserves direct-admission error detail, request ID and plan-usage recovery guidance", async () => {
  const account={id:"limited",clientId:"oaiapp_limited",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"limited-token"}};
  const client=new ChatGPTClient({accountStore:{async getActiveAccount(){return account;}},fetchImpl:async()=>({
    ok:false,status:429,headers:{get(name){return name==="x-request-id"?"req_test_123":null;}},
    async text(){return JSON.stringify({detail:"Plan usage limit reached.",error:{code:"subscription_sharing_usage_limit_exceeded"}});}
  })});
  await assert.rejects(client.listModels(),error=>{
    assert.match(error.message,/HTTP 429/);
    assert.match(error.message,/subscription_sharing_usage_limit_exceeded/);
    assert.match(error.message,/req_test_123/);
    assert.match(error.message,/ChatGPT Settings/);
    return true;
  });
});

test("parses CRLF server-sent events even when line endings are split across chunks", async () => {
  const account={id:"crlf",clientId:"oaiapp_crlf",scopes:["chatgpt.tokens.use.direct"],expiresAt:new Date(Date.now()+3600000).toISOString(),tokens:{accessToken:"crlf-token"}};
  const client=new ChatGPTClient({accountStore:{async getActiveAccount(){return account;}},fetchImpl:async(url)=>{
    if(url.endsWith("/models"))return {ok:true,json:async()=>({models:[{visibility:"list",slug:"crlf-model",display_name:"CRLF Model"}]})};
    if(url.endsWith("/responses"))return {ok:true,body:new ReadableStream({start(controller){
      const encoder=new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"split"}\r'));
      controller.enqueue(encoder.encode('\n\r'));
      controller.enqueue(encoder.encode('\ndata: {"type":"response.completed"}\r'));
      controller.enqueue(encoder.encode('\n\r\n'));
      controller.close();
    }})};
    throw new Error("Unexpected URL");
  }});
  const result=await client.generate({prompt:"test",model:"crlf-model"});
  assert.equal(result.text,"split");
});
