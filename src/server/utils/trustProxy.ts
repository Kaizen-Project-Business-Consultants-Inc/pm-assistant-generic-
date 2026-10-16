// Who the visitor really is. nginx, on the same machine, appends the address it saw to
// X-Forwarded-For. Trusting only the loopback hop makes request.ip that appended (right-most)
// entry. `trustProxy: true` took the LEFT-most entry, which the visitor writes themselves, so a
// fake header got round every per-IP limit (sign-in, sign-up, verify, resend) — found 2026-10-16.
// The MCP server (Express) uses the same rule: app.set('trust proxy', 'loopback').
export const TRUST_PROXY = 'loopback';
