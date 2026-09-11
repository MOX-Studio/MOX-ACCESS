import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { Store } from '../server/store.mjs';
import { createGateway } from '../server/mvp-gateway.mjs';
const frame=(id,service_tier='default')=>'data: '+JSON.stringify({type:'response.completed',response:{id,service_tier,usage:{input_tokens:11,output_tokens:7}}})+'\n\n';
async function fixture(t,transport){
 const root=await mkdtemp(join(tmpdir(),'mox-mvp-test-')),store=new Store(root),employee=store.addEmployee('Test A','a@example.com'),key=store.issueKey(employee.id);
 const connection=store.connect({identity:{email:'subscription@example.com',planType:'pro',accountId:'account-1',userId:'user-1'},profile:'00000000-0000-4000-8000-000000000001'});
 let calls=0;const accounts={manager:async()=>({credentials:async()=>({accessToken:'fake',accountId:'account-1'})})};const gateway=createGateway(store,accounts,()=>async(...args)=>{calls++;return transport?transport(...args):new Response(frame('response-'+calls),{headers:{'content-type':'text/event-stream'}});});
 const server=createServer((req,res)=>void gateway.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/v1/responses';
 t.after(async()=>{gateway.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();await rm(root,{recursive:true,force:true});});
 const request=(bearer=key,session='chat-a',payload={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+bearer,'thread-id':session,session_id:'ignored-legacy-id'},body:JSON.stringify({model:'fake-model',stream:true,...payload})});
 return {store,employee,key,connection,request,calls:()=>calls,root,accounts,gateway};
}
test('real gateway boundary validates keys and persists only actual provider counts',async t=>{
 const f=await fixture(t);let response=await f.request('wrong');assert.equal(response.status,401);assert.equal(f.calls(),0);
 response=await f.request();assert.equal(response.status,200);assert.equal(await response.text(),frame('response-1'));assert.equal(f.calls(),1);
 let usage=f.store.usage('day');assert.equal(usage.totals.input,11);assert.equal(usage.totals.output,7);assert.equal(usage.totals.byMode.standard.requests,1);
 f.store.revokeKey(f.employee.id);response=await f.request();assert.equal(response.status,401);assert.equal(f.calls(),1);assert.equal(f.store.usage('day').totals.input,11);
 assert.equal(JSON.stringify(f.store.state()).includes(f.key),false);assert.equal('hash' in f.store.state().keys[0],false);
});
test('revocation while queued blocks the subsequent request before provider dispatch',async t=>{
 let release,started;const entered=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
 const f=await fixture(t,async()=>{started();await hold;return new Response(Buffer.from(frame('queued-response')));});
 const first=f.request();await entered;const second=f.request();await new Promise(resolve=>setTimeout(resolve,30));f.store.revokeKey(f.employee.id);release();
 const firstResponse=await first;assert.equal(firstResponse.status,200);await firstResponse.text();assert.equal((await second).status,401);assert.equal(f.calls(),1);assert.equal(f.store.usage('day').totals.requests,1);
});
test('response ownership and pinned subscription survive connection changes',async t=>{
 const f=await fixture(t);await(await f.request()).text();
 f.store.connect({identity:{email:'second@example.com',planType:'pro',accountId:'account-2',userId:'user-2'},profile:'00000000-0000-4000-8000-000000000002'});
 await(await f.request(f.key,'new-chat')).text();assert.notEqual(f.store.chat(f.employee.id,'chat-a').connectionId,f.store.chat(f.employee.id,'new-chat').connectionId);
 const other=f.store.addEmployee('Test B','b@example.com'),otherKey=f.store.issueKey(other.id);
 const denied=await f.request(otherKey,'other-chat',{previous_response_id:'response-1'});assert.equal(denied.status,403);assert.equal(f.calls(),2);
 f.store.patchConnection(f.connection.id,{enabled:false});assert.equal((await f.request()).status,503);assert.equal(f.calls(),2);
});
test('Fast request accounting is independent from provider fallback and absent confirmation',async t=>{
 let index=0;const f=await fixture(t,async()=>new Response(Buffer.from(frame('mode-'+(++index),index===1?'default':null))));
 await(await f.request(f.key,'chat-a',{service_tier:'priority'})).text();await(await f.request(f.key,'chat-a',{service_tier:'priority'})).text();
 const usage=f.store.usage('day');assert.equal(usage.grouping,'requestedMode');assert.equal(usage.totals.byMode.standard.input,0);assert.equal(usage.totals.byMode.unknown.input,0);assert.equal(usage.totals.byMode.fast.input,22);assert.equal(usage.totals.input,22);const records=f.store.db.prepare('SELECT record FROM requests ORDER BY startedAt').all().map(r=>JSON.parse(r.record));assert.deepEqual(records.map(r=>r.effectiveMode),['standard',null]);
});
test('continuation waits for prior response ownership to be saved at stream end',async t=>{
 let stream,index=0;const f=await fixture(t,async()=>{
   if(++index===1)return new Response(new ReadableStream({start(controller){stream=controller;controller.enqueue(Buffer.from(frame('held-response')));}}));
   return new Response(Buffer.from(frame('continuation-response')));
 });
 const first=await f.request(),reader=first.body.getReader();await reader.read();
 let pinned;const entered=new Promise(resolve=>pinned=resolve),original=f.store.pinChat.bind(f.store);
 f.store.pinChat=(...args)=>{const result=original(...args);pinned();return result;};
 const second=f.request(f.key,'chat-a',{previous_response_id:'held-response'});await entered;
 assert.equal(f.calls(),1);stream.close();while(!(await reader.read()).done){}
 const response=await second;assert.equal(response.status,200);await response.text();assert.equal(f.calls(),2);assert.equal(f.store.usage('day').totals.requests,2);
});
test('accounting failure releases the queue and blocks further provider spending',async t=>{
 const f=await fixture(t);f.store.finishRequest=()=>{throw new Error('simulated persistence failure');};
 await(await f.request()).text();const response=await f.request();assert.equal(response.status,503);assert.equal((await response.json()).error.code,'accounting_unavailable');assert.equal(f.calls(),1);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM requests WHERE completedAt IS NULL').get().total,1);
});
test('a 429 alone does not permanently mark subscription quota exhausted',async t=>{
 const f=await fixture(t,async()=>new Response('',{status:429}));assert.equal((await f.request()).status,429);
 assert.equal(f.store.connection(f.connection.id).availability,'available');assert.equal(f.store.usage('day').totals.incompleteRequests,1);
});

