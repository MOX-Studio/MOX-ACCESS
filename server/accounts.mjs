import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { CodexAccount } from './codex-account.mjs';
export class Accounts{
  constructor(store,binary,{accountFactory=(...args)=>new CodexAccount(...args),probePort=checkLoginPort}={}){this.store=store;this.binary=binary;this.accountFactory=accountFactory;this.probePort=probePort;this.managers=new Map();this.attempts=new Map();this.active=null;this.quotaReads=new Map();}
  path(profile){if(!/^[0-9a-f-]{36}$/.test(profile))throw new Error('invalid_profile');return join(this.store.root,'profiles',profile);}
  async manager(connection){
    let manager=this.managers.get(connection.id);
    if(manager)return await manager;
    if(!connection.profile)throw new Error('subscription_requires_login');
    const promise=this.accountFactory(this.binary,this.path(connection.profile),{accountId:connection.accountId,userId:connection.userId}).start();
    this.managers.set(connection.id,promise);
    try{manager=await promise;if(manager.state.status!=='connected'||this.store.connection(connection.id)?.profile!==connection.profile)throw new Error('subscription_requires_login');return manager;}
    catch{if(this.managers.get(connection.id)===promise)this.managers.delete(connection.id);try{await(await promise).close();}catch{}const current=this.store.connection(connection.id);if(current?.profile===connection.profile&&current.auth!=='disconnected')this.store.patchConnection(connection.id,{auth:'requires_auth'});throw new Error('subscription_requires_login');}
  }
  async start(connectionId=null,method='browser'){
    if(!['browser','device'].includes(method))throw new Error('invalid_login_method');
    if(this.active)throw new Error('login_in_progress');
    const existing=connectionId?this.store.connection(connectionId):null;if(connectionId&&!existing)throw new Error('connection_not_found');
    const attempt={id:randomUUID(),profile:randomUUID(),connectionId,method,status:'starting',createdAt:Date.now(),expiresAt:Date.now()+(method==='device'?15:10)*60000};this.active=attempt;this.attempts.set(attempt.id,attempt);
    try{
      if(method==='browser')await this.probePort();
      if(!this.isActive(attempt))return this.public(attempt);
      const expected=existing?{accountId:existing.accountId,userId:existing.userId}:null;
      attempt.manager=this.accountFactory(this.binary,this.path(attempt.profile),expected);
      attempt.startTask=attempt.manager.start();await attempt.startTask;
      if(!this.isActive(attempt))return this.public(attempt);
      attempt.manager.on('state',state=>{if(state.status==='connected')void this.complete(attempt);else if(state.status==='failed')void this.fail(attempt,state.code||'login_failed').catch(()=>{});});
      const result=await attempt.manager.login(method);
      if(!this.isActive(attempt))return this.public(attempt);
      attempt.status='waiting';attempt.authUrl=result.authUrl||result.verificationUrl;attempt.userCode=result.userCode||null;
      attempt.timer=setTimeout(()=>void this.fail(attempt,'login_expired').catch(()=>{}),Math.max(1,attempt.expiresAt-Date.now()));
      return this.public(attempt);
    }catch(error){await this.fail(attempt,['login_port_in_use','wrong_account','device_login_disabled'].includes(error.message)?error.message:'login_start_failed');return this.public(attempt);}
  }
  isActive(attempt){return this.active===attempt&&['starting','waiting'].includes(attempt.status);}
  public(attempt){return {id:attempt.id,status:attempt.status,method:attempt.method||'browser',userCode:attempt.status==='waiting'?attempt.userCode||null:null,authUrl:attempt.status==='waiting'?attempt.authUrl:null,connectionId:attempt.connectionId,expiresAt:attempt.expiresAt,code:attempt.code||null,diagnostics:attempt.manager?.diagnostics||[]};}
  read(id){const attempt=this.attempts.get(id);if(!attempt)throw new Error('attempt_not_found');return this.public(attempt);}
  async complete(attempt){
    if(this.active!==attempt||!['waiting','starting'].includes(attempt.status))return;
    attempt.status='verifying';
    try{
      const previous=attempt.connectionId?this.store.connection(attempt.connectionId):null;
      const connection=this.store.connect({id:attempt.connectionId,identity:attempt.manager.identity,profile:attempt.profile});
      const old=this.managers.get(connection.id);this.managers.set(connection.id,Promise.resolve(attempt.manager));
      attempt.connectionId=connection.id;attempt.status='connected';clearTimeout(attempt.timer);this.active=null;
      void this.refreshQuota(connection.id,true).catch(()=>{});
      if(old)try{await(await old).close();}catch{}
      if(previous?.profile&&previous.profile!==attempt.profile)try{await rm(this.path(previous.profile),{recursive:true,force:true});}catch{}
    }catch(error){await this.fail(attempt,['wrong_account','duplicate_account'].includes(error.message)?error.message:'account_verification_failed');}
  }
  async dispose(attempt){
    if(!attempt.disposing)attempt.disposing=(async()=>{
      try{await attempt.manager?.close();try{await attempt.startTask;}catch{}await rm(this.path(attempt.profile),{recursive:true,force:true});}
      finally{if(this.active===attempt)this.active=null;}
    })();
    return attempt.disposing;
  }
  async fail(attempt,code){
    if(['connected','failed','cancelled'].includes(attempt.status))return;
    attempt.status='failed';attempt.code=code;clearTimeout(attempt.timer);
    await this.dispose(attempt);
  }
  async cancel(id){
    const attempt=this.attempts.get(id);if(!attempt)throw new Error('attempt_not_found');
    if(['connected','failed','cancelled'].includes(attempt.status))return this.public(attempt);
    attempt.status='cancelled';clearTimeout(attempt.timer);await this.dispose(attempt);return this.public(attempt);
  }
  async refreshQuota(id,force=false){
    const current=this.quotaReads.get(id);
    if(current?.promise)return current.promise;
    if(!force&&current&&Date.now()-current.at<30000)return;
    const connection=this.store.connection(id);if(!connection||connection.auth!=='connected')return;
    const item={at:Date.now()};this.quotaReads.set(id,item);
    item.promise=(async()=>{
      try{
        const manager=await this.manager(connection),quota=await manager.rateLimits();
        if(this.store.connection(id)?.profile!==connection.profile)return;
        this.store.setMeta('quota:'+id,JSON.stringify(quota));
        const windows=[quota.primary,quota.secondary].filter(Boolean);
        if(windows.some(window=>window.usedPercent>=100))this.store.patchConnection(id,{availability:'quota'});
        else if(windows.length)this.store.patchConnection(id,{availability:'available'});
      }catch{}finally{delete item.promise;}
    })();return item.promise;
  }
  refreshQuotas(){for(const c of this.store.connections())void this.refreshQuota(c.id).catch(()=>{});}
  async disconnect(id){
    const connection=this.store.connection(id);if(!connection)throw new Error('connection_not_found');
    if(this.active?.connectionId===id)await this.cancel(this.active.id);
    this.store.patchConnection(id,{auth:'disconnected',profile:null});const old=this.managers.get(id);this.managers.delete(id);
    if(old)try{const manager=await old;try{await manager.rpc('account/logout');}finally{await manager.close();}}catch{}
    if(connection.profile)await rm(this.path(connection.profile),{recursive:true,force:true});this.store.event('disconnected',null,connection.name);
  }
  async close(){
    if(this.active)await this.cancel(this.active.id);
    for(const item of this.managers.values())try{await(await item).close();}catch{}
  }
}

function checkLoginPort(){return new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(new Error('login_port_in_use')));probe.listen(1455,'127.0.0.1',()=>probe.close(resolve));});}
