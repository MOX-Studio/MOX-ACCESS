// One managed Codex process per private MOX profile. No operator-profile import.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { loginDiagnostic } from './login-diagnostics.mjs';
const safeError=code=>new Error(code);
export async function profileCredentials(profile){
  let stored;
  try{const path=join(profile,'auth.json'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw safeError('invalid_auth_file');await chmod(path,0o600);stored=JSON.parse(await readFile(path,'utf8'));}
  catch{throw safeError('managed_credentials_unavailable');}
  const {access_token:accessToken,account_id:accountId,id_token:idToken}=stored.tokens||{};
  if(typeof accessToken!=='string'||!accessToken||typeof accountId!=='string'||!accountId)throw safeError('managed_credentials_missing');
  let claims,accessClaims;
  try{claims=JSON.parse(Buffer.from(idToken.split('.')[1],'base64url'));accessClaims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url'));}catch{throw safeError('managed_identity_unavailable');}
  const auth=claims['https://api.openai.com/auth']||{};
  if(typeof auth.chatgpt_account_id==='string'&&auth.chatgpt_account_id!==accountId)throw safeError('managed_identity_mismatch');
  const userId=auth.chatgpt_user_id||claims.sub;
  if(typeof userId!=='string'||!userId)throw safeError('managed_identity_unavailable');
  return {accessToken,accountId,userId,expiresAt:Number(accessClaims.exp||0)*1000};
}
export class CodexAccount extends EventEmitter {
  constructor(binary,profile,expected=null){super();this.binary=binary;this.profile=profile;this.expected=expected;this.pending=new Map();this.nextId=0;this.state={status:'starting'};this.diagnostics=[];}
  diagnostic(phase,error){this.diagnostics.push(loginDiagnostic(phase,error));if(this.diagnostics.length>20)this.diagnostics.shift();}
  async start(){
    try{
      this.assertOpen();await mkdir(this.profile,{recursive:true,mode:0o700});this.assertOpen();await chmod(this.profile,0o700);this.assertOpen();
      await writeFile(join(this.profile,'config.toml'),['cli_auth_credentials_store = "file"','check_for_update_on_startup = false','[analytics]','enabled = false','[features]','apps = false','remote_plugin = false','hooks = false'].join('\n'),{mode:0o600});
      this.assertOpen();const env={};for(const name of ['PATH','HOME','USER','SHELL','TMPDIR','LANG','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','CODEX_CA_CERTIFICATE','SSL_CERT_FILE'])if(process.env[name])env[name]=process.env[name];env.CODEX_HOME=this.profile;
      this.child=spawn(this.binary,['app-server','--stdio'],{cwd:this.profile,env,stdio:['pipe','pipe','pipe']});
      this.child.stderr.on('data',chunk=>{const text=chunk.toString('utf8');if(/\bERROR\b|invalid_grant|text\/html|timed out|certificate/i.test(text))this.diagnostic('native_process',text);});
      this.child.on('error',()=>this.fail('codex_start_failed'));this.child.on('exit',()=>this.fail('codex_stopped'));
      this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{
        let event;try{event=JSON.parse(line);}catch{return;}
        const task=this.pending.get(event.id);
        if(task){this.pending.delete(event.id);clearTimeout(task.timer);if(event.error){this.diagnostic(task.method,event.error);task.reject(safeError(/device.*(?:not enabled|disabled)|enable.*device/i.test(String(event.error.message))?'device_login_disabled':'codex_rpc_failed'));}else task.resolve(event.result);}
        else if(event.method==='account/login/completed'){if(this.state.status==='starting_login'){this.earlyCompletion??=[];if(this.earlyCompletion.length<8)this.earlyCompletion.push(event.params);}else void this.completed(event.params).catch(()=>this.fail('account_verification_failed'));}
      });
      await this.rpc('initialize',{clientInfo:{name:'mox_access_local',version:'0.5.0'}});this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
      const current=await this.rpc('account/read',{refreshToken:false});
      if(current.account?.type==='chatgpt'){await this.verify(current.account);}
      else this.state={status:'signed_out'};
      return this;
    }catch(error){await this.close();throw safeError(error.message==='codex_start_failed'?'codex_start_failed':'account_start_failed');}
  }
  assertOpen(){if(this.closing||this.state.status==='cancelled')throw safeError('account_closed');}
  rpc(method,params={}){
    return new Promise((resolve,reject)=>{
      if(!this.child||this.closing||this.child.exitCode!==null||this.child.signalCode!==null)return reject(safeError('codex_unavailable'));
      const id=++this.nextId,timer=setTimeout(()=>{this.pending.delete(id);this.diagnostic(method,'timeout');reject(safeError('codex_rpc_timeout'));},30000);this.pending.set(id,{resolve,reject,timer,method});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  async verify(account){
    const credentials=await profileCredentials(this.profile);
    if(this.expected&&(this.expected.accountId!==credentials.accountId||this.expected.userId!==credentials.userId))throw safeError('wrong_account');
    this.assertOpen();this.expected={accountId:credentials.accountId,userId:credentials.userId};
    this.identity={...this.expected,email:account.email??null,planType:account.planType??null};
    this.state={status:'connected',account:{email:this.identity.email,planType:this.identity.planType}};
  }
  async login(method='browser'){
    if(this.state.status==='waiting')return this.state;
    this.state={status:'starting_login'};
    this.earlyCompletion=[];
    const result=await this.rpc('account/login/start',method==='device'?{type:'chatgptDeviceCode'}:{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'codex'});
    this.assertOpen();const authUrl=result.authUrl||result.verificationUrl;
    if(!result.loginId||!authUrl||(method==='device'&&!result.userCode))throw safeError('browser_login_unavailable');
    const url=new URL(authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname))throw safeError('invalid_auth_url');
    this.state={status:'waiting',loginId:result.loginId,authUrl,userCode:result.userCode||null};
    const waiting={...this.state},early=this.earlyCompletion;this.earlyCompletion=[];
    for(const event of early)if(event?.loginId===result.loginId)queueMicrotask(()=>void this.completed(event).catch(()=>this.fail('account_verification_failed')));
    return waiting;
  }
  async completed(event){
    if(event?.loginId!==this.state.loginId||this.state.status!=='waiting'||this.closing)return;
    if(!event.success){this.diagnostic('account/login/completed',event.error);return this.fail('login_failed');}this.state={status:'verifying'};
    try{const result=await this.rpc('account/read',{refreshToken:false});if(result.account?.type!=='chatgpt')throw safeError('subscription_login_required');await this.verify(result.account);this.emit('state',this.state);}
    catch(error){this.diagnostic('account_verification',error);this.fail(error.message==='wrong_account'?'wrong_account':'account_verification_failed');}
  }
  async rateLimits(){
    const result=await this.rpc('account/rateLimits/read');
    if(result.accountId&&result.accountId!==this.expected?.accountId)throw safeError('wrong_account');
    const window=value=>value&&Number.isFinite(value.usedPercent)?{usedPercent:value.usedPercent,resetsAt:Number.isFinite(value.resetsAt)?value.resetsAt:null,windowDurationMins:Number.isFinite(value.windowDurationMins)?value.windowDurationMins:null}:null;
    const bucket=(value,id=null)=>({limitId:typeof value?.limitId==='string'?value.limitId:id,limitName:typeof value?.limitName==='string'?value.limitName:null,primary:window(value?.primary),secondary:window(value?.secondary)});
    return {checkedAt:Date.now(),...bucket(result.rateLimits),buckets:Object.entries(result.rateLimitsByLimitId||{}).map(([id,value])=>bucket(value,id))};
  }
  async credentials(){
    let credentials=await profileCredentials(this.profile);
    if(!this.expected||credentials.accountId!==this.expected.accountId||credentials.userId!==this.expected.userId)throw safeError('wrong_account');
    if(credentials.expiresAt<Date.now()+60000){
      if(!this.refreshing)this.refreshing=this.rpc('account/read',{refreshToken:true}).finally(()=>{this.refreshing=null;});
      await this.refreshing;credentials=await profileCredentials(this.profile);
      if(credentials.accountId!==this.expected.accountId||credentials.userId!==this.expected.userId)throw safeError('wrong_account');
    }
    return credentials;
  }
  fail(code){for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(safeError(code));}this.pending.clear();if(this.closing)return;this.state={status:'failed',code};this.emit('state',this.state);}
  async cancel(){const id=this.state.loginId;this.state={status:'cancelled'};if(id)try{await this.rpc('account/login/cancel',{loginId:id});}catch{}}
  close(){if(!this.closeTask)this.closeTask=this.closeProcess();return this.closeTask;}
  async closeProcess(){
    this.closing=true;this.fail('account_closed');
    if(this.child&&this.child.exitCode===null&&this.child.signalCode===null){const done=new Promise(resolve=>this.child.once('exit',resolve));this.child.kill('SIGTERM');const timer=setTimeout(()=>this.child.kill('SIGKILL'),4000);await done;clearTimeout(timer);}
    this.lines?.close();
  }
}
