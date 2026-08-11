# Testing Guide - PM Assistant Generic

**Last updated:** February 28, 2026
**Stack:** Fastify + TypeScript (server), React 18 + Vite + Tailwind CSS (client)
**Database:** MariaDB on TMD Hosting (no local database)
**Production URL:** https://pm.kpbc.ca

---

## 1. Build Verification

The project has two build targets: server (TypeScript compiled with `tsc`) and client (TypeScript check + Vite bundle).

### Full build

```bash
npm run build
```

This runs `npm run build:server && npm run build:client`.

### Server build

```bash
npm run build:server
# Equivalent to: tsc --project tsconfig.json
```

The server build must complete with zero errors. Output goes to `dist/server/`.

### Client build

```bash
npm run build:client
# Equivalent to: cd src/client && tsc && vite build
```

The client `tsc` step has pre-existing type errors (see section 7 below) but Vite still emits output to `dist/client/`. A successful build ends with Vite printing the bundle summary.

### Type-check only (server)

```bash
npm run type-check
# Equivalent to: tsc --noEmit
```

---

## 2. API Testing Patterns

All API testing is done with `curl` against the production server at `https://pm.kpbc.ca`. There is no local database, so all testing hits the live environment.

### General conventions

- Base URL: `https://pm.kpbc.ca/api/v1`
- Authentication: HTTP-only cookies (`access_token` and `refresh_token`) set by the login endpoint
- Use a cookie jar file (`-b cookies.txt -c cookies.txt`) to persist the session
- All request/response bodies are JSON
- Authenticated endpoints require the `access_token` cookie; unauthenticated requests return `401`

### Useful curl flags

```bash
# -s  silent (no progress bar)
# -S  show errors even in silent mode
# -b  read cookies from file
# -c  write cookies to file
# -H  set header
# -d  POST body (implies POST method)
# -X  explicit HTTP method
# -w '\n'  add newline after response
# | jq .  pretty-print JSON (install jq separately)
```

---

## 3. Login Flow

Authentication uses cookie-based JWT. Login sets HTTP-only `access_token` and `refresh_token` cookies.

### Step 1: Log in and capture cookies

```bash
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_USER","password":"YOUR_PASS"}' \
  https://pm.kpbc.ca/api/v1/auth/login | jq .
```

Expected response:

```json
{
  "message": "Login successful",
  "user": {
    "id": "...",
    "username": "YOUR_USER",
    "email": "...",
    "role": "admin"
  }
}
```

The `cookies.txt` file now contains the `access_token` and `refresh_token` cookies.

### Step 2: Use authenticated requests

All subsequent curl commands should include `-b cookies.txt`:

```bash
curl -s -b cookies.txt https://pm.kpbc.ca/api/v1/projects | jq .
```

---

## 4. Testing the Workflow Engine

The workflow engine is a DAG-based system at `/api/v1/workflows`. Workflows are composed of nodes (trigger, condition, action, approval, delay, agent) connected by edges. Workflows fire automatically on task create/update events, project budget/status changes, and via a 15-minute overdue-task scanner.

### 4a. Create a workflow definition

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{
    "name": "Test Workflow",
    "description": "Integration test workflow",
    "nodes": [
      {
        "nodeType": "trigger",
        "name": "On task create",
        "config": {"event": "task.created"}
      },
      {
        "nodeType": "action",
        "name": "Set priority high",
        "config": {"action": "set_field", "field": "priority", "value": "high"}
      }
    ],
    "edges": [
      {"sourceIndex": 0, "targetIndex": 1}
    ]
  }' \
  https://pm.kpbc.ca/api/v1/workflows | jq .
```

Save the returned `definition.id` for subsequent steps.

### 4b. List workflow definitions

```bash
curl -s -b cookies.txt https://pm.kpbc.ca/api/v1/workflows | jq .
```

### 4c. Get a single workflow definition

```bash
curl -s -b cookies.txt https://pm.kpbc.ca/api/v1/workflows/WORKFLOW_ID | jq .
```

### 4d. Enable/disable a workflow

```bash
curl -s -b cookies.txt -X PATCH -H 'Content-Type: application/json' \
  -d '{"enabled": true}' \
  https://pm.kpbc.ca/api/v1/workflows/WORKFLOW_ID/toggle | jq .
```

### 4e. Trigger a workflow manually

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"entityType": "task", "entityId": "TASK_ID"}' \
  https://pm.kpbc.ca/api/v1/workflows/WORKFLOW_ID/trigger | jq .
```

Save the returned `execution.id` for verification.

### 4f. List executions

```bash
curl -s -b cookies.txt \
  'https://pm.kpbc.ca/api/v1/workflows/executions?workflowId=WORKFLOW_ID' | jq .
```

### 4g. Get execution detail

```bash
curl -s -b cookies.txt \
  https://pm.kpbc.ca/api/v1/workflows/executions/EXECUTION_ID | jq .
```

Check that `status` is `completed`, `running`, or `waiting` as expected.

### 4h. Generate a workflow with AI

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"description": "When a task is marked complete, send a notification to the project manager and log the completion"}' \
  https://pm.kpbc.ca/api/v1/workflows/generate | jq .
```

Verify:
- Response contains `workflow` with `name`, `description`, `nodes[]`, `edges[]`
- First node has `nodeType: "trigger"`
- Edge indices are within bounds of the nodes array
- Requires `write` scope and `AI_ENABLED=true`

### 4i. Clean up test workflow

```bash
curl -s -b cookies.txt -X DELETE \
  https://pm.kpbc.ca/api/v1/workflows/WORKFLOW_ID | jq .
