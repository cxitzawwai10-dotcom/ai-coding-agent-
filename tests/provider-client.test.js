import test from "node:test";
import assert from "node:assert/strict";
import { ProviderClient } from "../src/providers/provider-client.js";

test("Gemini adapter sends key in header and returns generated text",async()=>{
 let captured;
 const vault={async getActiveAccount(){return {id:"a",provider:"gemini",apiKey:"secret-gemini-key"};}};
 const client=new ProviderClient({accountVault:vault,fetchImpl:async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:"hello"}]}}]})};}});
 const result=await client.generate({prompt:"hi"});
 assert.equal(result.text,"hello");assert.match(captured.url,/generativelanguage.googleapis.com/);
 assert.equal(captured.options.headers["x-goog-api-key"],"secret-gemini-key");
});

test("OpenAI adapter uses the official Responses endpoint",async()=>{
 let captured;
 const vault={async getActiveAccount(){return {id:"a",provider:"openai",apiKey:"secret-openai-key"};}};
 const client=new ProviderClient({accountVault:vault,fetchImpl:async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({output:[{content:[{type:"output_text",text:"done"}]}]})};}});
 const result=await client.generate({prompt:"write code"});
 assert.equal(result.text,"done");assert.equal(captured.url,"https://api.openai.com/v1/responses");
 assert.equal(captured.options.headers.authorization,"Bearer secret-openai-key");
});

test("provider errors never include response bodies or API keys",async()=>{
 const vault={async getActiveAccount(){return {id:"a",provider:"gemini",apiKey:"secret-key"};}};
 const client=new ProviderClient({accountVault:vault,fetchImpl:async()=>({ok:false,status:500,json:async()=>({message:"secret-key private response"})})});
 await assert.rejects(client.generate({prompt:"hi"}),error=>{assert.equal(error.message,"Gemini request failed (HTTP 500).");return true;});
});
