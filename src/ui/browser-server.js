import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const MAX_BODY = 1024 * 1024;
const HTML = `<!doctype html><html lang="my"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Coding Agent</title><style>
:root{color-scheme:dark}body{font:16px system-ui;max-width:850px;margin:20px auto;padding:0 14px;background:#101522;color:#eef}input,textarea,select,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #596078;background:#202a3d;color:#fff;width:100%;box-sizing:border-box;margin:6px 0}button{background:#315bd6;border:0}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#202a3d;padding:12px;border-radius:8px}small{color:#b9c4dc}.panel{border:1px solid #39445d;border-radius:12px;padding:12px;margin:12px 0}h1{font-size:25px}label{display:block;margin-top:10px}
</style><h1>AI Coding Agent</h1><p><small>ChatGPT Account Login · Account ပြောင်းလဲနိုင်သည် · Code ပြောင်းလဲမှုကို အတည်ပြုပြီးမှသာ Apply လုပ်မည်</small></p>
<section class="panel"><h2>ChatGPT Accounts</h2><label>App Access Token<input id="token" type="password" autocomplete="off"></label><button id="login">Continue with ChatGPT</button><button id="refreshAccounts">Account စာရင်းပြန်စစ်ရန်</button><div id="accounts"></div><button id="switch">ရွေးထားသော Account သို့ပြောင်းရန်</button><button id="reconnect">ရွေးထားသော Account ကို ပြန်ချိတ်ရန်</button><label>Transfer Passphrase (အနည်းဆုံး 16 လုံး)<input id="transferPass" type="password" autocomplete="new-password"></label><button id="exportBundle">ရွေးထားသော Account ကို Encrypted File အဖြစ် Export လုပ်ရန်</button><label>Encrypted Credential File<input id="importFile" type="file" accept="application/json,.json"></label><button id="importBundle">Credential File ကို Import လုပ်ရန်</button><label>Model<select id="model"><option value="">Account ရွေးပြီး Model စစ်ပါ</option></select></label><p id="authNote"><small>မှတ်ချက် — ChatGPT Plan OAuth သည် OpenAI ၏ official local-hosted loopback flow ကို လိုအပ်သည်။ Remote hosted server တွင် ခွင့်ပြုချက်မရှိဘဲ Login အလုပ်လုပ်မည်ဟု မပြသပါ။</small></p></section>
<section class="panel"><h2>Coding Task</h2><label>လုပ်စေလိုသောအလုပ်<textarea id="task" rows="4" placeholder="Code ပြောင်းလဲစေလိုသောအလုပ်ကို ရေးပါ"></textarea></label><button id="plan">Code အဆိုပြုချက် ဖန်တီးရန်</button><button id="apply" hidden>အတည်ပြု၊ ပြောင်းလဲမှု Apply + Test</button></section>
<section class="panel"><h2>Agent Status</h2><button id="refreshStatus">အခြေအနေစစ်ရန်</button><pre id="output">Access Token ထည့်ပြီး စတင်ပါ။</pre></section>
<script>
const $=id=>document.getElementById(id);let pendingTask=null,selectedId=null;
async function api(path,body,method){const r=await fetch('/api/'+path,{method:method||(body?'POST':'GET'),headers:{'authorization':'Bearer '+$('token').value,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data={error:raw}}if(!r.ok)throw Error(data.error||'Request failed');return data}
function show(value){$('output').textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
async function loadAccounts(){const data=await api('chatgpt/accounts');$('accounts').innerHTML='';selectedId=null;if(!data.length){$('accounts').textContent='ChatGPT Account မချိတ်ဆက်ရသေးပါ။';return}for(const a of data){const row=document.createElement('div');const radio=document.createElement('input');radio.type='radio';radio.name='account';radio.value=a.id;radio.checked=a.isActive;radio.style.width='auto';radio.addEventListener('change',()=>selectedId=a.id);row.append(radio,document.createTextNode(' '+a.email+(a.planUsageEnabled?' · Plan usage enabled':' · Login only')+(a.needsReauth?' · Reconnect required':'')));const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.style.width='auto';remove.addEventListener('click',async()=>{try{const result=await api('chatgpt/accounts/'+encodeURIComponent(a.id),null,'DELETE');await loadAccounts();show(result.remoteRevocationConfirmed?'Account removed and remote session revoked.':'Account removed locally; remote revocation was not confirmed. Disconnect it in ChatGPT Settings if needed.')}catch(e){show(e.message)}});row.append(remove);$('accounts').append(row);if(a.isActive)selectedId=a.id}}
$('login').onclick=async()=>{try{const result=await api('chatgpt/login',{});location.href=result.authorizationUrl}catch(e){show(e.message)}};
$('reconnect').onclick=async()=>{try{if(!selectedId)throw Error('ပြန်ချိတ်မည့် Account ကိုရွေးပါ။');const result=await api('chatgpt/login',{accountId:selectedId});location.href=result.authorizationUrl}catch(e){show(e.message)}};
$('exportBundle').onclick=async()=>{try{if(!selectedId)throw Error('Export လုပ်မည့် Account ကိုရွေးပါ။');const passphrase=$('transferPass').value;if(passphrase.length<16)throw Error('Passphrase အနည်းဆုံး 16 လုံးထည့်ပါ။');const bundle=await api('chatgpt/accounts/'+encodeURIComponent(selectedId)+'/export',{passphrase});const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='chatgpt-credential-transfer.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);show('Encrypted credential file ကို သိမ်းဆည်းရန် စတင်လိုက်ပါပြီ။ File နှင့် passphrase ကို သီးခြားလုံခြုံစွာထားပါ။')}catch(e){show(e.message)}};
$('importBundle').onclick=async()=>{try{const file=$('importFile').files[0];if(!file)throw Error('Encrypted credential file ကိုရွေးပါ။');const passphrase=$('transferPass').value;if(passphrase.length<16)throw Error('Passphrase အနည်းဆုံး 16 လုံးထည့်ပါ။');const bundle=JSON.parse(await file.text());const result=await api('chatgpt/credentials/import',{bundle,passphrase});selectedId=result.account.id;$('model').innerHTML='';for(const m of result.models||[]){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;$('model').append(o)}await loadAccounts();show(result)}catch(e){show(e.message)}};
$('refreshAccounts').onclick=async()=>{try{await loadAccounts();show('Account စာရင်းပြန်စစ်ပြီးပါပြီ။')}catch(e){show(e.message)}};
$('switch').onclick=async()=>{try{if(!selectedId)throw Error('Account တစ်ခုရွေးပါ။');const result=await api('chatgpt/accounts/select',{id:selectedId});$('model').innerHTML='';for(const m of result.models){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;$('model').append(o)}await loadAccounts();show({account:result.account,models:result.models.length,endpoint:'https://api.openai.com/v1'})}catch(e){show(e.message)}};
$('plan').onclick=async()=>{try{const p=await api('proposals',{task:$('task').value,model:$('model').value});pendingTask=p.taskId;$('apply').hidden=false;show(p)}catch(e){show(e.message)}};
$('apply').onclick=async()=>{try{const r=await api('tasks/'+encodeURIComponent(pendingTask)+'/approve-execute',{});$('apply').hidden=true;show(r)}catch(e){show(e.message)}};
$('refreshStatus').onclick=async()=>{try{show(await api('status'))}catch(e){show(e.message)}};
</script></html>`;