```

Requires admin scope.

---

## 5. Testing DAG Features: Conditions, Approval Gates, Resume

### 5a. Workflow with a condition node

Create a workflow that branches based on a condition:

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{
    "name": "Conditional Workflow",
    "nodes": [
      {"nodeType": "trigger", "name": "Start", "config": {"event": "task.updated"}},
      {"nodeType": "condition", "name": "Is high priority?", "config": {"field": "priority", "operator": "eq", "value": "high"}},
      {"nodeType": "action", "name": "Escalate", "config": {"action": "notify", "channel": "email"}},
      {"nodeType": "action", "name": "Log only", "config": {"action": "log"}}
    ],
    "edges": [
      {"sourceIndex": 0, "targetIndex": 1},
      {"sourceIndex": 1, "targetIndex": 2, "conditionExpr": {"result": true}, "label": "yes"},
      {"sourceIndex": 1, "targetIndex": 3, "conditionExpr": {"result": false}, "label": "no"}
    ]
  }' \
  https://pm.kpbc.ca/api/v1/workflows | jq .
```

Trigger it and verify that the execution follows the correct branch by inspecting node statuses in the execution detail.

### 5b. Workflow with an approval gate

Approval nodes pause execution until a human approves or rejects:

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{
    "name": "Approval Workflow",
    "nodes": [
      {"nodeType": "trigger", "name": "Start", "config": {"event": "task.created"}},
      {"nodeType": "approval", "name": "Manager approval", "config": {"approvers": ["admin"]}},
      {"nodeType": "action", "name": "Proceed", "config": {"action": "set_field", "field": "status", "value": "approved"}}
    ],
    "edges": [
      {"sourceIndex": 0, "targetIndex": 1},
      {"sourceIndex": 1, "targetIndex": 2}
    ]
  }' \
  https://pm.kpbc.ca/api/v1/workflows | jq .
```

### 5c. Trigger and verify waiting state

After triggering, the execution should pause at the approval node:

```bash
# Trigger
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"entityType": "task", "entityId": "TASK_ID"}' \
  https://pm.kpbc.ca/api/v1/workflows/WORKFLOW_ID/trigger | jq .

# Check execution — status should be "waiting"
curl -s -b cookies.txt \
  https://pm.kpbc.ca/api/v1/workflows/executions/EXECUTION_ID | jq .
```

### 5d. Resume a waiting execution

Supply the approval node ID and the result (approved/rejected):

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"nodeId": "APPROVAL_NODE_ID", "result": {"approved": true}}' \
  https://pm.kpbc.ca/api/v1/workflows/executions/EXECUTION_ID/resume | jq .
```

After resuming, re-fetch the execution detail to confirm status changed to `completed` (or continued to the next node).

---

## 5e. Testing Event-Driven Triggers

Workflows now fire automatically on task and project lifecycle events. No manual trigger is needed.

### Test: Task update triggers workflow

Update a task's status and verify a workflow execution was created:

```bash
# Update a task status to trigger status_change workflows
curl -s -b cookies.txt -X PATCH -H 'Content-Type: application/json' \
  -d '{"status": "completed"}' \
  https://pm.kpbc.ca/api/v1/schedules/SCHEDULE_ID/tasks/TASK_ID | jq .

# Check workflow executions — should see a new execution
curl -s -b cookies.txt \
  'https://pm.kpbc.ca/api/v1/workflows/executions?entityId=TASK_ID' | jq .
```

### Test: Priority escalation triggers notification

Change a task priority to `urgent` and verify the "On task marked urgent" workflow fires:

```bash
curl -s -b cookies.txt -X PATCH -H 'Content-Type: application/json' \
  -d '{"priority": "urgent"}' \
  https://pm.kpbc.ca/api/v1/schedules/SCHEDULE_ID/tasks/TASK_ID | jq .

# Check notifications for the project manager
curl -s -b cookies.txt https://pm.kpbc.ca/api/v1/notifications | jq .
```

### Test: New task triggers task_created workflows

Create a task and verify `task_created` trigger workflows execute:

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"name": "New event test task", "scheduleId": "SCHEDULE_ID", "status": "pending"}' \
  https://pm.kpbc.ca/api/v1/schedules/SCHEDULE_ID/tasks | jq .
