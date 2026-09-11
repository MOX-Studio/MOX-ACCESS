import { randomUUID } from 'node:crypto';
import { createUsageObserver,requestedModeFromTier } from './response-usage.mjs';
import { chatgptTransport } from './chatgpt-transport.mjs';
import { Queue,readBody,writeChunk,sendJson } from './http-utils.mjs';
const statusFor=code=>code==='invalid_api_key'?401:code==='response_not_owned'?403:code==='queue_full'?429:['client_session_id_required','invalid_json','streaming_required'].includes(code)?400:503;
export function createGateway(store,accounts,transportFactory=chatgptTransport){
  const queues=new Map(),active=new Set(),tasks=new Set();let accountingFailed=false,closing=false;
  const check=(raw,connectionId)=>{
    const key=store.checkKey(raw);if(key?.status!=='active')throw new Error('invalid_api_key');
    if(connectionId){const c=store.connection(connectionId);if(!c||c.auth!=='connected')throw new Error('subscription_requires_login');if(!c.enabled)throw new Error('subscription_paused');if(c.availability==='quota')throw new Error('subscription_quota_reached');}
    return key;
  };
  return {
    async handle(req,res){
      let settle;const done=new Promise(resolve=>settle=resolve);tasks.add(done);
      const controller=new AbortController();active.add(controller);const timer=setTimeout(()=>controller.abort(),180000);let release=null,record=null,dispatched=false;
      const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
      try{
        if(closing)throw new Error('gateway_stopping');
        if(accountingFailed)throw new Error('accounting_unavailable');
        const raw=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
        const key=check(raw);
        const body=await readBody(req,{limit:8*1024*1024,signal:controller.signal});let payload;try{payload=JSON.parse(body);}catch{throw new Error('invalid_json');}
        if(payload.stream!==true)throw new Error('streaming_required');
        const clientId=req.headers['thread-id']||req.headers.conversation_id||req.headers.session_id;
        if(typeof clientId!=='string'||!clientId.trim()||clientId.length>200||/[\x00-\x1f]/.test(clientId))throw new Error('client_session_id_required');
        const chat=store.pinChat(key.employeeId,clientId);
        if(!queues.has(chat.connectionId))queues.set(chat.connectionId,new Queue());
        release=await queues.get(chat.connectionId).acquire(controller.signal);check(raw,chat.connectionId);
        if(payload.previous_response_id){const owner=store.responseOwner(payload.previous_response_id);if(!owner||owner.employeeId!==key.employeeId||owner.connectionId!==chat.connectionId||owner.chatId!==chat.id)throw new Error('response_not_owned');}
        if(closing)throw new Error('gateway_stopping');
        if(accountingFailed)throw new Error('accounting_unavailable');
        const connection=store.connection(chat.connectionId),manager=await accounts.manager(connection);
        const credentials=await manager.credentials();
        check(raw,chat.connectionId);
        record={id:randomUUID(),employeeId:key.employeeId,connectionId:connection.id,chatId:chat.id,startedAt:Date.now(),source:'provider',model:typeof payload.model==='string'?payload.model.slice(0,100):null,requestedTier:payload.service_tier||null,requestedMode:requestedModeFromTier(payload.service_tier),inputTokens:null,outputTokens:null,effectiveMode:null,outcome:'unknown'};
        controller.signal.throwIfAborted();if(closing)throw new Error('gateway_stopping');if(accountingFailed)throw new Error('accounting_unavailable');store.startRequest(record);dispatched=true;
        const response=await transportFactory(async()=>credentials)(body,req.headers,controller.signal);record.httpStatus=response.status;
        if(!response.ok){
          record.outcome='rejected';
          if(response.status===401)store.patchConnection(connection.id,{auth:'requires_auth'});
          if(response.status===429)void accounts.refreshQuota?.(connection.id,true);
          await response.body?.cancel();sendJson(res,response.status,{error:{code:'upstream_rejected',message:'Провайдер отклонил запрос',upstreamStatus:response.status}});return;
        }
        if(response.headers.get('content-type')&&!response.headers.get('content-type').includes('text/event-stream')){await response.body?.cancel();throw new Error('unexpected_provider_response');}
        const headers={'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'};
        for(const name of ['x-request-id','x-codex-turn-state'])if(response.headers.has(name))headers[name]=response.headers.get(name);
        res.writeHead(200,headers);res.flushHeaders();const observer=createUsageObserver();
        try{for await(const chunk of response.body){observer.push(Buffer.from(chunk));await writeChunk(res,chunk,controller.signal);}Object.assign(record,observer.finish());res.end();}
        catch{Object.assign(record,observer.finish());throw new Error('provider_stream_interrupted');}
      }catch(error){
        const code=/^[a-z_]+$/.test(error.message)?error.message:'gateway_failed';
        if(!res.destroyed)sendJson(res,statusFor(code),{error:{code,message:code}});
      }finally{
        try{if(dispatched&&record)store.finishRequest(record.id,{...record,completedAt:Date.now()});}
        catch{accountingFailed=true;console.error('MOX: accounting_unavailable; new model requests paused');}
        finally{clearTimeout(timer);res.off('close',abort);active.delete(controller);release?.();tasks.delete(done);settle();}
      }
    },
    health(){return {accountingFailed};},
    async close(){closing=true;for(const controller of active)controller.abort();await Promise.allSettled([...tasks]);}
  };
}
