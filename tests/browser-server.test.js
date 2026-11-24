import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserServer } from "../src/ui/browser-server.js";
test("browser server requires a strong bearer token and protects API routes",async()=>{
 const agent={getStatus:()=>"INITIALIZED",getTaskSummary:()=>({total:0}),getTools:()=>[],getTasks:()=>[]};
 assert.throws(()=>createBrowserServer({agent,token:"short"}),/at least 32/);
 const app=createBrowserServer({agent,token:"test-access-token-with-at-least-32-chars",port:0});
 const address=await app.listen();
 try{
  const base=`http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base+"/api/status")).status,401);
  const allowed=await fetch(base+"/api/status",{headers:{authorization:"Bearer test-access-token-with-at-least-32-chars"}});
  assert.equal(allowed.status,200);assert.equal((await allowed.json()).status,"INITIALIZED");
  assert.match(await (await fetch(base+"/")).text(),/AI Coding Agent/);
 }finally{await app.close();}
});