```

### Test: Overdue scanner

The overdue scanner runs every 15 minutes (configurable via `AGENT_OVERDUE_SCAN_MINUTES`). To verify:

1. Create a task with `endDate` in the past
2. Wait for the next scanner cycle (or restart the server)
3. Check `workflow_executions` table for a `date_passed` trigger execution

---

## 5b. Testing Dependency Validation

Tasks support up to 20 predecessors via the `dependencies[]` array. The server enforces dependency rules on all create/update task requests. All tests require an authenticated session (see section 3).

The legacy single `dependency` field is still accepted for backward compatibility, but the preferred format is:

```json
{
  "dependencies": [
    { "dependencyId": "TASK_ID", "dependencyType": "FS", "lagDays": 0 },
    { "dependencyId": "TASK_ID_2", "dependencyType": "SS", "lagDays": 2 }
  ]
}
```

### Self-reference (expect 400)

```bash
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"dependencies\":[{\"dependencyId\":\"$TASK_ID\"}]}"
# Expected: {"error":"Validation error","message":"A task cannot depend on itself"}
```

### Nonexistent dependency (expect 400)

```bash
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{"dependencies":[{"dependencyId":"00000000-0000-0000-0000-000000000000"}]}'
# Expected: {"error":"Validation error","message":"Dependency task '...' not found"}
```

### Circular dependency (expect 400)

```bash
# First set A→B (should succeed)
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_A" \
  -H 'Content-Type: application/json' \
  -d "{\"dependencies\":[{\"dependencyId\":\"$TASK_B\"}]}"

# Then try B→A (should fail with 400)
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_B" \
  -H 'Content-Type: application/json' \
  -d "{\"dependencies\":[{\"dependencyId\":\"$TASK_A\"}]}"
# Expected: {"error":"Validation error","message":"Circular dependency detected..."}
```

### Cross-schedule dependency (expect 400)

```bash
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"dependencies\":[{\"dependencyId\":\"$TASK_IN_OTHER_SCHEDULE\"}]}"
# Expected: {"error":"Validation error","message":"Dependency must be in the same schedule"}
```

### Max 20 predecessors (expect 400)

```bash
# Create a task with 21 dependencies — should fail
curl -s -b cookies.txt -X PUT \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{"dependencies":[...21 items...]}'
# Expected: 400 validation error (max 20)
```

### Cascade cleanup on delete

```bash
# Set A→B, then delete B. Junction table rows are cascade-deleted automatically:
curl -s -b cookies.txt -X DELETE \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks/$TASK_B"
# Then GET task A and confirm B is removed from its dependencies array
```

### Multiple predecessors

```bash
# Create a task with two predecessors (FS and SS with 2-day lag)
curl -s -b cookies.txt -X POST \
  "https://pm.kpbc.ca/api/v1/schedules/$SCHED/tasks" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Integration Testing",
    "dependencies": [
      { "dependencyId": "'$TASK_A'", "dependencyType": "FS", "lagDays": 0 },
      { "dependencyId": "'$TASK_B'", "dependencyType": "SS", "lagDays": 2 }
    ]
  }'
# Expected: 201 with dependencies array in response
```

---

## 5c. Testing Project-Level Access Control

The `requireProjectAccess` middleware enforces project membership on all project-scoped routes. These tests require two authenticated sessions: one for a project member and one for a non-member.

### Setup: Create two sessions

```bash
# Login as admin (has global bypass)
curl -s -c admin-cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  https://pm.kpbc.ca/api/v1/auth/login

# Login as a regular user (team_member role)
curl -s -c member-cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"password"}' \
  https://pm.kpbc.ca/api/v1/auth/login
```

### Test: Non-member gets 404

```bash
# As a non-member, accessing a project should return 404
curl -s -b member-cookies.txt \
  https://pm.kpbc.ca/api/v1/projects/$PROJECT_ID | jq .
# Expected: {"error":"Not found","message":"The requested resource was not found"}
```

### Test: Admin bypasses membership check

```bash
# Admin can access any project without being a member
curl -s -b admin-cookies.txt \
  https://pm.kpbc.ca/api/v1/projects/$PROJECT_ID | jq .
# Expected: 200 with project data
```

### Test: Viewer cannot create tasks (403)

```bash
# Add testuser as viewer first (via admin)
curl -s -b admin-cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"testuser@example.com","role":"viewer"}' \
  https://pm.kpbc.ca/api/v1/project-members/$PROJECT_ID

# Now testuser can read but not write
curl -s -b member-cookies.txt \
  https://pm.kpbc.ca/api/v1/schedules/project/$PROJECT_ID | jq .
# Expected: 200 (read allowed)

curl -s -b member-cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Test task","status":"pending"}' \
  https://pm.kpbc.ca/api/v1/schedules/$SCHEDULE_ID/tasks | jq .
# Expected: {"error":"Insufficient project role","message":"This action requires the 'editor' project role. You have: 'viewer'"}
```

### Test: Project creator is auto-added as owner

```bash
# Create a new project as the regular user
curl -s -b member-cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Access Test Project"}' \
  https://pm.kpbc.ca/api/v1/projects | jq .
# Save the project ID

# Verify the creator can access it (they're auto-added as owner)
curl -s -b member-cookies.txt \
  https://pm.kpbc.ca/api/v1/projects/$NEW_PROJECT_ID | jq .
