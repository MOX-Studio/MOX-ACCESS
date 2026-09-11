import test from 'node:test';
import assert from 'node:assert/strict';
import { loginDiagnostic } from '../server/login-diagnostics.mjs';
test('native diagnostics preserve error category without token, code, URL or HTML',()=>{
  const diagnostic=loginDiagnostic('account/login/start',{code:-32603,message:'HTTP 403 text/html <!DOCTYPE html> access_token=private-token user_code=ABCD-12345 https://auth.openai.com/example?state=private-state'});
  assert.equal(diagnostic.httpStatus,403);assert.equal(diagnostic.category,'unexpected_html');assert.equal(diagnostic.contentType,'text/html');assert.equal(diagnostic.nativeCode,-32603);
  const serialized=JSON.stringify(diagnostic);for(const secret of ['private-token','ABCD-12345','private-state','<!DOCTYPE','https://'])assert.equal(serialized.includes(secret),false);
});
test('disabled device login, invalid grant and timeout remain distinguishable',()=>{
  assert.equal(loginDiagnostic('login','device login is not enabled').category,'device_login_disabled');
  assert.equal(loginDiagnostic('login','OAuth invalid_grant: secret detail').category,'invalid_grant');
  assert.equal(loginDiagnostic('login','request timed out').category,'timeout');
});