test('persistence failure on another connection blocks a request awaiting credentials',async t=>{
 let releaseProvider,enteredProvider;const providerEntered=new Promise(resolve=>enteredProvider=resolve),providerHold=new Promise(resolve=>releaseProvider=resolve);
 const f=await fixture(t,async()=>{enteredProvider();await providerHold;return new Response(Buffer.from(frame('accounting-first')));});
 const first=f.request();await providerEntered;
 const secondConnection=f.store.connect({identity:{email:'second@example.com',planType:'pro',accountId:'account-2',userId:'user-2'},profile:'00000000-0000-4000-8000-000000000002'});
 let releaseCredentials,enteredCredentials;const credentialEntered=new Promise(resolve=>enteredCredentials=resolve),credentialHold=new Promise(resolve=>releaseCredentials=resolve);
 f.accounts.manager=async c=>({credentials:async()=>{if(c.id===secondConnection.id){enteredCredentials();await credentialHold;}return {accessToken:'fake',accountId:c.accountId};}});
 const second=f.request(f.key,'second-chat');await credentialEntered;
 f.store.finishRequest=()=>{throw new Error('simulated persistence failure');};releaseProvider();await(await first).text();releaseCredentials();
 const denied=await second;assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'accounting_unavailable');assert.equal(f.calls(),1);
});
test('gateway rejects new requests after shutdown starts',async t=>{
 const f=await fixture(t);await f.gateway.close();const denied=await f.request();assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'gateway_stopping');assert.equal(f.calls(),0);
});