# Expected: 200 with project data
```

### Unit tests

36 unit tests cover the middleware in `src/server/__tests__/middleware/requireProjectAccess.test.ts`:
- Project ID extraction from params, scheduleId lookup, body, and route matching
- Global role bypasses (admin, pmo, executive)
- Membership enforcement (404 for non-members, 403 for insufficient role)
- Full 4×4 role hierarchy matrix (viewer/editor/manager/owner)

```bash
npx vitest run src/server/__tests__/middleware/requireProjectAccess.test.ts
```

---

## 6. Database Verification

The database is MariaDB hosted on TMD Hosting. There is no local database instance. All database verification is done via SSH.

### Connect to the database

```bash
ssh YOUR_USER@pm.kpbc.ca
mariadb -u DB_USER -p DB_NAME
```

### Useful queries

**Check workflow definitions:**

```sql
SELECT id, name, is_enabled, created_at FROM wf_definitions ORDER BY created_at DESC LIMIT 10;
```

**Check workflow executions:**

```sql
SELECT id, workflow_id, status, entity_type, entity_id, started_at, finished_at
FROM wf_executions ORDER BY started_at DESC LIMIT 10;
```

**Check execution node states:**

```sql
SELECT en.id, en.execution_id, n.name, n.node_type, en.status, en.started_at, en.finished_at
FROM wf_execution_nodes en
JOIN wf_nodes n ON n.id = en.node_id
WHERE en.execution_id = 'EXECUTION_ID'
ORDER BY en.started_at;
```

**Check users:**

```sql
SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 10;
```

**Check projects:**

```sql
SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC LIMIT 10;
```

### Verify a migration ran

```sql
SHOW TABLES LIKE 'wf_%';
DESCRIBE wf_definitions;
```

### Verify the tasks end_date index

```sql
SHOW INDEX FROM tasks WHERE Key_name = 'idx_tasks_end_date';
SELECT * FROM _migrations WHERE name LIKE '015%';
```

---

## 7. Testing the Agentic Pipeline

### Running Agent Unit Tests

```bash
npx vitest run src/server/__tests__/services/agents/
```

This runs 19 test files with 223+ tests covering:

| Test File | What It Tests |
|-----------|--------------|
| `ConflictResolver.test.ts` | Staleness detection, entity conflict checks, stale proposal sweep |
| `ProposalRateLimiter.test.ts` | 4-tier rate limiting (agent/all-agents x 24h/7d) |
| `DegradationHandler.test.ts` | Circuit breaker states, DB health check, scan scope recommendation |
| `KillSwitchService.test.ts` | Global/agent/project kill switches, audit logging |
| `AgentFeedbackService.test.ts` | Feedback submission, health snapshots, aggregate stats |
| `ScopeCreepAgent.test.ts` | Guard chain (budget/kill switch/rate limit/breaker), indicator detection |
| `BudgetIntelligenceAgent.test.ts` | Guard chain, EVM indicator thresholds, proposal creation, error handling |
| `ResourceOptimizationAgent.test.ts` | Guard chain, workload indicator detection, proposal creation, error handling |
| `CrossProjectIntelligenceAgent.test.ts` | Guard chain, portfolio indicator gathering, cross-project pattern detection, proposal creation |
| `RiskEscalationAgent.test.ts` | Guard chain, compound risk detection (2+ agent flags), flag distribution, escalation proposal |
| `StakeholderCommunicationAgent.test.ts` | Guard chain, snapshot gathering, EVM computation, report generation, proposal creation |
| `ProjectHygieneAgent.test.ts` | Guard chain, stale task detection, missing data, abandoned sprints, zero-progress tasks |
| `DependencyRiskAgent.test.ts` | Guard chain, dependency graph traversal, blocked chains, bottleneck detection |
| `LessonsLearnedAgent.test.ts` | Guard chain, completion threshold, lesson extraction, deduplication |
| `ProjectStatusReportService.test.ts` | AI generation, fallback when unavailable, email delivery, error handling |
| `PredictiveAlertingAgent.test.ts` | Guard chain, velocity trend, progress trajectory, risk accumulation |
| `AutonomyService.test.ts` | Tier lookup, auto-execute gates, promotion eligibility, promote/demote |
| `ActionProposalService.test.ts` | Proposal creation via transaction, lifecycle |
| `ActionExecutor.test.ts` | Sequential execution, rollback on failure |
| `ConfidenceCalculator.test.ts` | Score computation, data quality scoring, weight verification |

### Testing Agent Health Endpoint

```bash
# Get agent system health (requires auth token)
curl -s http://pm.kpbc.ca/api/v1/agent/health \
  -H "Cookie: access_token=$TOKEN" | jq .
```

Expected fields: `status`, `claudeApiStatus`, `databaseStatus`, `circuitBreakers`, `killSwitch`, `recommendedScanScope`, `costs`, `pendingProposals`.

### Testing Kill Switch API

```bash
# Get current kill switch state
curl -s http://pm.kpbc.ca/api/v1/agent/kill-switch \
  -H "Cookie: access_token=$TOKEN" | jq .

# Disable all agents globally (admin only)
curl -X POST http://pm.kpbc.ca/api/v1/agent/kill-switch \
  -H "Cookie: access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "disable"}' | jq .

# Re-enable all agents
curl -X POST http://pm.kpbc.ca/api/v1/agent/kill-switch \
  -H "Cookie: access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "enable"}' | jq .

# Disable a specific agent
curl -X PUT http://pm.kpbc.ca/api/v1/agent/kill-switch/agent/scope-creep-detection-v1 \
  -H "Cookie: access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}' | jq .
```

### Testing Agent Proposals

```bash
# List proposals
curl -s "http://pm.kpbc.ca/api/v1/agent/proposals?status=pending" \
  -H "Cookie: access_token=$TOKEN" | jq .

# Approve a proposal
curl -X POST http://pm.kpbc.ca/api/v1/agent/proposals/{id}/approve \
  -H "Cookie: access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Looks good"}' | jq .

# Submit feedback on executed proposal
curl -X POST http://pm.kpbc.ca/api/v1/agent/proposals/{id}/feedback \
  -H "Cookie: access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"outcome": "effective", "comment": "Fixed the delay"}' | jq .
```

### Testing the Agent Proposals UI

1. Log in as a manager or admin.
2. Click **Agent** in the sidebar -- the Agent Proposals page should load.
3. Verify the health banner shows agent system status (healthy/degraded).
4. Use the status tabs to filter proposals by status.
5. Click a proposal row to open the detail modal.
6. In the modal, verify:
   - Summary, reasoning, and confidence breakdown are displayed.
   - Proposed actions are listed with type, target, and values.
   - Pending proposals show Approve/Reject buttons with an optional comment field.
   - Approved proposals show an Execute button (admin only).
   - Executed proposals show Rollback (admin) and Feedback form.
7. Test approve/reject on a pending proposal -- the table should update after the action.
8. Verify non-admin users cannot see Execute/Rollback buttons.
9. Verify member-role users do not see the Agent nav item in the sidebar.

### Database Verification (Agent Tables)

```sql
-- Check agent tables exist
SHOW TABLES LIKE 'agent_%';

-- Check pending proposals
SELECT id, agent_id, status, confidence_score, risk_level, created_at
FROM agent_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10;

-- Check agent cost usage
SELECT agent_id, SUM(total_tokens) AS tokens, SUM(estimated_cost_usd) AS cost
FROM agent_cost_ledger WHERE DATE(created_at) = CURDATE() GROUP BY agent_id;

