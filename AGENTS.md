# MOX ACCESS prototype

- Work in Russian with the user. Keep repository changes on `main`; do not create feature branches without explicit permission.
- This is a disposable interaction prototype. Author the self-contained app in `dist/index.html`.
- Validate the desktop viewport at 1920×1080 only unless the user requests another size.
- Use in-memory demo state. No real OpenAI credentials, OAuth tokens, employee data, analytics, or model calls.
- Every generated key must start with `mox_demo_`; it only works in this page's local checker. Keep the demo status visible.
- Preserve one-time key display, duplicate-email rejection, immediate local revocation, and revoked-key history when issuing a replacement.
- Full keys must not be written to logs, browser storage, activity history, or Git. Store only hashes and masked metadata in application state.
- Check interactions in an isolated Playwright MCP browser. Avoid implementation-mirroring unit tests for this prototype.
