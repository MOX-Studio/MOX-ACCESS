// Local protocol probe. It uses a fake credential and a synthetic Responses server.
// No OpenAI subscription, API key, model inference, or existing Codex configuration.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const stopChild = child => new Promise(resolve => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  child.once('exit', () => { clearTimeout(timer); resolve(); });
  child.kill('SIGTERM');
});
const binary = process.argv[2] || 'codex';
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
if (process.argv.includes('--desktop')) {
  if (!process.argv.includes('--app-binary')) throw new Error('--desktop requires --app-binary PATH');
  await access(process.argv[process.argv.indexOf('--app-binary') + 1]);
}
const root = await mkdtemp(join(tmpdir(), 'mox-codex-provider-probe-'));
const codexHome = join(root, 'codex');
const workspace = join(root, 'workspace');
await mkdir(codexHome);
await mkdir(workspace);
const fakeKey = 'mox_probe_' + randomBytes(24).toString('hex');
const requests = [];
let revoked = false;
const answer = 'MOX local gateway accepted this key.';
const gateway = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (process.argv.includes('--desktop') && req.method === 'POST' && req.url === '/probe/revoke') {
    revoked = true;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"revoked":true}');
    return;
  }
  if (process.argv.includes('--desktop') && req.method === 'GET' && req.url === '/probe/report') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version, requests, revoked, syntheticAnswer: answer, subscriptionInferenceVerified: false }));
    return;
  }
  const authorized = req.headers.authorization === 'Bearer ' + fakeKey;
  const captured = { method: req.method, path: req.url, expectedBearerReceived: authorized, revoked };
  requests.push(captured);
  if (!authorized || revoked) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'MOX probe key revoked', type: 'invalid_request_error', code: 'invalid_api_key' } }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Probe endpoint not implemented' } }));
    return;
  }
  const payload = JSON.parse(raw);
  captured.stream = payload.stream;
  captured.model = payload.model;
  const id = 'resp_mox_probe';
  const item = { id: 'msg_mox_probe', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] };
  const response = {
    id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed',
    model: payload.model, output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
  };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: answer },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: answer },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response }
  ];
  events.forEach((event, sequence_number) => res.write('event: ' + event.type + '\ndata: ' + JSON.stringify({ ...event, sequence_number }) + '\n\n'));
  res.end();
});
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + gateway.address().port + '/v1';
await writeFile(join(codexHome, 'config.toml'), [
  'model = "gpt-5.4"', 'model_provider = "mox_probe"', 'approval_policy = "never"',
  'sandbox_mode = "read-only"', 'web_search = "disabled"', 'check_for_update_on_startup = false', 'cli_auth_credentials_store = "file"',
  '[analytics]', 'enabled = false',
  '[features]', 'apps = false', 'remote_plugin = false', 'hooks = false',
  'shell_tool = false', 'shell_snapshot = false', 'multi_agent = false',
  '[model_providers.mox_probe]', 'name = "MOX local protocol probe"',
  'base_url = "' + baseUrl + '"', 'env_key = "MOX_PROBE_KEY"', 'wire_api = "responses"',
  'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
  'supports_websockets = false'
].join('\n'), { mode: 0o600 });
const env = {};
for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG']) {
  if (process.env[key]) env[key] = process.env[key];
}
env.CODEX_HOME = codexHome;
env.MOX_PROBE_KEY = fakeKey;
if (process.argv.includes('--desktop')) {
  const appBinary = process.argv[process.argv.indexOf('--app-binary') + 1];
  if (!process.argv.includes('--app-binary') || !appBinary) throw new Error('--desktop requires --app-binary PATH');
  const profile = join(root, 'desktop-profile');
  await mkdir(profile);
  env.CODEX_ELECTRON_USER_DATA_PATH = profile;
  env.CODEX_APP_SERVER_FORCE_CLI = '1';
  const desktop = spawn(appBinary, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
  desktop.stderr.on('data', chunk => {
    const match = chunk.toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) console.log(JSON.stringify({ desktopCDP: 'http://127.0.0.1:' + match[1] }));
  });
  console.log(JSON.stringify({ gateway: baseUrl, workspace, isolatedProfile: profile, openAIAuthenticationUsed: false }));
  await new Promise(resolve => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
    desktop.once('exit', resolve);
  });
  await stopChild(desktop);
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} else {
const child = spawn(binary, ['app-server', '--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 1;
const pending = new Map();
const notifications = [];
const turnWaiters = new Map();
let diagnostic = '';
child.stderr.on('data', chunk => { diagnostic += chunk; });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.id != null && pending.has(event.id)) {
    const task = pending.get(event.id);
    pending.delete(event.id);
    clearTimeout(task.timer);
    if (event.error) task.reject(new Error(JSON.stringify(event.error)));
    else task.resolve(event.result);
  } else {
    notifications.push(event);
    if (event.method === 'turn/completed') {
      const id = event.params.turn.id;
      turnWaiters.get(id)?.(event.params.turn);
      turnWaiters.delete(id);
    }
  }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
const waitTurn = id => {
  const completed = notifications.find(n => n.method === 'turn/completed' && n.params.turn.id === id);
  if (completed) return Promise.resolve(completed.params.turn);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { turnWaiters.delete(id); reject(new Error('Turn completion timed out')); }, 20000);
    turnWaiters.set(id, result => { clearTimeout(timer); resolve(result); });
  });
};
try {
  await rpc('initialize', { clientInfo: { name: 'mox_local_compatibility_probe', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const start = () => rpc('thread/start', { cwd: workspace, model: 'gpt-5.4', modelProvider: 'mox_probe', approvalPolicy: 'never', sandbox: 'read-only' });
  const activeThread = await start();
  const activeTurn = await rpc('turn/start', { threadId: activeThread.thread.id, input: [{ type: 'text', text: 'Reply with a short connectivity check. Do not use tools.' }] });
  const active = await waitTurn(activeTurn.turn.id);
  const receivedSyntheticAnswer = JSON.stringify(notifications).includes(answer);
  revoked = true;
  const revokedThread = await start();
  const revokedTurn = await rpc('turn/start', { threadId: revokedThread.thread.id, input: [{ type: 'text', text: 'Reply with a short connectivity check. Do not use tools.' }] });
  const denied = await waitTurn(revokedTurn.turn.id);
  const report = {
    version, transport: 'desktop-bundled app-server / Responses SSE',
    activeKey: { turnStatus: active.status, syntheticAnswerReceived: receivedSyntheticAnswer },
    revokedKey: { turnStatus: denied.status, rejectedWith401: requests.some(r => r.revoked && r.expectedBearerReceived) && denied.status === 'failed' },
    requests, openAIAuthenticationUsed: false, subscriptionInferenceVerified: false,
    desktopWindowTested: false
  };
  console.log(JSON.stringify(report, null, 2));
  if (active.status !== 'completed' || !receivedSyntheticAnswer || denied.status !== 'failed') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ error: error.message, requests, diagnostic: diagnostic.replaceAll(fakeKey, '[REDACTED]').slice(-4000) }, null, 2));
  process.exitCode = 1;
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  child.stdin.end();
  await stopChild(child);
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
}