-- Check feedback stats
SELECT p.agent_id, f.outcome, COUNT(*) AS cnt
FROM agent_feedback f JOIN agent_proposals p ON p.id = f.proposal_id
GROUP BY p.agent_id, f.outcome;
```

---

## 8. Known Pre-existing Type Errors (Client)

The client TypeScript compilation (`tsc` in `src/client`) reports several known errors that do not block the Vite build. These are expected and do not need to be fixed for testing.

### ImportMeta.env errors

Files referencing `import.meta.env.VITE_*` may produce errors like:

```
Property 'env' does not exist on type 'ImportMeta'.
```

This is a TypeScript/Vite typing issue. Vite handles `import.meta.env` at build time; the types are not fully declared in the client `tsconfig.json`. The build still emits correctly.

### Unused imports

Some files have unused import warnings from stricter `tsc` checking. These do not affect runtime behavior.

### aiContextBuilder.ts

The file `src/server/services/aiContextBuilder.ts` has 3 pre-existing type errors. The server build still emits output because `noEmit` is not set and these are non-fatal.

---

## 9. Testing Recent Features (July 2026)

### 9a. Trial Reminder Cron

The trial reminder cron sends emails to users approaching or past their trial expiration. It deduplicates sends using Redis keys of the form `trial-reminder:{userId}:{type}`.

**Invoke directly (SSH to server):**

```bash
ssh ubuntu@147.5.127.99
node -e "
  const { runTrialReminders } = require('./dist/server/cron/trialReminders');
  runTrialReminders().then(() => { console.log('done'); process.exit(0); });
"
```

**Verify the cron schedule is registered:**

```bash
# Check server logs for the cron registration line on startup
sudo journalctl -u pm-app --since today | grep -i 'trial'
```

**Check Redis dedup keys:**

```bash
redis-cli keys 'trial-reminder:*'
# Expected: one key per user+type combination that was already emailed today
# TTL should be ~24 h
redis-cli ttl 'trial-reminder:USER_ID:expiring-soon'
```

**Verify emails sent:**

Open the Resend dashboard (resend.com) and filter by the sending domain. Confirm delivery records appear for users in the trial-expiry window. No duplicate sends should appear for the same user+type within the cooldown period.

---

### 9b. Onboarding WelcomeModal

The WelcomeModal appears on first login for new users. It is suppressed for returning users via two storage keys.

**Trigger the modal:**

1. Open browser DevTools (F12) → Application → Local Storage → delete the key `pm-generic-onboarding-seen`.
2. Application → Session Storage → delete the key `pm-first-login`.
3. In the database, ensure the test user has `lastLoginAt = null` (or has no projects):

```sql
UPDATE users SET last_login_at = NULL WHERE username = 'testuser';
```

4. Log in as that user. The WelcomeModal should appear automatically.

**Verify modal behaviour:**

- Three options are presented (e.g., "Create a project", "Import data", "Take a tour" — exact labels depend on implementation).
- Selecting an option dismisses the modal and navigates or initiates the chosen flow.
- After dismissal, refreshing the page must NOT show the modal again (`pm-generic-onboarding-seen` will be set in localStorage).
- Logging in again in the same browser session must NOT show the modal (`pm-first-login` session key is set).

---

### 9c. Google Analytics (GA4)

GA4 is injected via the standard gtag.js script. Verify it fires without a backend call.

**Browser Network tab check:**

1. Open the app in an incognito window (clears cached scripts).
2. Open DevTools → Network → filter by `google`.
3. Load any page (e.g., the dashboard).
4. Confirm a request to `https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX` appears with status 200.
5. Confirm subsequent `collect` or `g/collect` requests to `https://www.google-analytics.com/` appear as page-view events.

**GA4 real-time dashboard check:**

1. Log in to Google Analytics → select the PM Assistant property.
2. Navigate to **Reports → Realtime**.
3. Load a page in the app.
4. Within 30 seconds, confirm the page view appears in the Realtime report with the correct page path.

---

### 9d. Mobile Landing Page — Hamburger Menu

The landing page collapses its navigation into a hamburger menu below the `md` breakpoint (768 px).

**Test steps:**

1. Open `https://pm.kpbc.ca` (unauthenticated).
2. Open DevTools → toggle device toolbar (Ctrl+Shift+M / Cmd+Shift+M) and set width to 375 px.
3. Confirm the desktop nav links are hidden and a hamburger icon (three-line or equivalent) is visible.
4. Click the hamburger icon. A dropdown or slide-in menu should appear containing the same nav links (e.g., Features, Pricing, Login).
5. Click a nav link. The menu should close and the page should scroll or navigate correctly.
6. Resize the browser above 768 px. The hamburger icon should disappear and the full nav bar should reappear without a page reload.

---

### 9e. PricingPage Checkout Error Banner

When a Stripe checkout call fails (e.g., missing publishable key, network error, or server-side failure), the PricingPage must display an error banner above the Subscribe button rather than a blank screen or unhandled exception.

**Trigger the error (development):**

Set `VITE_STRIPE_PUBLISHABLE_KEY` to an invalid value (or leave it empty) in `src/client/.env.local`, then rebuild the client:

```bash
cd src/client
echo "VITE_STRIPE_PUBLISHABLE_KEY=pk_test_invalid" >> .env.local
npm run build
```

Alternatively, in the browser DevTools → Network tab, block requests to `js.stripe.com` (right-click → Block request domain) to simulate Stripe being unavailable.

**Verify the error banner:**

1. Navigate to the Pricing page.
2. Click a Subscribe button.
3. An error banner should appear above the button with a user-readable message (e.g., "Something went wrong. Please try again or contact support.").
4. The banner must not be a raw JavaScript exception or an empty page.
5. Dismissing the banner (if closeable) should hide it without reloading the page.

---

### 9f. E2E Tests (Playwright)

Playwright end-to-end tests cover critical user flows in the browser. Tests live in the `e2e/` directory and run against a local dev server.

**Prerequisites:**

1. Start the dev server: `npm run dev` (server on port 3001, client on port 5173)
2. Ensure a test user exists in the database (default: `admin` / `admin123`)
3. Install Playwright browsers (first time only): `npx playwright install chromium`

