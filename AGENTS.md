# MOX ACCESS prototype

- Work in Russian with the user. Keep repository changes on `main`; do not create feature branches without explicit permission.
- This is a disposable interaction prototype. Author the app in `dist/`; keep it dependency-free and runnable with `npm run dev`.
- Validate the desktop viewport at 1920×1080 only unless the user requests another size.
- Use in-memory demo state. No real OpenAI credentials, OAuth tokens, employee data, analytics, or model calls.
- Every generated key must start with `mox_demo_`; it only works in this page's local checker. Keep the demo status visible.
- Preserve one-time key display, duplicate-email rejection, immediate local revocation, and revoked-key history when issuing a replacement.
- Full keys must not be written to logs, browser storage, activity history, or Git. Store only hashes and masked metadata in application state.
- Check interactions in an isolated Playwright MCP browser. Avoid implementation-mirroring unit tests for this prototype.
- Employee keys belong to the MOX environment. Connection changes must not rotate or replace them.
- Keep authorization, administrative pause, and quota state independent for each subscription.
- Every employee with an active key automatically has access to every current and future connection in the environment. Do not introduce per-employee connection scopes.
- Pin a chat to one connection before dispatch. Recheck key, ownership and connection availability for every subsequent request. Do not silently move or replay a chat through another account.
- Multi-subscription authorization and routing are simulated; the desktop protocol probe alone does not verify real Pro subscription pooling.
- Browser login is a clearly labeled fixture in this prototype. Future real login must be confirmed by the server, with stable account/workspace validation; never trust popup completion as authorization.
- Usage is per employee across all connections. Use Moscow calendar day/week/month, count each request once, and keep unknown counts distinct from zero. Key revocation must preserve usage history.
- Record requestedMode and effectiveMode per request. Group Fast usage only by effectiveMode; missing confirmation belongs to a separate unknown group. Never multiply token counts by billing or credit factors. Mode changes and key revocation must not reclassify historical requests.
