import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Accounts } from './accounts.mjs';
import { ChromeLogin } from './chrome-login.mjs';
import { createGateway } from './mvp-gateway.mjs';
import { readJson,sendJson } from './http-utils.mjs';
process.umask(0o077);
const here=dirname(fileURLToPath(import.meta.url));
const root=process.env.MOX_DATA_DIR||join(homedir(),'Library','Application Support','MOX ACCESS');
const port=Number(process.env.MOX_PORT||4174);
let binary=process.env.MOX_CODEX_BIN||'/Applications/ChatGPT.app/Contents/Resources/codex';
try{await access(binary);}catch{binary='codex';}
const store=new Store(root),accounts=new Accounts(store,binary),gateway=createGateway(store,accounts),chrome=new ChromeLogin();
for(const connection of store.connections())if(connection.auth==='connected'&&connection.profile)try{await accounts.manager(connection);}catch{}
const origin='http://127.0.0.1:'+port,expectedHost='127.0.0.1:'+port;
let failures={count:0,until:0};
const cookie=req=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('mox_session='))?.slice(12)||'';
const statusFor=code=>code==='not_authenticated'?401:code==='forbidden'?403:code.endsWith('_not_found')?404:['duplicate_email','active_key_exists','duplicate_account','wrong_account','login_in_progress'].includes(code)?409:code==='login_rate_limited'?429:400;
const server=createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!==expectedHost||(req.headers.origin&&req.headers.origin!==origin))return sendJson(res,403,{error:{code:'forbidden'}});
  const url=new URL(req.url,origin),path=url.pathname;
  if(path==='/v1/responses'&&req.method==='POST')return gateway.handle(req,res).catch(()=>sendJson(res,500,{error:{code:'gateway_failed'}}));
  try{
    const session=store.session(cookie(req));
    if(path==='/api/login'&&req.method==='POST'){
      if(req.headers.origin!==origin)throw new Error('forbidden');
      if(failures.until>Date.now()&&failures.count>=5)throw new Error('login_rate_limited');
      const body=await readJson(req,{limit:4096,signal:AbortSignal.timeout(15000)});
      if(!store.passwordValid(body.password)){if(failures.until<Date.now())failures={count:0,until:Date.now()+60000};failures.count++;return sendJson(res,401,{error:{code:'invalid_password'}});}
      failures={count:0,until:0};const created=store.createSession();res.setHeader('set-cookie','mox_session='+created.token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200');return sendJson(res,200,{csrf:created.csrf});
    }
    if(path.startsWith('/api/')){
      if(!session)throw new Error('not_authenticated');
      if(req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-mox-csrf']!==session.csrf))throw new Error('forbidden');
      if(path==='/api/session'&&req.method==='GET')return sendJson(res,200,{csrf:session.csrf,gatewayUrl:origin+'/v1'});
      if(path==='/api/browser'&&req.method==='GET')return sendJson(res,200,await chrome.info());
      if(path==='/api/logout'&&req.method==='POST'){store.logout(cookie(req));res.setHeader('set-cookie','mox_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return sendJson(res,200,{ok:true});}
      if(path==='/api/state'&&req.method==='GET'){accounts.refreshQuotas();return sendJson(res,200,{...store.state(),health:gateway.health()});}
      if(path==='/api/usage'&&req.method==='GET'){const period=url.searchParams.get('period')||'day';if(!['day','week','month'].includes(period))throw new Error('invalid_period');return sendJson(res,200,store.usage(period));}
      if(path==='/api/employees'&&req.method==='POST'){
        const body=await readJson(req,{limit:4096,signal:AbortSignal.timeout(15000)});const employee=store.addEmployee(body.name,body.email);const key=body.issueNow?store.issueKey(employee.id):null;return sendJson(res,201,{employee,key});
      }
      let match=path.match(/^\/api\/employees\/([0-9a-f-]{36})\/(issue-key|revoke-key)$/);
      if(match&&req.method==='POST'){if(match[2]==='issue-key')return sendJson(res,201,{key:store.issueKey(match[1])});store.revokeKey(match[1]);return sendJson(res,200,{ok:true});}
      if(path==='/api/auth/active'&&req.method==='GET')return sendJson(res,200,accounts.active?accounts.public(accounts.active):null);
      if(path==='/api/auth/attempts'&&req.method==='POST'){const body=await readJson(req,{limit:4096,signal:AbortSignal.timeout(15000)});return sendJson(res,201,await accounts.start(body.connectionId||null,body.method||'browser'));}
      match=path.match(/^\/api\/auth\/attempts\/([0-9a-f-]{36})\/open$/);
      if(match&&req.method==='POST')return sendJson(res,200,await chrome.openAttempt(accounts.read(match[1])));
      match=path.match(/^\/api\/auth\/attempts\/([0-9a-f-]{36})$/);
      if(match&&req.method==='GET')return sendJson(res,200,accounts.read(match[1]));
      if(match&&req.method==='DELETE')return sendJson(res,200,await accounts.cancel(match[1]));
      match=path.match(/^\/api\/connections\/([0-9a-f-]{36})$/);
      if(match&&req.method==='POST'){
        const body=await readJson(req,{limit:4096,signal:AbortSignal.timeout(15000)}),connection=store.connection(match[1]);if(!connection)throw new Error('connection_not_found');
        if(body.action==='toggle'){store.patchConnection(connection.id,{enabled:!connection.enabled});store.event('connection_changed',null,connection.name+(connection.enabled?' · запросы приостановлены':' · запросы включены'));}
        else if(body.action==='refresh-quota')await accounts.refreshQuota(connection.id,true);
        else if(body.action==='disconnect')await accounts.disconnect(connection.id);else throw new Error('invalid_action');
        return sendJson(res,200,{ok:true});
      }
      throw new Error('endpoint_not_found');
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return sendJson(res,405,{error:{code:'method_not_allowed'}});
    const assets={'/':['public/index.html','text/html; charset=utf-8'],'/login':['public/login.html','text/html; charset=utf-8'],'/dashboard.js':['public/dashboard.js','text/javascript; charset=utf-8'],'/responsive.css':['public/responsive.css','text/css; charset=utf-8'],'/login.js':['public/login.js','text/javascript; charset=utf-8'],'/favicon.svg':['../dist/favicon.svg','image/svg+xml']};
    if(path==='/'&&!session){res.writeHead(303,{location:'/login'});res.end();return;}
    const asset=assets[path];if(!asset)return sendJson(res,404,{error:{code:'not_found'}});
    const bytes=await readFile(join(here,asset[0]));res.writeHead(200,{'content-type':asset[1],'cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){const code=/^[a-z_]+$/.test(error.message)?error.message:'internal_error';sendJson(res,statusFor(code),{error:{code}});}
});
server.requestTimeout=20000;server.headersTimeout=15000;
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
catch{await gateway.close();await accounts.close();store.close();throw new Error('server_listen_failed');}
accounts.refreshQuotas();const quotaTimer=setInterval(()=>accounts.refreshQuotas(),30000);quotaTimer.unref();
console.log('MOX ACCESS MVP: '+origin);console.log('Admin password file: '+join(root,'admin-password.txt'));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(quotaTimer);const stopped=new Promise(resolve=>server.close(resolve)),drained=gateway.close();server.closeAllConnections();await drained;await stopped;await accounts.close();store.close();}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
