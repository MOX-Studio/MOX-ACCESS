export function sendJson(res,status,value){if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
export async function readBody(req,{limit=1024*1024,signal}={}){
  const abort=()=>req.destroy(new Error('request_aborted'));if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});
  try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('request_too_large');chunks.push(chunk);}return Buffer.concat(chunks);}
  finally{signal?.removeEventListener('abort',abort);}
}
export async function readJson(req,options){let body=await readBody(req,options);try{return JSON.parse(body.toString('utf8'));}catch{throw new Error('invalid_json');}}
export function writeChunk(res,chunk,signal){
  if(signal.aborted||res.destroyed)return Promise.reject(new Error('request_aborted'));
  if(res.write(chunk))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{res.off('drain',done);res.off('close',failed);res.off('error',failed);signal.removeEventListener('abort',failed);};
    const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('request_aborted'));};
    res.once('drain',done);res.once('close',failed);res.once('error',failed);signal.addEventListener('abort',failed,{once:true});if(signal.aborted||res.destroyed)failed();
  });
}
export class Queue{
  constructor(max=16){this.busy=false;this.waiting=[];this.max=max;}
  acquire(signal){
    if(signal.aborted)return Promise.reject(new Error('request_aborted'));
    if(!this.busy){this.busy=true;return Promise.resolve(()=>this.release());}
    if(this.waiting.length>=this.max)return Promise.reject(new Error('queue_full'));
    return new Promise((resolve,reject)=>{
      const entry={resolve:()=>{signal.removeEventListener('abort',abort);resolve(()=>this.release());}};
      const abort=()=>{const index=this.waiting.indexOf(entry);if(index>=0)this.waiting.splice(index,1);reject(new Error('request_aborted'));};
      signal.addEventListener('abort',abort,{once:true});this.waiting.push(entry);
    });
  }
  release(){const next=this.waiting.shift();if(next)next.resolve();else this.busy=false;}
}