**Run all E2E tests:**

```bash
npm run test:e2e
```

**Run with UI (interactive mode):**

```bash
npm run test:e2e:ui
```

**Test files:**

| File | Flows Covered |
|------|---------------|
| `e2e/auth.spec.ts` | Login form, invalid credentials error, successful login + redirect, unauthenticated redirect, password visibility toggle |
| `e2e/project-crud.spec.ts` | Navigate to projects, create blank project from scratch, view project detail with tabs |
| `e2e/tasks.spec.ts` | Add a task from the schedule tab |
| `e2e/sprints.spec.ts` | Sprints tab navigation, sprint board (Kanban) view |
| `e2e/navigation.spec.ts` | Dashboard loads, sidebar navigation, 404 handling |

**Configuration:** `playwright.config.ts` — Chromium only, headless, screenshots on failure, traces retained on failure.

**Notes:**
- Tests skip gracefully when required data doesn't exist (e.g., no projects in the database)
- Test user credentials are in `e2e/helpers.ts` — update if your dev environment uses different credentials
- HTML test report generated at `playwright-report/` after each run

---

## Verification Checklist

### Build

- [ ] `npm run build:server` completes with zero errors
- [ ] `npm run build:client` completes (Vite prints bundle summary)
- [ ] `dist/server/index.js` exists after server build
- [ ] `dist/client/index.html` exists after client build

### Authentication

- [ ] POST `/api/v1/auth/login` returns 200 and sets `access_token` / `refresh_token` cookies
- [ ] Authenticated GET `/api/v1/projects` returns data with valid cookie
- [ ] Unauthenticated requests to protected endpoints return 401

### Workflow Engine

- [ ] POST `/api/v1/workflows` creates a definition with nodes and edges
- [ ] GET `/api/v1/workflows` lists definitions
- [ ] POST `/api/v1/workflows/:id/trigger` creates an execution
- [ ] GET `/api/v1/workflows/executions/:id` shows execution with node states
- [ ] Condition nodes route execution to the correct branch
- [ ] Approval nodes pause execution (status = `waiting`)
- [ ] POST `/api/v1/workflows/executions/:id/resume` resumes waiting execution
- [ ] DELETE `/api/v1/workflows/:id` removes test data

### Agentic Pipeline

- [ ] `npx vitest run src/server/__tests__/services/agents/` passes all tests (14 agent test files)
- [ ] GET `/api/v1/agent/health` returns status with `databaseStatus`, `circuitBreakers`, `killSwitch`
- [ ] GET `/api/v1/agent/kill-switch` returns current state
- [ ] POST `/api/v1/agent/kill-switch` with `{"action":"disable"}` blocks agent scans
- [ ] POST `/api/v1/agent/kill-switch` with `{"action":"enable"}` re-enables agents
- [ ] GET `/api/v1/agent/autonomy` returns autonomy configurations
- [ ] GET `/api/v1/agent/autonomy/:agentId/eligibility` returns promotion eligibility stats
- [ ] PUT `/api/v1/agent/autonomy/:agentId` with `{"action":"promote"}` promotes agent to Tier 3 (admin only)
- [ ] PUT `/api/v1/agent/autonomy/:agentId` with `{"action":"demote"}` demotes agent to Tier 2 (admin only)

### Database

- [ ] SSH connection to server works
- [ ] `wf_definitions`, `wf_nodes`, `wf_edges`, `wf_executions`, `wf_execution_nodes` tables exist
- [ ] `agent_proposals`, `agent_proposal_actions`, `agent_feedback`, `agent_cost_ledger`, `agent_confidence_log` tables exist
- [ ] Execution records match API responses

### Trial Reminder Cron

- [ ] `runTrialReminders()` completes without error when invoked directly on the server
- [ ] Redis keys `trial-reminder:{userId}:{type}` are created after a run
- [ ] Re-running within the cooldown window does NOT send a second email (key already exists)
- [ ] Resend dashboard shows delivery records for users in the trial-expiry window

### Onboarding WelcomeModal

- [ ] Modal appears after clearing `pm-generic-onboarding-seen` (localStorage) and `pm-first-login` (sessionStorage) for a user with `lastLoginAt = null`
- [ ] All three onboarding options are rendered and functional
- [ ] Modal does not reappear on page refresh or subsequent login after being dismissed
- [ ] Users with `lastLoginAt` set (returning users) never see the modal

### Google Analytics

- [ ] Network tab shows a 200 request to `googletagmanager.com/gtag/js` on page load
- [ ] `google-analytics.com/g/collect` (or `collect`) requests fire for each page navigation
- [ ] GA4 Realtime dashboard shows the page view within 30 seconds

### Mobile Landing Page

- [ ] At viewport width < 768 px, desktop nav links are hidden and hamburger icon is visible
- [ ] Clicking the hamburger opens the mobile menu with all nav links present
- [ ] Clicking a nav link closes the menu and navigates correctly
- [ ] At viewport width >= 768 px, full nav bar is shown and hamburger is hidden

### PricingPage Error Banner

- [ ] Triggering a checkout error (invalid Stripe key or blocked network) displays a readable error banner above the Subscribe button
- [ ] No unhandled exception or blank page on Stripe failure
- [ ] Error banner is dismissible (if applicable) without reloading the page

### User Support & Admin Troubleshooting

**Support contact links (client-side mailto):**

- [ ] Visit `/login` — "Need help? Contact support" link visible below "Don't have an account?"
- [ ] Click the login support link — email client opens with subject "Login Help", body contains page URL and timestamp
- [ ] Visit a non-existent route (e.g. `/nonexistent-page`) — "Need help? Contact support" link visible below "Back to Home"
- [ ] Click the 404 support link — email client opens with subject "Help - Page Not Found", body contains attempted URL and timestamp
- [ ] Trigger a full-page crash (ErrorBoundary) — "Report this issue" button appears alongside "Reload Page"
- [ ] Click "Report this issue" on ErrorBoundary — email client opens with error message in subject, error details + URL + timestamp in body
- [ ] Trigger a section crash (RouteErrorBoundary) — "Report this issue" link appears below "Try Again" / "Go Back"

