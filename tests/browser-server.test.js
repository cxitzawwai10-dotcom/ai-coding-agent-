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
