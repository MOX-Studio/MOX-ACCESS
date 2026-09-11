// Real requests through the local MVP, using a freshly issued employee key.
// This client never reads the operator's OpenAI profile or credentials.
import { spawn,execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,rm,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
if(!process.argv.includes('--revoked-only')&&!process.stdin.isTTY)throw new Error('Run the full verification in an interactive terminal so Dashboard revocation can be confirmed.');
const keyFile=option('--key-file');if(!keyFile)throw new Error('Provide --key-file for the issued MOX employee key.');
const info=await lstat(keyFile);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw new Error('Employee key file must be private (0600).');
const key=(await readFile(keyFile,'utf8')).trim();if(!/^mox_[0-9a-f]{64}$/.test(key))throw new Error('Invalid MOX employee key format.');
const baseUrl=option('--base-url')||'http://127.0.0.1:4174/v1',target=new URL(baseUrl);
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.search||target.hash)throw new Error('This verification client only accepts a local loopback gateway.');
const binary=option('--codex')||'/Applications/ChatGPT.app/Contents/Resources/codex';
const version=execFileSync(binary,['--version'],{encoding:'utf8'}).trim();
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true,mode:0o700});
const root=await mkdtemp(join(tmpdir(),'mox-mvp-client-')),profile=join(root,'profile'),workspace=join(root,'workspace');
await mkdir(profile,{mode:0o700});await mkdir(workspace,{mode:0o700});
await writeFile(join(workspace,'probe-input.txt'),'Compute 19 + 23.\n',{mode:0o600});
await writeFile(join(profile,'config.toml'),[
  'model = "gpt-5.6-luna"','model_provider = "mox"','approval_policy = "never"',
  'sandbox_mode = "workspace-write"','web_search = "disabled"','check_for_update_on_startup = false',
  'cli_auth_credentials_store = "file"','model_reasoning_effort = "low"',
  '[analytics]','enabled = false','[features]','apps = false','remote_plugin = false',
  'hooks = false','multi_agent = false','memories = false','shell_snapshot = false','fast_mode = true',
  '[model_providers.mox]','name = "MOX local MVP"','base_url = "'+baseUrl+'"',
  'env_key = "MOX_ACCESS_KEY"','wire_api = "responses"','requires_openai_auth = false',
  'supports_websockets = false','request_max_retries = 0','stream_max_retries = 0'
].join('\n'),{mode:0o600});
const env={};for(const name of ['PATH','HOME','USER','SHELL','TMPDIR','LANG'])if(process.env[name])env[name]=process.env[name];
env.CODEX_HOME=profile;env.MOX_ACCESS_KEY=key;
const child=spawn(binary,['app-server','--stdio'],{cwd:workspace,env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
let nextId=0,toolItems=0;const pending=new Map(),finished=new Map(),waiters=new Map();
const lines=createInterface({input:child.stdout});
function rejectPending(){for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('codex_stopped'));}pending.clear();for(const task of waiters.values()){clearTimeout(task.timer);task.reject(new Error('codex_stopped'));}waiters.clear();}
child.on('error',rejectPending);child.on('exit',rejectPending);
lines.on('line',line=>{
  let event;try{event=JSON.parse(line);}catch{return;}
  const task=pending.get(event.id);
  if(task){pending.delete(event.id);clearTimeout(task.timer);event.error?task.reject(new Error('codex_rpc_failed')):task.resolve(event.result);}
  else if(event.method==='turn/completed'){
    const turn=event.params.turn;const message=String(turn.error?.message||'');const known=message.match(/client_session_id_required|invalid_api_key|no_available_connections|subscription_requires_login|subscription_paused|subscription_quota_reached|upstream_rejected|streaming_required|unexpected_provider_response|invalid_json|gateway_failed|response_not_owned|accounting_unavailable/);finished.set(turn.id,{status:turn.status,...(turn.error?{errorCode:known?.[0]||'native_turn_failed',errorFields:Object.keys(turn.error),nativeInfoType:typeof turn.error.codexErrorInfo==='string'?turn.error.codexErrorInfo:Object.keys(turn.error.codexErrorInfo||{})}: {})});const task=waiters.get(turn.id);
    if(task){clearTimeout(task.timer);waiters.delete(turn.id);task.resolve(finished.get(turn.id));}
  }else if(event.method==='item/completed'&&['commandExecution','fileChange','codeExecution'].includes(event.params?.item?.type))toolItems++;
});
function rpc(method,params={}){return new Promise((resolve,reject)=>{
  const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('codex_rpc_timeout'));},30000);
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
});}
function waitTurn(id){if(finished.has(id))return Promise.resolve(finished.get(id));return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{waiters.delete(id);reject(new Error('codex_turn_timeout'));},180000);waiters.set(id,{resolve,reject,timer});
});}
const revokedOnly=process.argv.includes('--revoked-only');
const report={version,baseUrl,mode:revokedOnly?'revoked-only':'full',realSubscriptionRequests:!revokedOnly,desktopWindowTested:false,stages:[],passed:false};
try{
  await rpc('initialize',{clientInfo:{name:'mox_mvp_verification',version:'0.5.0'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const {thread}=await rpc('thread/start',{cwd:workspace,model:'gpt-5.6-luna',modelProvider:'mox',approvalPolicy:'never',sandbox:'workspace-write'});
  if(!revokedOnly){
  const first=await rpc('turn/start',{threadId:thread.id,serviceTier:'default',input:[{type:'text',text:'Read probe-input.txt with a local tool. Create probe-output.txt with only the numeric answer and a newline. Do not read or modify other files. Reply DONE.'}]});
  const result=await waitTurn(first.turn.id);let fileCorrect=false;try{fileCorrect=(await readFile(join(workspace,'probe-output.txt'),'utf8')).trim()==='42';}catch{}
  report.stages.push({name:'coding_task',...result,fileCorrect,toolItems});console.log(JSON.stringify(report.stages.at(-1)));
  if(result.status!=='completed'||!fileCorrect||!toolItems)throw new Error('coding_task_not_verified');
  const fast=await rpc('turn/start',{threadId:thread.id,serviceTier:'priority',input:[{type:'text',text:'Reply exactly MOX_FAST_CHECK. Do not use tools.'}]}),fastResult=await waitTurn(fast.turn.id);
  report.stages.push({name:'requested_fast',status:fastResult.status});console.log(JSON.stringify(report.stages.at(-1)));
  if(fastResult.status!=='completed')throw new Error('fast_request_not_verified');
  await writeFile(new URL('../artifacts/mvp-live-codex-progress.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({stage:'awaiting_dashboard_revocation',instruction:'Revoke this employee key through the Dashboard, then write revoked to stdin.'}));
  await new Promise((resolve,reject)=>{
    const input=createInterface({input:process.stdin}),timer=setTimeout(()=>{input.close();reject(new Error('revocation_confirmation_timeout'));},15*60000);
    input.on('line',line=>{if(line.trim()==='revoked'){clearTimeout(timer);input.close();resolve();}});
  });
  }
  const denied=await fetch(baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',session_id:thread.id},body:JSON.stringify({stream:true,model:'gpt-5.6-luna',input:[]}),signal:AbortSignal.timeout(10000)});
  let deniedCode;try{deniedCode=(await denied.json()).error?.code;}catch{}
  report.stages.push({name:'revoked_http',status:denied.status,code:deniedCode});
  const after=await rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:'Reply OK. Do not use tools.'}]}),afterResult=await waitTurn(after.turn.id);
  report.stages.push({name:'revoked_codex_turn',status:afterResult.status});
  report.passed=denied.status===401&&deniedCode==='invalid_api_key'&&afterResult.status==='failed';
}catch(error){report.error=/^[a-z_]+$/.test(error.message)?error.message:'verification_failed';}
finally{
  if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),4000);await exited;clearTimeout(timer);}
  lines.close();await rm(root,{recursive:true,force:true});
}
await writeFile(new URL(revokedOnly?'../artifacts/mvp-revoked-codex.json':'../artifacts/mvp-live-codex.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
