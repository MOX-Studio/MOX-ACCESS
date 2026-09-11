import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
test('restart preserves issued keys and marks interrupted requests unknown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mox-store-test-'));let store=new Store(root);
 try{
  const employee=store.addEmployee('Test Employee','employee@example.com'),raw=store.issueKey(employee.id);
  const connection=store.connect({identity:{accountId:'account',userId:'user',email:'account@example.com',planType:'pro'},profile:'00000000-0000-4000-8000-000000000001'}),chat=store.pinChat(employee.id,'client-chat');
  store.startRequest({id:'request-1',employeeId:employee.id,connectionId:connection.id,chatId:chat.id,startedAt:Date.now(),inputTokens:null,outputTokens:null,effectiveMode:null,outcome:'unknown',source:'provider'});
  store.close();store=new Store(root);assert.equal(store.checkKey(raw).status,'active');const usage=store.usage('day');assert.equal(usage.totals.requests,1);assert.equal(usage.totals.incompleteRequests,1);assert.equal(usage.totals.byMode.unknown.requests,1);
  assert.throws(()=>store.addEmployee('Other','EMPLOYEE@example.com'),/duplicate_email/);
  store.revokeKey(employee.id);const replacement=store.issueKey(employee.id);assert.equal(store.checkKey(raw).status,'revoked');assert.equal(store.checkKey(replacement).status,'active');
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('second instance cannot recover or mutate a root owned by the running server',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mox-lock-test-'));let store=new Store(root);
 try{
  store.startRequest({id:'pending',employeeId:'employee',connectionId:'connection',chatId:'chat',startedAt:Date.now(),inputTokens:null,outputTokens:null,effectiveMode:null,outcome:'unknown',source:'provider'});
  assert.throws(()=>new Store(root),/data_root_in_use/);
  assert.equal(store.db.prepare('SELECT completedAt FROM requests WHERE id=?').get('pending').completedAt,null);
  store.close();store=new Store(root);assert.notEqual(store.db.prepare('SELECT completedAt FROM requests WHERE id=?').get('pending').completedAt,null);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