function safeEqual(a,b){const x=Buffer.from(a||"");const y=Buffer.from(b||"");return x.length===y.length&&timingSafeEqual(x,y);}
async function readBody(request,maxBytes=MAX_BODY){let body="";for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>maxBytes)throw new Error("Request body too large.");}if(!body)return {};const parsed=JSON.parse(body);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("JSON body must be an object.");return parsed;}

export function createBrowserServer({agent,projectManager,accountStore,chatgptOAuth,providerClient,codingEngine,token=process.env.AI_AGENT_ACCESS_TOKEN,host="127.0.0.1",port=8787}){
 if(!agent||typeof token!=="string"||token.length<32)throw new Error("AI_AGENT_ACCESS_TOKEN must be configured with at least 32 characters.");
 const server=http.createServer(async(request,response)=>{
  response.setHeader("x-content-type-options","nosniff");response.setHeader("cache-control","no-store");response.setHeader("referrer-policy","no-referrer");
  const url=new URL(request.url,"http://localhost");
  if(request.method==="GET"&&url.pathname==="/"){response.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});response.end(HTML);return;}
  if(request.method==="GET"&&url.pathname==="/auth/openai/callback"){
   try{
    if(host!=="127.0.0.1")throw new Error("ChatGPT plan OAuth is available only when the agent is running locally with the official 127.0.0.1 loopback callback.");
    if(!chatgptOAuth)throw new Error("Configure AI_AGENT_VAULT_KEY before connecting ChatGPT.");
    providerClient?.cancelActiveRequests();
    const account=await chatgptOAuth.handleCallback(url.href);
    response.writeHead(200,{"content-type":"text/html; charset=utf-8"});response.end("<!doctype html><meta charset=utf-8><title>ChatGPT connected</title><h2>ChatGPT account connected</h2><p>ChatGPT account ချိတ်ဆက်ပြီးပါပြီ။</p><p><a href="/">AI Coding Agent သို့ပြန်သွားရန်</a></p>");
   }catch(error){response.writeHead(400,{"content-type":"text/plain; charset=utf-8"});response.end(error instanceof Error?error.message:"ChatGPT sign-in failed.");}
   return;
  }
  if(!url.pathname.startsWith("/api/")){response.writeHead(404);response.end();return;}
  const supplied=request.headers.authorization?.startsWith("Bearer ")?request.headers.authorization.slice(7):"";
  if(!safeEqual(supplied,token)){response.writeHead(401,{"content-type":"application/json"});response.end(JSON.stringify({error:"Unauthorized"}));return;}
  try{
   let result;
   if(request.method==="GET"&&url.pathname==="/api/status")result={status:agent.getStatus(),tasks:agent.getTaskSummary(),tools:agent.getTools(),chatgptAccounts:await accountStore?.listAccounts?.()??[]};
   else if(request.method==="GET"&&url.pathname==="/api/tasks")result=agent.getTasks();
   else if(request.method==="GET"&&url.pathname==="/api/projects")result=await projectManager?.list?.()??[];
   else if(request.method==="GET"&&url.pathname==="/api/chatgpt/accounts")result=await accountStore?.listAccounts?.()??[];
   else if(request.method==="POST"&&url.pathname==="/api/chatgpt/login"){
    if(host!=="127.0.0.1")throw new Error("Remote-hosted ChatGPT plan OAuth requires OpenAI approval. The official open-source flow requires a local 127.0.0.1 callback.");
    if(!chatgptOAuth)throw new Error("Configure AI_AGENT_VAULT_KEY before connecting ChatGPT.");
    const address=server.address();if(!address||typeof address==="string")throw new Error("Local callback listener is not ready.");
    const body=await readBody(request);
    result=await chatgptOAuth.beginLogin({redirectUri:"http://127.0.0.1:"+address.port+"/auth/openai/callback",existingAccountId:body.accountId||null});
   }
   else if(request.method==="POST"&&url.pathname==="/api/chatgpt/accounts/select"){
    const body=await readBody(request);providerClient?.cancelActiveRequests();const account=await accountStore.selectAccount(body.id);const models=await providerClient.listModels();result={account,models,endpoint:"https://api.openai.com/v1"};
   }
   else if(request.method==="GET"&&url.pathname==="/api/chatgpt/models")result=await providerClient.listModels();
   else if(request.method==="POST"&&/^\/api\/chatgpt\/accounts\/[^/]+\/export$/.test(url.pathname)){
    if(!accountStore)throw new Error("Configure AI_AGENT_VAULT_KEY before exporting ChatGPT credentials.");
    const body=await readBody(request);const id=decodeURIComponent(url.pathname.split("/")[4]);result=await accountStore.exportCredentialBundle(id,body.passphrase);
   }
   else if(request.method==="POST"&&url.pathname==="/api/chatgpt/credentials/import"){
    if(!chatgptOAuth)throw new Error("Configure AI_AGENT_VAULT_KEY before importing ChatGPT credentials.");
    const body=await readBody(request,2*1024*1024);providerClient?.cancelActiveRequests();const account=await chatgptOAuth.importCredentialBundle(body.bundle,body.passphrase);
    let models=[],modelsError=null;try{models=await providerClient.listModels();}catch(error){modelsError=error instanceof Error?error.message:"Model discovery failed.";}
    result={account,models,modelsError,endpoint:"https://api.openai.com/v1"};
   }
   else if(request.method==="DELETE"&&url.pathname.startsWith("/api/chatgpt/accounts/")){const id=decodeURIComponent(url.pathname.slice("/api/chatgpt/accounts/".length));providerClient?.cancelActiveRequests();result=chatgptOAuth?await chatgptOAuth.revokeAccount(id):{removed:await accountStore.removeAccount(id),remoteRevocationConfirmed:false};}
   else if(request.method==="POST"&&url.pathname==="/api/proposals")result=await codingEngine.createProposal(await readBody(request));
   else if(request.method==="POST"&&/^\/api\/tasks\/[^/]+\/approve-execute$/.test(url.pathname)){
    await readBody(request);const taskId=decodeURIComponent(url.pathname.split("/")[3]);const record=agent.getTask(taskId);const changes=record?.result?.proposedChanges;
    if(!Array.isArray(changes)||!changes.length)throw new Error("No pending coding proposal.");
    const tokens=[];for(const change of changes){const approvalRequest=agent.requestToolApproval("workspace.write",change);tokens.push(agent.approveToolRequest(approvalRequest.requestId));}
    const testRequest=agent.requestToolApproval("workspace.test",{});const testToken=agent.approveToolRequest(testRequest.requestId);
    result=await codingEngine.executeApproved({taskId,approvalTokens:tokens,testApprovalToken:testToken});
   }
   else{response.writeHead(404,{"content-type":"application/json"});response.end(JSON.stringify({error:"Not found"}));return;}
   response.writeHead(200,{"content-type":"application/json; charset=utf-8"});response.end(JSON.stringify(result));
  }catch(error){response.writeHead(400,{"content-type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:error instanceof Error?error.message:"Request failed"}));}
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,host,()=>resolve(server.address()));}),close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
