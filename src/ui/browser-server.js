import http from "node:http";
import { timingSafeEqual } from "node:crypto";
const MAX_BODY = 1024 * 1024;
const HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Coding Agent</title><style>body{font:16px system-ui;max-width:850px;margin:24px auto;padding:0 16px;background:#101522;color:#eef}input,textarea,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #596078;background:#202a3d;color:#fff;width:100%;box-sizing:border-box;margin:6px 0}button{background:#315bd6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#202a3d;padding:12px;border-radius:8px}small{color:#b9c4dc}</style><h1>AI Coding Agent</h1><p><small>Browser control panel · Review proposals before applying changes</small></p><label>Access token<input id="token" type="password" autocomplete="off"></label><label>Task<textarea id="task" rows="4" placeholder="Describe the code change"></textarea></label><button id="plan">Create coding proposal</button><button id="refresh">Refresh status</button><pre id="output">Connect using your access token.</pre><script>const $=id=>document.getElementById(id);async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'authorization':'Bearer '+$('token').value,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();let v;try{v=JSON.parse(t)}catch{v={error:t}}if(!r.ok)throw Error(v.error||'Request failed');return v};$('plan').onclick=async()=>{try{$('output').textContent=JSON.stringify(await api('proposals',{task:$('task').value}),null,2)}catch(e){$('output').textContent=e.message}};$('refresh').onclick=async()=>{try{$('output').textContent=JSON.stringify(await api('status'),null,2)}catch(e){$('output').textContent=e.message}};</script></html>`;
function safeEqual(a,b){const x=Buffer.from(a||"");const y=Buffer.from(b||"");return x.length===y.length&&timingSafeEqual(x,y);}
async function readBody(request){let body="";for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>MAX_BODY)throw new Error("Request body too large.");}if(!body)return {};const parsed=JSON.parse(body);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("JSON body must be an object.");return parsed;}
export function createBrowserServer({agent,projectManager,accountVault,codingEngine,token=process.env.AI_AGENT_ACCESS_TOKEN,host="127.0.0.1",port=8787}){
 if(!agent||typeof token!=="string"||token.length<32)throw new Error("AI_AGENT_ACCESS_TOKEN must be configured with at least 32 characters.");
 const server=http.createServer(async(request,response)=>{
  response.setHeader("x-content-type-options","nosniff");response.setHeader("cache-control","no-store");
  const url=new URL(request.url,"http://localhost");
  if(request.method==="GET"&&url.pathname==="/"){response.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});response.end(HTML);return;}
  if(!url.pathname.startsWith("/api/")){response.writeHead(404);response.end();return;}
  const supplied=request.headers.authorization?.startsWith("Bearer ")?request.headers.authorization.slice(7):"";
  if(!safeEqual(supplied,token)){response.writeHead(401,{"content-type":"application/json"});response.end(JSON.stringify({error:"Unauthorized"}));return;}
  try{
   let result;
   if(request.method==="GET"&&url.pathname==="/api/status")result={status:agent.getStatus(),tasks:agent.getTaskSummary(),tools:agent.getTools()};
   else if(request.method==="GET"&&url.pathname==="/api/tasks")result=agent.getTasks();
   else if(request.method==="GET"&&url.pathname==="/api/projects")result=await projectManager?.list?.()??[];
   else if(request.method==="GET"&&url.pathname==="/api/accounts")result=await accountVault?.listAccounts?.()??[];
   else if(request.method==="POST"&&url.pathname==="/api/accounts")result=await accountVault.addAccount(await readBody(request));
   else if(request.method==="POST"&&url.pathname==="/api/proposals")result=await codingEngine.createProposal(await readBody(request));
   else{response.writeHead(404,{"content-type":"application/json"});response.end(JSON.stringify({error:"Not found"}));return;}
   response.writeHead(200,{"content-type":"application/json; charset=utf-8"});response.end(JSON.stringify(result));
  }catch(error){response.writeHead(400,{"content-type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:error instanceof Error?error.message:"Request failed"}));}
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,host,()=>resolve(server.address()));}),close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
