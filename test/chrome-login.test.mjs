import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeLogin } from '../server/chrome-login.mjs';
test('opens only active issued OpenAI URLs in ordinary Chrome without profile or automation switches',async()=>{
  const calls=[],chrome=new ChromeLogin({binary:process.execPath,launch:async(...args)=>calls.push(args)});
  const attempt={status:'waiting',authUrl:'https://auth.openai.com/codex/device',expiresAt:Date.now()+60000};
  assert.equal((await chrome.openAttempt(attempt)).opened,true);
  assert.deepEqual(calls[0][1],['--new-tab',attempt.authUrl]);
  await assert.rejects(chrome.openAttempt({...attempt,authUrl:'https://auth.openai.com.evil.example/login'}),/invalid_auth_url/);
  await assert.rejects(chrome.openAttempt({...attempt,authUrl:'file:///tmp/example'}),/invalid_auth_url/);
  await assert.rejects(chrome.openAttempt({...attempt,status:'cancelled'}),/login_not_waiting/);
  await assert.rejects(chrome.openAttempt({...attempt,expiresAt:1}),/login_not_waiting/);
  assert.equal(calls.length,1);
});
