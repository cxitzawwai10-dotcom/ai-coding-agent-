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
    if (url.endsWith("/responses")) return {ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed"}\n\n'));controller.close();}})};
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
