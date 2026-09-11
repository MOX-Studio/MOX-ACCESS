import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const officialUrl=value=>{
  let url;try{url=new URL(value);}catch{throw new Error('invalid_auth_url');}
  if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.username||url.password||url.port)throw new Error('invalid_auth_url');
  return url.href;
};
export class ChromeLogin {
  constructor({binary='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',launch=launchChrome}={}){this.binary=binary;this.launch=launch;}
  async info(){try{await access(this.binary);return {available:true};}catch{return {available:false};}}
  async openAttempt(attempt){
    if(attempt.status!=='waiting'||!attempt.authUrl||attempt.expiresAt<=Date.now())throw new Error('login_not_waiting');
    if(!(await this.info()).available)throw new Error('chrome_unavailable');
    const url=officialUrl(attempt.authUrl);
    // Normal Chrome launch uses its ordinary user-data directory and existing instance.
    // The person chooses their profile. No browser automation or profile override.
    await this.launch(this.binary,['--new-tab',url]);
    return {opened:true};
  }
}
function launchChrome(binary,args){return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{stdio:'ignore',detached:true});child.once('error',()=>reject(new Error('chrome_open_failed')));child.once('spawn',()=>{child.unref();resolve();});
});}
