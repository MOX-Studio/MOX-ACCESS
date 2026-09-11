// Deliberately return only allowlisted categories. Never retain raw native output.
export function loginDiagnostic(phase,error){
  const message=typeof error==='string'?error:String(error?.message||'');
  const http=message.match(/(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?: code)?\s*[:=]?\s*|\bRoute Error\s*\()([45]\d\d)\b/i);
  let category='native_error';
  if(/device.*(?:not enabled|disabled)|enable.*device/i.test(message))category='device_login_disabled';
  else if(/text\/html|<!doctype|invalid content type/i.test(message))category='unexpected_html';
  else if(/invalid_grant/i.test(message))category='invalid_grant';
  else if(/expired|expiration/i.test(message))category='expired';
  else if(/address.*in use|addrinuse/i.test(message))category='callback_port_in_use';
  else if(/certificate|tls|ssl/i.test(message))category='tls_error';
  else if(/connection|network|dns|resolve host/i.test(message))category='connection_error';
  else if(/timeout|timed out/i.test(message))category='timeout';
  const result={at:Date.now(),phase,category};
  if(http)result.httpStatus=Number(http[1]);
  if(/text\/html/i.test(message))result.contentType='text/html';
  if(Number.isSafeInteger(error?.code))result.nativeCode=error.code;
  return result;
}