**Admin user login status and unlock (requires admin role):**

- [ ] Login as admin, visit `/admin/users` — "Login status" column is visible in the users table
- [ ] Users with verified email and no pending token show a green "Verified" badge
- [ ] Users with unverified email show a gray "Unverified" badge
- [ ] Users with a pending (non-expired) login token show a yellow "Pending login" badge
- [ ] Users with an expired login token show a red "Expired token" badge
- [ ] Users with a pending or expired token have a blue "Unlock" button in the Actions column
- [ ] Users without a pending token do NOT show the "Unlock" button — only "Reset PW"
- [ ] Click "Unlock" on a user with an expired token — badge updates (no longer red), user can retry login
- [ ] `POST /api/v1/admin/users/:id/clear-login-token` returns 404 for non-existent user ID
- [ ] `POST /api/v1/admin/users/:id/clear-login-token` returns 403 for non-admin callers

---

## 26. Notification Preferences (Item 24)

### API Tests

```bash
# Get current preferences (should include notificationTypePreferences)
curl -s -b cookies.txt https://pm.kpbc.ca/api/v1/users/me | jq '.user.notificationTypePreferences'

# Save per-category preferences
curl -s -b cookies.txt -X PUT https://pm.kpbc.ca/api/v1/users/me/notification-preferences \
  -H 'Content-Type: application/json' \
  -d '{
    "emailNotificationsEnabled": true,
    "digestFrequency": "daily",
    "typePreferences": {
      "agent_proposals": { "inApp": true, "email": true },
      "risks_issues": { "inApp": true, "email": true },
      "budget_finance": { "inApp": true, "email": false },
      "meetings": { "inApp": true, "email": false },
      "system_alerts": { "inApp": true, "email": true },
      "deadlines": { "inApp": true, "email": true }
    }
  }' | jq .
```

### UI Tests

- [ ] Settings > Notifications shows 6 category rows: Agent & Proposals, Risks & Issues, Budget & Finance, Meetings & Followups, System Alerts, Deadlines & Overdue
- [ ] Each category has an In-App toggle and an Email toggle
- [ ] Email master toggle and Digest Frequency dropdown are still present
- [ ] Toggling a category off and saving persists to the server (verify via `GET /users/me`)
- [ ] After disabling in-app for a category, notifications of that type no longer appear in the bell dropdown
- [ ] After disabling email for a category, no emails are sent for that category even at critical severity
- [ ] System Alerts toggles are locked ON for admin users (cannot be toggled off)
- [ ] New user with no saved preferences sees all toggles defaulting to ON
- [ ] No localStorage key `pm-settings-notifications` is used (old mechanism removed)

### Unit Tests

- [ ] `npx vitest run src/server/__tests__/services/NotificationService.test.ts` — 27 tests pass
- [ ] Tests cover: category suppression (in-app skip, email skip), admin system_alert override, user lookup error resilience

## 27. AI Task Estimation (Item 31)

### API Tests

```bash
# Estimate a task duration (requires authentication)
curl -s -b cookies.txt -X POST https://pm.kpbc.ca/api/v1/ai/estimate-task \
  -H 'Content-Type: application/json' \
  -d '{
    "taskName": "Design database schema for reporting module",
    "taskDescription": "Create normalized schema with fact and dimension tables for project metrics",
    "projectId": "<your-project-id>"
  }' | jq .

# Expected response shape:
# { "estimation": { "estimatedDays": 3.5, "confidence": 72, "reasoning": "...", "historicalDataPoints": 15, "aiPowered": true } }
```

### UI Tests

- [ ] Open a project schedule → click "Add Task" → the Est. Duration field has a sparkles (AI) button next to it
- [ ] Enter a task name → click the sparkles button → spinner appears → estimated days is filled in
- [ ] A hint line appears below the field showing confidence and reasoning
- [ ] Button is disabled when task name is empty
- [ ] Button only appears when `projectId` is available (within a project context)
- [ ] When AI is unavailable, fallback estimate is returned (based on historical average)

### Unit Tests

- [ ] `npx vitest run src/server/__tests__/services/AiTaskEstimationService.test.ts` — 5 tests pass
- [ ] Tests cover: no-data fallback (3 days), average-based fallback, AI estimate, AI error fallback, rounding to 0.5

## 28. MPP-Parity Scheduling Features (T010–T014)

Five MS Project-parity features added to the scheduling engine: Task-Level Budget, Summary Task Auto-Rollup, Task Constraints, Custom Calendars, and Multi-Resource Assignment.

### 28a. Task-Level Budget (T010)

**Table columns:**

- [ ] Open Column Picker → "Cost" group is visible with `Budget Allocated`, `Actual Cost`, and `Budget Variance` columns
- [ ] Enable all three cost columns → they appear in the table view
- [ ] `Budget Variance` shows computed value (budgetAllocated − actualCost) and is not editable

**Inline editing:**

- [ ] Click a `Budget Allocated` cell → number input appears (min=0, step=0.01)
- [ ] Enter a value, press Enter → value saves and cell displays formatted number
- [ ] Click an `Actual Cost` cell → same inline number input behavior
- [ ] Tab out of an edited budget cell → value saves (blur save)

**Task Form Modal:**

- [ ] Open Add Task → Budget section visible with "Budget Allocated ($)" and "Actual Cost ($)" inputs
- [ ] Enter budget values, save task → values persist on reload
- [ ] Edit an existing task with budget → values pre-filled in the form

**API:**

