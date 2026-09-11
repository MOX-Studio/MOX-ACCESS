// Transport for the separate MOX account profiles. Depends on the current Codex subscription protocol.
export function chatgptTransport(credentials) {
  return async (body, incoming, signal) => {
    const auth = await credentials();
    const headers = new Headers({
      'content-type': 'application/json', 'accept': 'text/event-stream',
      'authorization': 'Bearer ' + auth.accessToken,
      'chatgpt-account-id': auth.accountId
    });
    // Preserve actual Codex client metadata. Never fabricate attestation or verification headers.
    for (const name of ['user-agent', 'openai-beta', 'originator', 'session_id', 'conversation_id', 'session-id', 'thread-id', 'x-codex-turn-metadata', 'x-codex-window-id', 'x-client-request-id', 'x-codex-turn-state', 'x-codex-beta-features', 'x-codex-parent-thread-id']) {
      if (typeof incoming[name] === 'string') headers.set(name, incoming[name]);
    }
    if (!headers.has('user-agent')) headers.set('user-agent', 'mox-access/0.5');
    return fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers, body, signal, redirect: 'error' });
  };
}
