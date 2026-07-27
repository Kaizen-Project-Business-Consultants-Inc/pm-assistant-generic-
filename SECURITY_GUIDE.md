# PM Assistant -- Security Implementation Guide

A comprehensive reference for the security architecture of the PM Assistant application.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [OAuth 2.1 (MCP / Claude Web)](#2-oauth-21-mcp--claude-web)
3. [API Keys](#3-api-keys)
4. [Scope-Based Authorization](#4-scope-based-authorization)
5. [Password Security](#5-password-security)
6. [Security Headers](#6-security-headers)
7. [CORS](#7-cors)
8. [Content Security Policy (CSP)](#8-content-security-policy-csp)
9. [Cookie Security](#9-cookie-security)
10. [Input Validation](#10-input-validation)
11. [Rate Limiting](#11-rate-limiting)
12. [Audit Ledger](#12-audit-ledger)
13. [Policy Engine](#13-policy-engine)
14. [Webhook Security](#14-webhook-security)
15. [Stakeholder Portal Access](#15-stakeholder-portal-access)
16. [Development vs Production](#16-development-vs-production)
17. [Deployment Checklist](#17-deployment-checklist)
18. [Privacy Policy and Third-Party Data Processors](#18-privacy-policy-and-third-party-data-processors)
19. [Testing](#19-testing)
20. [Related Files](#20-related-files)

---

## 1. Authentication

The application uses a dual-token JWT strategy:

- **Access token** -- short-lived JWT delivered as an `HttpOnly` cookie (`access_token`).
- **Refresh token** -- longer-lived JWT stored as an `HttpOnly` cookie, used to rotate access tokens without requiring the user to re-authenticate.

Both tokens are configured with `secure: true` in production and `sameSite: 'lax'` to prevent CSRF while allowing standard navigation flows.

Authentication is enforced by the `authMiddleware` pre-handler hook, which verifies the JWT from the cookie and attaches the decoded user to `request.user`.

### Deactivated User Rejection

After JWT validation (or API key validation), the middleware checks the user's `is_active` status in the database. Deactivated users receive a `401 Account deactivated` response immediately, even if their JWT or API key is otherwise valid. This check uses Redis caching (5-minute TTL) to avoid a database query on every request.

### Registration Email — Fire-and-Forget

After a user registers, the verification email is sent in a **fire-and-forget** manner (`.catch()` swallows delivery errors). Registration succeeds and a 201 response is returned regardless of whether the email is delivered. This design prevents email service outages (Resend downtime, DNS issues, etc.) from blocking new user signups. If a user does not receive their verification email, they can request a new one via `POST /api/v1/auth/resend-verification` (rate-limited to prevent abuse).

---

## 2. OAuth 2.1 (MCP / Claude Web)

An OAuth 2.1 authorization code flow is implemented in the MCP server (`mcp-server/src/oauth/`) to allow Claude Web and other MCP clients to authenticate on behalf of users:

- **Authorization endpoint** -- renders a consent/authorize page.
- **Token endpoint** -- exchanges authorization codes for access tokens.
- **Client registration** -- managed via `clientsStore.ts`; clients are validated per-request.

This enables per-user scoped access when the PM Assistant is used as a remote MCP tool.

---

## 3. API Keys

API keys provide programmatic access for integrations, CI/CD pipelines, and external agents.

| Property | Details |
|---|---|
| **Format** | `kpm_<40 hex chars>` |
| **Storage** | SHA-256 hash stored in the database; raw key shown only at creation |
| **Scopes** | `read`, `write`, `admin` (hierarchical) |
| **Rate limit** | Per-key configurable; default 100 requests/minute |
| **Expiration** | Optional `expires_at` date |
| **Usage logging** | Every request is logged with method, URL, status code, response time, and IP |

Keys are resolved globally in the `onRequest` hook (`plugins.ts`). If a valid `Bearer kpm_*` token is found, the request is tagged with `apiKeyId`, `apiKeyScopes`, and `apiKeyRateLimit` for downstream middleware.

---

## 4. Scope-Based Authorization

The `requireScope` middleware (`src/server/middleware/requireScope.ts`) gates individual routes:

```
admin  >  write  >  read
```

- **JWT session users** bypass scope checks -- their access is governed by role.
- **API key users** must hold a scope equal to or higher than the route requirement.

Usage in a route:

```typescript
fastify.get('/projects', { preHandler: [authMiddleware, requireScope('read')] }, handler);
fastify.post('/projects', { preHandler: [authMiddleware, requireScope('write')] }, handler);
```

### Stripe Billing Routes — Intentional Read Scope

`POST /stripe/create-checkout-session`, `POST /stripe/create-topup-session`, and `POST /stripe/billing-portal` are gated with `requireScope('read')` rather than `requireScope('write')`. This is intentional: all authenticated users, including those whose API keys carry only the `read` scope (e.g., the default `team_member` role), need to be able to manage their own billing, subscription, and token top-up purchases without requiring elevated write access. These routes do not modify project data, so the lower scope is appropriate.

---

## 4b. Project-Level Access Control

The `requireProjectAccess` middleware (`src/server/middleware/requireProjectAccess.ts`) enforces **project-scoped** access. While `requireScope` controls *what actions* a user can perform globally, `requireProjectAccess` controls *which projects* a user can access and at what level.

### Two-Layer Authorization

Every project-scoped route runs both middlewares in sequence:

```typescript
fastify.get('/:scheduleId/tasks', {
  preHandler: [requireScope('read'), requireProjectAccess('viewer')],
}, handler);
```

1. **`requireScope`** — Can this user role perform read/write/admin actions at all?
2. **`requireProjectAccess`** — Is this user a member of this specific project with sufficient project role?

### Project Role Hierarchy

```
owner  >  manager  >  editor  >  viewer
```

| Project Role | Read | Write (tasks, comments, time) | Admin (delete, manage members) |
|---|---|---|---|
| **owner** | Yes | Yes | Yes |
| **manager** | Yes | Yes | No |
| **editor** | Yes | Yes (tasks, comments, time only) | No |
| **viewer** | Yes | No | No |
| **Non-member** | No | No | No |

### Global Role Bypasses

| Global User Role | Bypass Behavior |
|---|---|
| `admin`, `pmo` | Full access to all projects (no membership required) |
| `executive` | Read-only access to all projects (write/admin denied) |
| All other roles | Must be a project member with sufficient project role |

### Security Design

- **404 for non-members** — prevents information leakage. An attacker cannot distinguish "project exists but I have no access" from "project does not exist."
- **403 for insufficient role** — returned only to confirmed members who lack the required project role.
- **Project ID extraction** — the middleware resolves the project from `params.projectId`, `params.scheduleId` (via DB lookup), `params.id` (on `/api/v1/projects` routes), or `request.body.projectId`.
- **Auto-owner on creation** — when a project is created, the creator is automatically added as `owner` in `project_members`.

### Protected Routes

The middleware is applied to all project-scoped routes across schedules, sprints, approval workflows, resources, RAID/risk items, project member management, portal links, and project CRUD endpoints. Routes without a project context (e.g., `GET /projects` list) are not affected — the middleware skips when no projectId can be extracted.

---

## 5. Password Security

- Passwords are hashed with **bcrypt** before storage (`UserService.ts`).
- Password reset uses a time-limited, single-use email token.
- Raw passwords are never logged or returned in API responses.

---

## 6. Security Headers

The server registers **Helmet** (`@fastify/helmet`) which sets the following headers:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (via `frameguard`) |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Powered-By` | Removed (`hidePoweredBy`) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Camera, microphone, geolocation, payment, USB disabled |

Client-side `<meta>` tags in `index.html` mirror several of these headers as a defense-in-depth measure.

---

## 7. CORS

CORS is configured in `plugins.ts` with environment-aware origin validation:

```
Allowed origins:
  - localhost:*        (any port, development convenience)
  - CORS_ORIGIN env    (production domain)
  - claude.ai / *.anthropic.com / *.claude.ai  (MCP access)
  - All origins        (development mode fallback)
```

Credentials are enabled. Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`. The `Mcp-Session-Id` header is both allowed and exposed for MCP transport.

---

## 8. Content Security Policy (CSP)

CSP is enforced via Helmet with environment-specific behavior:

| Mode | Behavior |
|---|---|
| **Development** | `report-only` -- violations logged but not blocked |
| **Production** | Enforced -- violations blocked |

Key directives:

```
default-src   'self'
script-src    'self' (+ 'unsafe-eval' 'unsafe-inline' in dev; 'unsafe-inline' in prod)
style-src     'self' 'unsafe-inline' https://fonts.googleapis.com
img-src       'self' data: blob: https:
connect-src   'self' (+ localhost in dev; wss: in prod)
font-src      'self' https://fonts.gstatic.com
object-src    'none'
frame-src     'self' https://checkout.stripe.com https://js.stripe.com
```

---

## 9. Cookie Security

Cookies are registered via `@fastify/cookie`:

```typescript
{
  secret: config.COOKIE_SECRET,
  parseOptions: {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
  }
}
```

- `httpOnly` prevents JavaScript access (XSS mitigation).
- `secure` ensures cookies are only sent over HTTPS in production.
- `sameSite: 'lax'` mitigates CSRF while allowing top-level navigations.

---

## 10. Input Validation

All API endpoints use **Zod v4** schemas for runtime request validation:

- Route parameters, query strings, and request bodies are validated before handlers execute.
- Invalid input returns a structured 400 error with field-level details.
- Schemas are co-located with their route files for maintainability.

Validation is applied across the main server routes and all MCP tool handlers (`mcp-server/src/tools/`).

### Optimistic Locking

The project update endpoint (`PUT /projects/:id`) supports an optional `expectedUpdatedAt` field. When provided, the server compares it against the current `updatedAt` timestamp in the database. If they differ (another user saved in the meantime), the server returns **409 Conflict** with `{ error: 'Conflict', message: 'Modified by someone else', serverUpdatedAt }`. The client displays a "Someone else saved — Refresh" message instead of silently overwriting.

---

## 10a. Output Sanitization

All user-facing HTML rendering uses **DOMPurify** on the client side to prevent XSS:

- **Project Brief** (`ProjectBriefCard.tsx`) — Markdown is parsed to HTML via `marked` (GFM mode) in `renderMarkdown.ts` and sanitized via `DOMPurify.sanitize()` before insertion with `dangerouslySetInnerHTML`. Links get `target="_blank" rel="noopener noreferrer"` added post-parse.
- **Status Report Modal** (`StatusReportModal.tsx`) — AI-generated HTML status reports are sanitized via `DOMPurify.sanitize()` before rendering.
- **Output sanitization only** — DOMPurify at every render site (ProjectBriefCard, StatusReportModal, QueryPage) is the security boundary. Server-side input stripping (`stripDangerousHtml`) was removed from the project create/update path because it mutated stored user text (data loss) and was bypassable (SVG payloads, nested tags, entity encoding). The correct approach is to store text verbatim and sanitize on output. **Notifications** are scoped per-user via `WebSocketService.sendToUser()` — notification events are delivered only to the target user's WebSocket connections, preventing sensitive data (user names, project names, decisions) from leaking to other clients.
- **WebSocket connection limits** — Per-user cap of 5 concurrent WebSocket connections (oldest closed on overflow) and 2,000 global cap prevent resource exhaustion. Ping/pong keepalive (30s interval, 10s timeout) terminates stale connections.

---

## 11. Rate Limiting

Rate limiting operates at two levels:

1. **Per-API-key** -- Each API key has a configurable `rate_limit` (default 100 req/min). The in-memory `rateLimiter` middleware tracks usage per key and returns `429 Too Many Requests` with `Retry-After` when exceeded. Response headers include:
   - `X-RateLimit-Limit`
   - `X-RateLimit-Remaining`
   - `X-RateLimit-Reset`

2. **Global / security middleware** -- The `securityMiddleware` hook runs on every request for additional request-level checks.

---

## 12. Audit Ledger

The audit ledger (`AuditLedgerService.ts`) provides an immutable, append-only record of all significant actions:

- **SHA-256 hash chain** -- Each entry stores `prevHash` and its own `entryHash`, creating a tamper-evident chain.
- **Database triggers** prevent `UPDATE` and `DELETE` on the audit table.
- **Actor tracking** -- Every entry records `actorId`, `actorType` (`user`, `api_key`, `system`), and `source` (`web`, `mcp`, `api`, `system`).
- **Queryable** -- Entries can be filtered by project, entity, actor, action, and date range.

This provides a forensic-grade trail suitable for compliance audits and incident investigation.

---

## 13. Policy Engine

The policy engine (`PolicyEngineService.ts`) provides pre-action governance gates:

- **Policies** define an `actionPattern`, a `conditionExpr` (field + operator + value), and an `enforcement` level.
- **Enforcement levels**:
  - `log_only` -- record the evaluation, allow the action.
  - `require_approval` -- block until an approver authorizes.
  - `block` -- deny the action outright.
- **Evaluation context** includes actor, role, entity, project, and arbitrary data (e.g., budget impact, days to deadline).
- Every evaluation is persisted for audit purposes.

Example use case: block any task reassignment where `budget_impact > 10000` unless approved by a project admin.

---

## 14. Webhook Security

Outbound webhooks (`WebhookService.ts`) are secured with HMAC signatures:

- Each webhook registration generates a unique secret (32-byte random hex).
- Deliveries are signed so the receiver can verify authenticity.
- Failed deliveries increment a `failure_count`; the service tracks `last_status_code` for monitoring.

---

## 15. Stakeholder Portal Access

The stakeholder portal (`PortalService.ts`, `src/server/routes/portal.ts`) provides limited external access:

- Access is granted via a single-use or time-limited **portal token**.
- Portal sessions are scoped to **read-only** access on specific project data.
- No JWT session or API key is required -- the token itself is the credential.

---

## 16. Development vs Production

| Aspect | Development | Production |
|---|---|---|
| CSP | Report-only | Enforced |
| `script-src` | Includes `'unsafe-eval'` for HMR | No `'unsafe-eval'` |
| HSTS | Disabled | Enabled (1 year, preload) |
| Cookies | `secure: false` | `secure: true` |
| CORS | All origins allowed as fallback | Strict origin validation |
| Logging | Verbose security logging | Minimal |

---

## 17. Deployment Checklist

Before deploying to production, verify the following:

- [ ] `NODE_ENV` is set to `production`
- [ ] `COOKIE_SECRET` is a strong random value (minimum 32 characters)
- [ ] `JWT_SECRET` is a strong random value, different from `COOKIE_SECRET`
- [ ] `CORS_ORIGIN` is set to the exact production domain
- [ ] HTTPS is terminated by the reverse proxy (LiteSpeed / Nginx)
- [ ] Database credentials are not committed to version control
- [ ] `AI_ENABLED` is set intentionally (controls Claude SDK features)
- [ ] API key rate limits are configured appropriately
- [ ] Audit ledger database triggers are in place (prevent UPDATE/DELETE)
- [ ] OAuth client secrets for MCP are stored securely
- [ ] Webhook secrets are unique per registration
- [ ] Password reset email configuration is verified

---

## 18. Privacy Policy and Third-Party Data Processors

The **Privacy Policy** page (`/privacy`) discloses the application's use of third-party services that may process user data:

- **Google Analytics (GA4)** -- The application uses GA4 for usage analytics. GA4 sets the cookies `_ga` and `_ga_*` in the user's browser. Data collected (page views, session duration, events) is transferred to Google's servers, which may be located outside the user's country of residence.
- **International data transfers** -- By using the application, users acknowledge that their data may be transferred to and processed in jurisdictions with different data protection laws than their own.
- **Google as a data processor** -- Google is listed as a third-party data processor in the Privacy Policy. Users can review Google's own privacy policy and opt out of GA4 tracking via standard browser mechanisms (e.g., browser settings, GA opt-out browser add-on).

The CSP `connect-src` directive does **not** need to be widened for GA4 — GA4 uses its own measurement protocol and loads via the `script-src` allowlist. Verify that `https://www.google-analytics.com` and `https://www.googletagmanager.com` are included in the production CSP `script-src` if GA4 is active.

---

## 19. Testing

### Security Headers

```bash
# Verify security headers on a production endpoint
curl -I https://your-domain.com/api/health

# Expected: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, CSP, etc.
```

### CORS Rejection

```bash
# Expect CORS error from unauthorized origin
curl -H "Origin: https://malicious-site.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS https://your-domain.com/api/auth/login
```

### Rate Limiting

```bash
# Send requests and observe X-RateLimit-* headers
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code} " \
    -H "Authorization: Bearer kpm_your_key_here" \
    https://your-domain.com/api/projects
done
```

### API Key Scope Enforcement

```bash
# A read-only key should receive 403 on write endpoints
curl -X POST -H "Authorization: Bearer kpm_read_only_key" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' \
  https://your-domain.com/api/projects
```

---

## 20. Related Files

| File | Purpose |
|---|---|
| `src/server/plugins.ts` | Helmet, CORS, cookie, rate limiting, API key resolution |
| `src/server/middleware/requireScope.ts` | Scope-based authorization middleware |
| `src/server/middleware/requireProjectAccess.ts` | Project-level membership + role enforcement |
| `src/server/middleware/securityMiddleware.ts` | Request-level security checks |
| `src/server/middleware/rateLimiter.ts` | In-memory rate limiter |
| `src/server/routes/auth.ts` | Login, logout, refresh, password reset |
| `src/server/routes/apiKeys.ts` | API key CRUD endpoints |
| `src/server/routes/portal.ts` | Stakeholder portal routes |
| `src/server/services/UserService.ts` | Password hashing (bcrypt) |
| `src/server/services/ApiKeyService.ts` | API key creation, validation, usage logging |
| `src/server/services/AuditLedgerService.ts` | Immutable audit ledger with hash chain |
| `src/server/services/PolicyEngineService.ts` | Pre-action policy evaluation |
| `src/server/services/WebhookService.ts` | Webhook registration and signed delivery |
| `src/server/services/PortalService.ts` | Portal token management |
| `src/server/middleware/auth.ts` | JWT authentication middleware |
| `src/server/routes/users.ts` | User management routes |
| `mcp-server/src/oauth/provider.ts` | OAuth 2.1 authorization server (MCP transport) |
| `mcp-server/src/oauth/clientsStore.ts` | OAuth client registration (MCP transport) |
| `src/client/index.html` | Client-side security meta tags |
| `src/client/src/services/securityService.ts` | Client-side security utilities |

---

Security is an ongoing process. Keep dependencies updated, review audit logs regularly, and conduct periodic penetration testing.