- [ ] `POST /api/v1/schedules/:id/tasks` with `budgetAllocated: 5000, actualCost: 1200` → task created with budget fields
- [ ] `PATCH /api/v1/tasks/:id` with `budgetAllocated: 8000` → budget updated

### 28b. Summary Task Auto-Rollup (T011)

**Summary task detection:**

- [ ] Create a parent task, then create 2+ child tasks under it → parent becomes a summary task (is_summary = 1)
- [ ] Summary task shows amber banner in Task Form Modal: "Summary task — dates, progress, status, and budget are computed from child tasks"

**Rollup computation:**

- [ ] Summary task `startDate` = earliest child start date
- [ ] Summary task `endDate` = latest child end date
- [ ] Summary task `progressPercentage` = weighted average of children by estimatedDays
- [ ] Summary task `status` = "completed" if all children completed, "in_progress" if any child in progress, else "pending"
- [ ] Summary task `budgetAllocated` = SUM of child budgets
- [ ] Summary task `actualCost` = SUM of child actual costs

**Read-only enforcement:**

- [ ] Click on a summary task's date cell in table view → editing is blocked (no input appears)
- [ ] Click on a summary task's status cell → editing is blocked
- [ ] Click on a summary task's progress cell → editing is blocked
- [ ] Click on a summary task's budget cells → editing is blocked
- [ ] In Task Form Modal for a summary task, rollup fields (status, dates, progress, budget) are disabled

**Recursive rollup:**

- [ ] Create a 3-level hierarchy (grandparent → parent → child) → updating the child recomputes both parent and grandparent

### 28c. Task Constraints (T012)

**Table columns:**

- [ ] Open Column Picker → "Scheduling" group includes `Constraint Type` and `Constraint Date` columns
- [ ] Enable both columns → they appear in the table view
- [ ] `Constraint Type` defaults to "ASAP" for new tasks

**Inline editing:**

- [ ] Click a `Constraint Type` cell → dropdown with 8 options: ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO
- [ ] Select a non-ASAP constraint → cell highlights (e.g., blue background) to indicate active constraint
- [ ] Click a `Constraint Date` cell → date picker appears (only editable when constraint type requires a date)
- [ ] ASAP and ALAP constraints → constraint date cell is not editable

**Task Form Modal:**

- [ ] Open Add Task → Constraint section visible with Type dropdown and Date picker
- [ ] Select "Start No Earlier Than" → date picker becomes enabled
- [ ] Select "ASAP" → date picker hides or is disabled
- [ ] Save task with constraint → values persist on reload

**CPM enforcement:**

- [ ] Set SNET constraint with a future date on a task → critical path recalculates, task cannot start before that date
- [ ] Set MSO (Must Start On) → task is pinned to that exact start date
- [ ] Set MFO (Must Finish On) → task end date matches the constraint date

### 28d. Custom Calendars (T013)

**API endpoints:**

- [ ] `GET /api/v1/projects/:id/calendars` → returns calendar list (default "Standard" auto-created)
- [ ] `POST /api/v1/projects/:id/calendars` with `{ name, workingDays, hoursPerDay }` → creates calendar
- [ ] `PUT /api/v1/projects/:id/calendars/:calId` → updates calendar settings
- [ ] `DELETE /api/v1/projects/:id/calendars/:calId` → deletes non-default calendar
- [ ] `POST /api/v1/projects/:id/calendars/:calId/exceptions` with `{ exceptionDate, type: "holiday", name }` → adds holiday
- [ ] `DELETE /api/v1/projects/:id/calendars/:calId/exceptions/:excId` → removes exception
- [ ] `GET /api/v1/projects/:id/non-working-dates?start=YYYY-MM-DD&end=YYYY-MM-DD` → returns non-working dates for Gantt shading

**Calendar logic:**

- [ ] Default calendar has Mon–Fri working days and 8 hours/day
- [ ] Adding a holiday exception on a weekday → that day is skipped in duration calculations
- [ ] Adding a "working" exception on a weekend → that day counts as a working day
- [ ] `addWorkingDays(startDate, 5, calendar)` skips weekends and holidays correctly

### 28e. Multi-Resource Assignment (T014)

**Task Form Modal:**

- [ ] Open Add Task → "Assignments" section visible with "Add Assignment" button
- [ ] Click "Add Assignment" → row appears with Resource ID input, Allocation % (default 100), and Role input
- [ ] Add multiple assignment rows (up to 10) → all render correctly
- [ ] Remove an assignment row → row disappears
- [ ] Save task with 3 assignments → values persist on reload
- [ ] Edit task → assignments pre-filled with correct values

**Inline display:**

- [ ] Table view "Assigned To" column shows primary assignee name
- [ ] Tasks with multiple assignments show the primary (first) assignee

**API:**

- [ ] `POST /api/v1/schedules/:id/tasks` with `assignments: [{ resourceId, allocationPct: 50 }, { resourceId, allocationPct: 50 }]` → task created with both assignments
- [ ] `PATCH /api/v1/tasks/:id` with `assignments: [...]` → assignments replaced (old ones removed, new ones saved)
- [ ] Primary assignee (first in array) is denormalized to `tasks.assigned_to`

**Database:**

- [ ] `task_assignments` table exists with columns: id, task_id, resource_id, allocation_pct, role_on_task, hours_planned
- [ ] Unique constraint on (task_id, resource_id) prevents duplicate assignments

### 28f. Cross-Feature Integration

- [ ] Summary task with budget children → parent budget rolls up correctly even when constraints are set on children
- [ ] Task with constraint + multiple assignments → all fields save and display correctly together
- [ ] Column Picker shows all new column groups (Cost, Scheduling additions) and they persist via view preferences
- [ ] Gantt chart renders summary tasks, constraint indicators, and assignment data without visual glitches
