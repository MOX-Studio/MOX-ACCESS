import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateUsage, periodRange } from '../dist/usage.js';
import { requestedModeFromTier } from './response-usage.mjs';
import { weeklyQuota } from './subscription-quota.mjs';
export const keyHash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const fail = code => { throw new Error(code); };
export class Store {
  constructor(root) {
    mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);
    this.root=root;this.db=new DatabaseSync(join(root,'mox.sqlite'));
    try{this.db.exec('PRAGMA busy_timeout=500; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');}
    catch{this.db.close();throw new Error('data_root_in_use');}
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,color INTEGER NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS keys(id TEXT PRIMARY KEY,employeeId TEXT NOT NULL REFERENCES employees(id),hash TEXT NOT NULL UNIQUE,suffix TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,revokedAt TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_key ON keys(employeeId) WHERE status='active';
      CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT,planType TEXT,accountId TEXT NOT NULL,userId TEXT NOT NULL,profile TEXT,auth TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,availability TEXT NOT NULL DEFAULT 'available',createdAt TEXT NOT NULL,UNIQUE(accountId,userId));
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,employeeId TEXT NOT NULL REFERENCES employees(id),clientId TEXT NOT NULL,connectionId TEXT NOT NULL REFERENCES connections(id),createdAt INTEGER NOT NULL,UNIQUE(employeeId,clientId));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,type TEXT NOT NULL,employeeId TEXT,detail TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,employeeId TEXT NOT NULL,connectionId TEXT NOT NULL,chatId TEXT NOT NULL,startedAt INTEGER NOT NULL,completedAt INTEGER,outcome TEXT NOT NULL,record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_by_date ON requests(completedAt);
      CREATE TABLE IF NOT EXISTS response_owners(responseId TEXT PRIMARY KEY,employeeId TEXT NOT NULL,connectionId TEXT NOT NULL,chatId TEXT NOT NULL,requestId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expiresAt INTEGER NOT NULL);
    `);
    chmodSync(join(root,'mox.sqlite'),0o600);
    if(!this.getMeta('admin_hash')){
      const password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');
      this.setMeta('admin_salt',salt);this.setMeta('admin_hash',scryptSync(password,salt,32).toString('hex'));
      writeFileSync(join(root,'admin-password.txt'),password+'\n',{mode:0o600});
    }
    // An interrupted provider request is unknown, never free or automatically replayed.
    for(const row of this.db.prepare('SELECT * FROM requests WHERE completedAt IS NULL').all()){
      const record=JSON.parse(row.record);this.finishRequest(row.id,{...record,outcome:'unknown',completedAt:Date.now(),recoveredAfterRestart:true});
    }
  }
  getMeta(key){return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;}
  setMeta(key,value){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
  passwordValid(password){const digest=scryptSync(String(password).slice(0,512),this.getMeta('admin_salt'),32);return timingSafeEqual(digest,Buffer.from(this.getMeta('admin_hash'),'hex'));}
  createSession(){const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');this.db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(keyHash(token),csrf,Date.now()+12*3600000);return {token,csrf};}
  session(token){return typeof token==='string'?this.db.prepare('SELECT csrf,expiresAt FROM sessions WHERE hash=? AND expiresAt>?').get(keyHash(token),Date.now()):null;}
  logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE hash=?').run(keyHash(token));}
  event(type,employeeId,detail=''){this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(randomUUID(),type,employeeId||null,detail,stamp());}
  employees(){return this.db.prepare('SELECT * FROM employees ORDER BY createdAt,id').all();}
  addEmployee(name,email){
    name=String(name||'').trim();email=String(email||'').trim().toLowerCase();
    if(name.length<2||name.length>80||email.length>160||!/^\S+@\S+\.\S+$/.test(email))fail('invalid_employee');
    if(this.db.prepare('SELECT 1 FROM employees WHERE email=?').get(email))fail('duplicate_email');
    const employee={id:randomUUID(),name,email,color:this.employees().length,createdAt:stamp()};
    this.db.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(employee.id,name,email,employee.color,employee.createdAt);this.event('added',employee.id);return employee;
  }
  issueKey(employeeId){
    if(!this.db.prepare('SELECT 1 FROM employees WHERE id=?').get(employeeId))fail('employee_not_found');
    if(this.db.prepare("SELECT 1 FROM keys WHERE employeeId=? AND status='active'").get(employeeId))fail('active_key_exists');
    const raw='mox_'+randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO keys VALUES(?,?,?,?,?,?,?)').run(randomUUID(),employeeId,keyHash(raw),raw.slice(-4),'active',stamp(),null);this.event('issued',employeeId);return raw;
  }
  revokeKey(employeeId){const changed=this.db.prepare("UPDATE keys SET status='revoked',revokedAt=? WHERE employeeId=? AND status='active'").run(stamp(),employeeId);if(changed.changes)this.event('revoked',employeeId);}
  checkKey(raw){if(typeof raw!=='string'||raw.length>200)return null;return this.db.prepare('SELECT id,employeeId,status,suffix FROM keys WHERE hash=?').get(keyHash(raw))||null;}
  connection(id){return this.db.prepare('SELECT * FROM connections WHERE id=?').get(id);}
  connections(){return this.db.prepare('SELECT * FROM connections ORDER BY createdAt,id').all();}
  transaction(action){this.db.exec('BEGIN IMMEDIATE');try{const result=action();this.db.exec('COMMIT');return result;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
  connect(input){return this.transaction(()=>this.connectRecord(input));}
  connectRecord({id,identity,profile}){
    const existing=id?this.connection(id):null;
    if(id&&!existing)fail('connection_not_found');
    if(existing&&(existing.accountId!==identity.accountId||existing.userId!==identity.userId))fail('wrong_account');
    const duplicate=this.db.prepare('SELECT id FROM connections WHERE accountId=? AND userId=?').get(identity.accountId,identity.userId);
    if(duplicate&&duplicate.id!==id)fail('duplicate_account');
    if(existing){this.db.prepare("UPDATE connections SET email=?,planType=?,profile=?,auth='connected' WHERE id=?").run(identity.email,identity.planType,profile,id);}
    else{id=randomUUID();this.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'Подписка '+(this.connections().length+1),identity.email,identity.planType,identity.accountId,identity.userId,profile,'connected',1,'available',stamp());}
    this.event('connected',null,this.connection(id).name);return this.connection(id);
  }
  patchConnection(id,patch){
    if(!this.connection(id))fail('connection_not_found');
    for(const key of ['auth','enabled','availability','profile'])if(Object.hasOwn(patch,key))this.db.prepare('UPDATE connections SET '+key+'=? WHERE id=?').run(typeof patch[key]==='boolean'?Number(patch[key]):patch[key],id);
  }
  readyConnections(){return this.connections().filter(c=>c.auth==='connected'&&c.enabled&&c.availability!=='quota');}
  chat(employeeId,clientId){return this.db.prepare('SELECT * FROM chats WHERE employeeId=? AND clientId=?').get(employeeId,clientId);}
  pinChat(employeeId,clientId){
    const previous=this.chat(employeeId,clientId);if(previous)return previous;
    const available=this.readyConnections();if(!available.length)fail('no_available_connections');
    const cursor=Number(this.getMeta('route:'+employeeId)||0),connection=available[cursor%available.length];
    const chat={id:randomUUID(),employeeId,clientId,connectionId:connection.id,createdAt:Date.now()};
    this.db.prepare('INSERT INTO chats VALUES(?,?,?,?,?)').run(chat.id,employeeId,clientId,connection.id,chat.createdAt);this.setMeta('route:'+employeeId,cursor+1);return chat;
  }
  responseOwner(id){return this.db.prepare('SELECT * FROM response_owners WHERE responseId=?').get(id);}
  startRequest(record){this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)').run(record.id,record.employeeId,record.connectionId,record.chatId,record.startedAt,null,'running',JSON.stringify(record));}
  finishRequest(id,record){return this.transaction(()=>this.finishRecord(id,record));}
  finishRecord(id,record){
    if(record.responseId){
      const owner=this.responseOwner(record.responseId);
      if(owner&&owner.requestId!==id){record={...record,inputTokens:null,outputTokens:null,effectiveMode:null,outcome:'unknown',accountingError:'duplicate_provider_response'};}
      else if(!owner)this.db.prepare('INSERT INTO response_owners VALUES(?,?,?,?,?)').run(record.responseId,record.employeeId,record.connectionId,record.chatId,id);
    }
    this.db.prepare('UPDATE requests SET completedAt=?,outcome=?,record=? WHERE id=?').run(record.completedAt,record.outcome,JSON.stringify(record),id);
  }
  usage(period){const range=periodRange(period);const records=this.db.prepare('SELECT record FROM requests WHERE completedAt>=? AND completedAt<?').all(range.start,range.end).map(row=>JSON.parse(row.record));const view=records.map(record=>({...record,requestModeForUsage:record.requestedMode??(Object.hasOwn(record,'requestedTier')?requestedModeFromTier(record.requestedTier):null)}));return {...aggregateUsage(this.employees(),view,period,Date.now(),'requestModeForUsage'),grouping:'requestedMode'};}
  state(){return {employees:this.employees(),keys:this.db.prepare('SELECT id,employeeId,suffix,status,createdAt,revokedAt FROM keys ORDER BY createdAt,id').all(),connections:this.connections().map(({profile,accountId,userId,...c})=>{const quota=JSON.parse(this.getMeta('quota:'+c.id)||'null');return {...c,enabled:!!c.enabled,quota,weeklyQuota:weeklyQuota(quota)};}),events:this.db.prepare('SELECT * FROM events ORDER BY at DESC LIMIT 200').all()};}
  close(){this.db.close();}
}
