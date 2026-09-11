import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { Accounts } from '../server/accounts.mjs';
import { CodexAccount } from '../server/codex-account.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const identity={accountId:'account',userId:'user',email:'test@example.com',planType:'pro'};
async function fixture(t,{at,method='browser'}={}){
  const root=await mkdtemp(join(tmpdir(),'mox-accounts-test-')),store=new Store(root),entered=deferred(),resume=deferred();let manager;
  const barrier=async stage=>{if(at===stage){entered.resolve();await resume.promise;}};
  const accounts=new Accounts(store,'unused',{
    probePort:()=>barrier('probe'),
    accountFactory:()=>manager=new class extends EventEmitter{
      state={status:'signed_out'};identity=identity;closed=false;loginCalls=0;
      async start(){await barrier('start');return this;}
      async login(){this.loginCalls++;await barrier('login');return {loginId:'issued',authUrl:'https://auth.openai.com/example'};}
      async close(){this.closed=true;}
      async rpc(){return {};}
      async rateLimits(){return {primary:null,secondary:null};}
    }()
  });
  t.after(async()=>{resume.resolve();await accounts.close();store.close();await rm(root,{recursive:true,force:true});});
  return {store,accounts,entered,resume,manager:()=>manager,method};
}
for(const at of ['probe','start','login'])test('cancel at '+at+' prevents late login promotion',async t=>{
  const f=await fixture(t,{at}),starting=f.accounts.start();await f.entered.promise;
  const id=f.accounts.active.id,cancelled=f.accounts.cancel(id);f.resume.resolve();await cancelled;await starting;
  f.manager()?.emit('state',{status:'connected'});
  assert.equal(f.accounts.read(id).status,'cancelled');assert.equal(f.accounts.active,null);assert.equal(f.store.connections().length,0);
  if(f.manager())assert.equal(f.manager().closed,true);
  if(at==='start')assert.equal(f.manager().loginCalls,0);
});
test('disconnect invalidates pending reauthorization and keeps employee access history',async t=>{
  const f=await fixture(t,{at:'login'}),e=f.store.addEmployee('Test User','user@example.com'),key=f.store.issueKey(e.id);
  const c=f.store.connect({identity,profile:'00000000-0000-4000-8000-000000000001'}),chat=f.store.pinChat(e.id,'chat');
  const starting=f.accounts.start(c.id);await f.entered.promise;const id=f.accounts.active.id,disconnect=f.accounts.disconnect(c.id);
  f.resume.resolve();await disconnect;await starting;f.manager().emit('state',{status:'connected'});
  assert.equal(f.accounts.read(id).status,'cancelled');assert.equal(f.store.connection(c.id).auth,'disconnected');assert.equal(f.store.connection(c.id).profile,null);
  assert.equal(f.store.checkKey(key).status,'active');assert.equal(f.store.chat(e.id,'chat').id,chat.id);
});
test('verified quota clears exhausted state while missing windows preserve it',async t=>{
  const f=await fixture(t),c=f.store.connect({identity,profile:'00000000-0000-4000-8000-000000000001'});
  let quota={primary:{usedPercent:100,resetsAt:123},secondary:null};
  f.accounts.manager=async()=>({rateLimits:async()=>quota});
  await f.accounts.refreshQuota(c.id,true);assert.equal(f.store.connection(c.id).availability,'quota');
  quota={primary:null,secondary:null};await f.accounts.refreshQuota(c.id,true);assert.equal(f.store.connection(c.id).availability,'quota');
  quota={primary:{usedPercent:15,resetsAt:456},secondary:null};await f.accounts.refreshQuota(c.id,true);assert.equal(f.store.connection(c.id).availability,'available');
});
test('early login completion is correlated after start response arrives',async()=>{
  const account=new CodexAccount('unused','unused');let verified=0;
  account.rpc=async method=>{
    if(method==='account/login/start'){
      account.earlyCompletion.push({loginId:'other',success:true},{loginId:'issued',success:true});
      return {loginId:'issued',authUrl:'https://auth.openai.com/example'};
    }
    return {account:{type:'chatgpt'}};
  };
  account.verify=async()=>{verified++;account.state={status:'connected'};};
  const connected=new Promise(resolve=>account.once('state',resolve));await account.login();await connected;assert.equal(verified,1);
});
