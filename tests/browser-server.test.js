import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserServer } from "../src/ui/browser-server.js";

test("browser server requires a strong bearer token and protects API routes", async () => {
  const agent = { getStatus: () => "INITIALIZED", getTaskSummary: () => ({ total: 0 }), getTools: () => [], getTasks: () => [] };
  assert.throws(() => createBrowserServer({ agent, token: "short" }), /at least 32/);
  const app = createBrowserServer({ agent, token: "test-access-token-with-at-least-32-chars", port: 0 });
  const address = await app.listen();
  try {
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + "/api/status")).status, 401);
    const allowed = await fetch(base + "/api/status", { headers: { authorization: "Bearer test-access-token-with-at-least-32-chars" } });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).status, "INITIALIZED");
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /Continue with ChatGPT/);
    assert.doesNotMatch(html, /API key|Gemini/);
  } finally { await app.close(); }
});

test("account switching cancels active requests and refreshes models on the fixed API base", async () => {
  const calls = [];
  const agent = { getStatus: () => "INITIALIZED", getTaskSummary: () => ({ total: 0 }), getTools: () => [], getTasks: () => [] };
  const accountStore = { async listAccounts(){return [{id:"a",email:"a@example.test",isActive:true,planUsageEnabled:true}];}, async selectAccount(id){calls.push(["select",id]);return {id,email:"a@example.test"};} };
  const providerClient = { cancelActiveRequests(){calls.push(["cancel"]);}, async listModels(){calls.push(["models"]);return [{id:"m",name:"Model"}] } };
  const app = createBrowserServer({ agent, accountStore, providerClient, token: "test-access-token-with-at-least-32-chars", port: 0 });
  const address = await app.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chatgpt/accounts/select`, { method:"POST", headers:{authorization:"Bearer test-access-token-with-at-least-32-chars","content-type":"application/json"}, body:JSON.stringify({id:"a"}) });
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.endpoint,"https://api.openai.com/v1");
    assert.equal(data.models[0].id,"m");
    assert.deepEqual(calls,[["cancel"],["select","a"],["models"]]);
  } finally { await app.close(); }
});

test("OAuth callback is reconstructed with the exact 127.0.0.1 listener port", async () => {
  const token="browser-callback-token-with-more-than-32-characters";
  let receivedUrl=null, cancelled=0;
  const agent={getStatus:()=>"INITIALIZED",getTaskSummary:()=>({total:0}),getTools:()=>[],getTasks:()=>[]};
  const chatgptOAuth={async handleCallback(value){receivedUrl=value;return {id:"connected"};}};
  const providerClient={cancelActiveRequests(){cancelled++;}};
  const app=createBrowserServer({agent,chatgptOAuth,providerClient,token,port:0});
  const address=await app.listen();
  try{
    const response=await fetch("http://127.0.0.1:"+address.port+"/auth/openai/callback?state=callback-state");
    assert.equal(response.status,200);
    const callback=new URL(receivedUrl);
    assert.equal(callback.protocol,"http:");
    assert.equal(callback.hostname,"127.0.0.1");
    assert.equal(callback.port,String(address.port));
    assert.equal(callback.pathname,"/auth/openai/callback");
    assert.equal(callback.searchParams.get("state"),"callback-state");
    assert.equal(cancelled,1);
  }finally{await app.close();}
});

test("browser API supports encrypted credential export and host-bound import", async () => {
  const calls=[];
  const token="browser-api-token-with-more-than-32-characters";
  const accountStore={
    async exportCredentialBundle(id,passphrase){calls.push(["export",id,passphrase]);return {version:1,ciphertext:"encrypted"};}
  };
  const chatgptOAuth={
    async importCredentialBundle(bundle,passphrase){calls.push(["import",bundle,passphrase]);return {id:"imported",email:"person@example.test"};}
  };
  const providerClient={async listModels(){return [{id:"model-1",name:"Model 1"}];}};
  const agent={getStatus:()=>"INITIALIZED",getTaskSummary:()=>({total:0}),getTools:()=>[],getTasks:()=>[]};
  const app=createBrowserServer({agent,accountStore,chatgptOAuth,providerClient,token,port:0});
  const address=await app.listen();
  const base="http://127.0.0.1:"+address.port;
  const headers={authorization:"Bearer "+token,"content-type":"application/json"};
  try{
    const exported=await fetch(base+"/api/chatgpt/accounts/account-1/export",{method:"POST",headers,body:JSON.stringify({passphrase:"long-transfer-passphrase"})});
    assert.equal(exported.status,200);
    assert.deepEqual(await exported.json(),{version:1,ciphertext:"encrypted"});
    const imported=await fetch(base+"/api/chatgpt/credentials/import",{method:"POST",headers,body:JSON.stringify({bundle:{version:1,ciphertext:"encrypted"},passphrase:"long-transfer-passphrase"})});
    assert.equal(imported.status,200);
    const data=await imported.json();
    assert.equal(data.account.id,"imported");
    assert.equal(data.models[0].id,"model-1");
    assert.equal(data.endpoint,"https://api.openai.com/v1");
    assert.deepEqual(calls,[["export","account-1","long-transfer-passphrase"],["import",{version:1,ciphertext:"encrypted"},"long-transfer-passphrase"]]);
  }finally{await app.close();}
});

test("browser API rejects non-JSON bodies and sends browser isolation headers", async () => {
  const token = "browser-security-token-with-more-than-32-characters";
  const agent = { getStatus: () => "INITIALIZED", getTaskSummary: () => ({ total: 0 }), getTools: () => [], getTasks: () => [] };
  const app = createBrowserServer({ agent, token, port: 0 });
  const address = await app.listen();
  try {
    const base = "http://127.0.0.1:" + address.port;
    const page = await fetch(base + "/");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
    const response = await fetch(base + "/api/chatgpt/accounts/select", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "text/plain" },
      body: "{}"
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Content-Type must be application\/json/);
  } finally { await app.close(); }
});
