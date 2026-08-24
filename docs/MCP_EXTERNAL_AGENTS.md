# MCP External Access — Connecting AI Agents

PM Assistant exposes its full toolset via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), allowing external AI agents (Claude Desktop, custom agents, CI/CD pipelines) to manage projects, tasks, risks, and reports programmatically.

## Authentication

Two authentication methods are supported:

### 1. API Key (recommended for programmatic access)

Generate an API key in **Settings > API Keys**, then pass it as a Bearer token:

```
Authorization: Bearer pm_abc123...
```

The key inherits the creating user's role and permissions. Rate limits are per-key (default: 100 requests/minute).

### 2. OAuth2 + PKCE (interactive agents like Claude Desktop)

The MCP server implements the standard OAuth2 authorization code flow with PKCE. See the Claude Desktop configuration below.

## Claude Desktop Configuration

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pm-assistant": {
      "url": "https://kovarti.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}
```

Or for OAuth (interactive login):

```json
{
  "mcpServers": {
    "pm-assistant": {
      "url": "https://kovarti.com/mcp"
    }
  }
}
```

## Available Tools

Over 80 tools are available, organized by category. The tools visible to each user depend on their role.

| Category | Examples |
|---|---|
| Projects | create-project, update-project, list-projects, get-project-health |
| Tasks | create-task, update-task, bulk-create-tasks, ai-estimate-task |
| Schedules | create-schedule, get-critical-path, detect-delays |
| Sprints | create-sprint, start-sprint, complete-sprint, get-sprint-board |
| Resources | create-resource, get-resource-workload, find-skill-match |
| Risks (RAID) | create-raid-item, list-raid-items, ai-scan-risks |
| Reports | generate-status-report, run-report, get-analytics-summary |
| AI Insights | get-predictions-dashboard, detect-patterns, natural-language-query |
| Financial | get-spend-to-date, get-burn-rate, get-budget-forecast |
| Approvals | submit-for-approval, act-on-approval, list-proposals |
| Time Tracking | log-time, get-timesheet, get-time-entries |
| Integrations | create-integration, sync-integration |
| Admin | get-alerts, list-notifications, get-audit-trail |

## Rate Limits

- **API key requests:** Per-key rate limit (default 100/min, configurable per key)
- **Rate limit headers** are returned on every response:
  - `X-RateLimit-Limit` — max requests per window
  - `X-RateLimit-Remaining` — requests left in current window
  - `X-RateLimit-Reset` — Unix timestamp when the window resets
- **429 Too Many Requests** is returned when the limit is exceeded, with a `retryAfter` field (seconds)

Rate limits apply to both `/api/v1/*` and `/mcp` proxy routes.

## Monitoring & Analytics

All MCP tool invocations are logged with timing, success/failure, and user attribution.

### Admin Analytics Endpoint

```
GET /api/v1/admin/mcp-analytics?since=2026-07-01&groupBy=tool
```

**Query parameters:**
- `since` — ISO date/datetime, filter invocations after this time
- `until` — ISO date/datetime, filter invocations before this time
- `groupBy` — `tool` (default), `user`, or `day`

**Response:**
```json
{
  "totalInvocations": 1234,
  "successRate": 0.97,
  "avgDurationMs": 245.3,
  "groupBy": "tool",
  "breakdown": [
    {
      "toolName": "list-tasks",
      "invocations": 312,
      "successRate": 0.99,
      "avgDurationMs": 180.5
    }
  ]
}
```

Requires admin role. Data is retained for 90 days (configurable via `RETENTION_MCP_INVOCATION_DAYS`).

## Security Notes

- API keys are hashed (SHA-256) before storage; the raw key is only shown once at creation
- Keys can be scoped to read-only or read+write
- Keys can be deactivated or set to expire
- Role-based tool filtering ensures users only see tools their role permits
- All tool invocations are logged for audit purposes
