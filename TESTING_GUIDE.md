# Testing Guide - PM Assistant Generic

**Last updated:** February 28, 2026
**Stack:** Fastify + TypeScript (server), React 18 + Vite + Tailwind CSS (client)
**Database:** MariaDB on TMD Hosting (no local database)
**Production URL:** https://kovarti.com
**Staging URL:** https://pm.kpbc.ca (basic auth required)

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

### Rules kept in two places (screen + server)

Some business rules run both on the screen (so it can answer instantly) and on the server (which decides). Each pair has a **parity test** that feeds both copies the same broad table of cases and fails if any answer differs — change one copy and the test fails until the other matches. Most live in `src/server/__tests__/utils/rulesParity.test.ts`; run it with `npx vitest run src/server/__tests__/utils/rulesParity.test.ts`.

| Rule | Screen copy | Server copy | Kept equal by |
|---|---|---|---|
| Task row numbers (plan order) | `components/schedule/gantt/types.ts` `buildRowNumberMap` | `utils/scheduleRowNumbers.ts` | `rulesParity.test.ts` (hand cases + 200 generated plans) |
| Working days: which days are worked, Duration count, finish date for N days, moving N working days | `utils/workingDays.ts` | `utils/workingDays.ts` + `CalendarService.isWorking` / `getNonWorkingDates` | `rulesParity.test.ts` (4 calendars: none, holidays + company holidays + extra working days, 6-day week, Sun–Wed) |
| "Escalate to sponsor?" prompt | `utils/escalationPrompt.ts` | `utils/escalationPrompt.ts` | `rulesParity.test.ts` (every combination) |
| Rate card rate in force on a day | `utils/rateCard.ts` `cardRateOn` | `RateCardService.ratesOn` | `rulesParity.test.ts` |
| Reading level (project brief) | `utils/readingLevel.ts` | `utils/readingLevel.ts` | `rulesParity.test.ts` |
| Project types | `constants/projectTypes.ts` | `constants/projectTypes.ts`, MCP `tools/projects.ts`, latest tenant ENUM migration | `rulesParity.test.ts` |
| Placeholder emails | `utils/placeholderEmail.ts` | `utils/placeholderEmail.ts` | `placeholderEmail.test.ts` |
| Server key renaming | `utils/serverKeys.ts` | `utils/caseConverter.ts` | `serverKeys.test.ts` |
| % complete comes from approved hours | uses the server's answer: every task carries `progressFromHours` (own rule only in an unsaved form) | `TaskRepository.progressFromHoursIds` | `ScheduleService.test.ts`, `progressFromHours.test.ts`, `taskFormProgressLock.test.tsx` |

Known, deliberate differences: the screen's working-day calendar covers the date range it fetched and falls back to Mon–Fri outside it; a span with no working day shows 0d on the screen while the server's CPM treats it as the task's estimate (or 1); the screen's `workingDaysBetween` returns nothing for an end before the start. Whole-day moves only — the screen never sends fractional day moves.

### Client API split (`apiService`)

`src/client/src/services/api.ts` is a thin facade; the methods live by area in `src/client/src/services/apiAreas/` (one shared axios instance in `apiAreas/http.ts`). The guard `src/client/src/__tests__/services/apiService.split.test.ts` fails if a method disappears or appears without updating the fixture (`apiServiceMethods.fixture.json`, taken from the original file), if two areas define the same method name, if more than one axios instance / set of interceptors is created, or if sampled methods from each area stop calling their verb + URL. Adding a new API method: put it in the right area file and add its name to the fixture (keep it sorted, bump `count`). Run: `npx vitest run src/client/src/__tests__/services/apiService.split.test.ts`.

---

## 2. API Testing Patterns

All API testing is done with `curl` against the staging server at `https://pm.kpbc.ca` (basic auth required). There is no local database, so all testing hits the staging environment.

### General conventions

- Base URL: `https://pm.kpbc.ca/api/v1` (staging) or `https://kovarti.com/api/v1` (production)
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

The trial reminder cron sends emails to users approaching or past their trial expiration. It deduplicates sends using Redis keys of the form `trial-reminder:{userId}:{type}`. The countdown goes only to confirmed emails; unconfirmed sign-ups 1–4 days old get a fresh confirm-your-email link instead (keys `verify-reminder:{userId}:1day|3day`). Automated: `jobsBatched.test.ts` (trial reminders), `EmailService.test.ts` (reminder wording; no mail to `@pm.kpbc.ca`), `placeholderEmail.test.ts` (`isUndeliverableEmail`).

**Manual on staging:** register a new account with a real address you can read, don't confirm, then set its `created_at` back 1 day (`UPDATE users SET created_at = NOW() - INTERVAL 25 HOUR WHERE email = ...`) and run the job — one "Reminder: confirm your email" arrives and its link works; running again sends nothing. Staging test logins on `pm.kpbc.ca` never get mail (log line "Email not sent: no deliverable address").

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

**Staging test runs — two steps (October 2026):**

| When | Run | Time |
|------|-----|------|
| After **every** staging deploy | `npx playwright test --config playwright.staging-quick.config.ts` — everything except the heavy schedule files | ~2–3 min |
| Before **every** prod release (no exceptions), and on staging whenever a change touches the schedule screens (Gantt, Table, Kanban or their hooks) | `npx playwright test --config playwright.staging-full.config.ts` — all of it, incl. `schedule-behaviour` (32 tests, 300-task plan) and `gantt-columns` | ~10 min |

Both run one test at a time (`workers: 1`) so the machine doesn't run out of memory. A new spec goes in the full config's list; the quick config takes that list minus the heavy files, so it picks new specs up automatically.


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

### 9g. Schedule behaviour safety net (real browser, staging)

`e2e/schedule-behaviour.spec.ts` (+ `e2e/schedule-helpers.ts`) pins what the Gantt, Table and Kanban views do **today**, so the planned split of `GanttChart.tsx`, `TableView.tsx` and `ScheduleTab.tsx` can be checked step by step. It runs against staging as the QA PM and is part of `playwright.staging-full.config.ts`.

**What it covers:** the three views open with every task and no errors; inline edits in the Gantt grid and the Table (name, start, finish, duration — "3" on a Thursday start finishes Monday — status, assignee) checked on the server; keyboard (arrows, Enter/Escape, Tab while editing); cell copy/paste (duration, dates, predecessors; a summary row refuses); indent/outdent (keys and right-click) with the summary roll-up; bulk delete then Undo from History and Ctrl+Z (same task ids back); Gantt bar drag (whole working days), finish-edge resize, progress handle, drawing a link; search, Late / My Tasks filters, column sort, collapse; columns hide/move kept after a reload (shared by both views); the Timeline strip; typing in the empty row adds a task; task links (`?schedule=…&task=…`) expand, scroll to and highlight the row; light/dark screenshots of the Gantt and the Table; a 300-task plan (time from opening to rows on screen, ceiling 15 s, printed as `[speed]`).

**Data:** one project per run ("QA – e2e schedule behaviour …", archived at the end) with a fresh fixed plan (Oct–Nov 2026) for every test, deleted after it; a second project with 300 tasks for the speed tests, also archived. Projects a crashed run left active (older than 30 min) are archived at the start. The browser clock is fixed at Tue 13 Oct 2026 and the time zone at America/Toronto, so the Late/Due filters, dates and the Today line never move. The file signs the QA PM in itself (a password sign-in ends the user's other sessions at their next refresh) and hands its session on to the specs after it.

**Known bugs:** tests named `KNOWN BUG — …` are marked `test.fail()`: they pass while the bug is there and go red the day it is fixed — then remove the `test.fail` line. (The six first found — outdent to the top level, Gantt Assigned picker, progress handle under the bar name, due-today counted Late, Table indent roll-up, Table task link in a long plan — were fixed on 2026-10-04 and are normal tests now.)

**Run:**

```bash
# the whole staging suite
npx playwright test --config playwright.staging-full.config.ts
# just this file
npx playwright test --config playwright.staging-full.config.ts schedule-behaviour
```

**Screenshot baselines** live in `e2e/schedule-behaviour.spec.ts-snapshots/` (`*-chromium-win32.png` — they are per operating system; a run on Linux/macOS writes its own the first time). After an **intended** visual change to the Gantt or Table, re-take them and commit the new images (`*.png` is git-ignored, so add them with `git add -f`):

```bash
npx playwright test --config playwright.staging-full.config.ts schedule-behaviour -g "Screenshot" --update-snapshots=all
git add -f e2e/schedule-behaviour.spec.ts-snapshots/*.png
```

Look at the new images before committing — a baseline taken from a broken screen pins the breakage.

### 9h. Link checks: page robot (staging) and guide links (unit test)

**Page robot** — `e2e/linkcrawl.spec.ts`, in the full staging list (the quick config picks it up too). The QA PM and the QA team member walk the app side by side: every screen in `src/client/src/routes.ts` (ids filled in with a project/client the user can see), every project tab, then every in-app link found, one page per kind (about 80 pages each, ~2 min). It only opens pages — nothing is clicked or saved. It fails on a link to "Page not found", a page crash, any request to our own server answering 4xx/5xx, and an outside link answering 400 or more. Known problems sit on `ALLOW_LIST` with a reason; a new one must be fixed or added as "FOUND by linkcrawl <date>", and an entry that stops happening fails the run until it is removed. Each run prints what it opened, the outside links and the writes the app sent by itself (`[linkcrawl …]` lines).

```bash
npx playwright test --config playwright.staging-full.config.ts linkcrawl --workers=1
```

**Pages by role** — `e2e/role-routes.spec.ts` (full staging list; quick picks it up). As the QA team member, every page their role can't open (Clients, Portfolio, Resources, Meeting Intelligence, Change Requests, Workflows, Intake, Integrations, Analytics, EVM, Simulation, Scenarios, Report Builder, AI Proposals, plus a deep link and a `?tab=` address) lands on `/dashboard`, Back returns to the page before, allowed pages (project, Help, Settings, Timesheets, Account, KPI) open, Account shows no billing buttons and Ctrl+K offers none of the hidden pages. As the QA PM (the owner, so PMO) every one of those pages opens. Unit side: `src/client/src/__tests__/components/roleRoutes.test.tsx` (the sidebar per role agrees with `constants/roleRoutes.ts` item for item; the per-role table; the guard redirects with replace) and `accountBillingOwner.test.tsx`.

```bash
npx playwright test --config playwright.staging-full.config.ts role-routes --workers=1
```

**Guide links** — `src/client/src/__tests__/utils/guideAnchors.test.tsx` (part of `npx vitest run`). Every `#link` in the text of `docs/USER_GUIDE.md` must lead somewhere both in the app and on GitHub: a chapter, or a sub-heading — the in-app reader (`/help/guide`) opens the chapter that holds a sub-heading, scrolls to it and moves focus there (since 2026-10-08). Ids are GitHub's heading ids (repeats numbered -1, -2… across the whole file). The guide's own contents list (seen on GitHub only) must point at real `## ` headings and list every numbered chapter; the quick guide's (`/help`) contents links must match its section ids. The allow-list is empty and can only stay that way or shrink. `src/client/src/__tests__/pages/fullUserGuideAnchors.test.tsx` drives the reader itself: every sub-heading of every chapter gets its id (as admin and as team member), a link to a heading in another chapter lands and takes focus, a malformed address opens chapter 1.

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

---

## 29. Schedule Review (Phase 1 + Phase 2)

Deterministic schedule quality check. All routes are under `/api/v1/schedules/:scheduleId/review` and require project access (editor to run, viewer to read).

### Unit tests

```bash
npx vitest run src/server/__tests__/services/scheduleReviewRules.test.ts     # 28 rules, scoring, DBJ golden case
npx vitest run src/client/src/__tests__/components/ScheduleReviewPanel.test.tsx
npx vitest run src/server/__tests__/utils/importPredecessors.test.ts         # Phase 2: predecessor parse + resolve
npx vitest run src/server/__tests__/utils/importHeuristics.test.ts           # Phase 2: legend rows, cell refs, hours-vs-days
```

### Run a review and read it back

```bash
SCHED=<schedule id>
curl -s -b cookies.txt -X POST "https://pm.kpbc.ca/api/v1/schedules/$SCHED/review" | jq '{score, band, counts, findings: [.findings[] | {ruleId, severity, taskCount: (.taskIds|length), message}]}'
curl -s -b cookies.txt "https://pm.kpbc.ca/api/v1/schedules/$SCHED/review/latest" | jq '{score, band, createdAt}'
curl -s -b cookies.txt "https://pm.kpbc.ca/api/v1/schedules/$SCHED/review/history?limit=8" | jq '.runs[] | {score, band, trigger, createdAt}'
```

Expected on an unlinked import (e.g. the DBJ schedule): band `tracking_sheet`, score under 20, findings including `R03` (no logic), `R04` (milestone with duration), `R06` (dates outside window), `R08`/`R09` (status vs progress, overdue), `R10` (no owner), `R18` (no baseline); `skippedRules` lists `R01`, `R02` (covered by R03) and `R15`, `R16`, `R20` (need logic).

Running the same review twice on an unchanged schedule must return identical `score` and `findings`.

### Import summary

Import any CSV through the Import modal. The result panel shows the score chip, the top five findings and **Review and fix**. The import response carries `review: { score, band, counts, topFindings[] }`; a review failure never fails the import (the field is `null`).

### Import leak fixes (Phase 2)

Re-import a file that carries structure and confirm it survives:

- **Predecessors.** Import a CSV with a `predecessors` column (values like `2`, `3FS+2d`, or a task name), or an MS Project XML with linked tasks. The response reports `dependenciesCreated > 0`, the links appear on the Gantt, and a re-run review no longer shows the critical `R03`. Unresolvable refs come back in `warnings`, not silently dropped.
- **Milestone flag.** A row with a zero duration, an `is_milestone` truthy column, or `type = Milestone` imports as a milestone (zero-length marker on the timeline), so `R04` (milestone with duration) does not fire for it.
- **Imported baseline.** Import a file with baseline or actual columns and confirm an "Imported baseline" appears in the schedule's baselines list (`baselineCreated: true`), clearing `R18` (no baseline).
- **Hours vs days.** Import where the duration column equals the working-day span; the summary shows "Interpreted the duration column as days, not hours" (`durationNote`) and `R28` does not fire.
- **Legend / artefact rows.** A row named only "Completed" (or "Legend"/"Notes") with empty cells, and an owner like `DBJ & JV+D9:D27`, are cleaned: the row appears under `skipped`, the owner is stored as `DBJ & JV`.

Expected response fields on `/import` and `/import-structured`: `dependenciesCreated`, `baselineCreated`, `durationNote`, `skipped[]`, `warnings[]`.

### Fix proposals (Phase 3, structural)

```bash
npx vitest run src/server/__tests__/services/scheduleFixProposer.test.ts          # pure proposer
npx vitest run src/server/__tests__/services/ScheduleFixProposerService.test.ts    # apply / undo / reject
npx vitest run src/server/__tests__/services/ScheduleRecomputeService.test.ts      # date recompute + pinning
```

**Date recompute (SR1).** After applying an FS chain, confirm each task now starts the day after its
predecessor ends (calendar days), the apply response carries `datesMoved` / `projectEndShiftDays` /
`dateDeltas` / `warning`, and the panel shows the moved-tasks summary + a before→after finish table.
A **completed** or actual-dated task stays put while its successors still re-flow off it. **Undo**
restores every task's original dates from the "Pre-review baseline".

End-to-end on staging, on a schedule imported flat (no dependencies):

1. Open the review, click **Propose fixes**. Expect an "Add link" chain (unticked — sequence guess),
   milestone flags (ticked), and phase-group suggestions when task names share a prefix.
2. Tick the dependency chain and **Apply selected**. Confirm `dependenciesCreated`, the links appear
   on the Gantt, and the panel shows the score rising (e.g. 19 → 63) with `R03` gone on re-run.
3. Click **Undo**: dependencies/flags/parents revert and the score returns.
4. **Dismiss** records a negative example (`ai_feedback`, `feature='schedule_fix'`).

REST: `POST /schedules/:id/review/propose` → `{ id, source, proposalData:{fixes[]} }`;
`POST /schedules/:id/review/proposals/:pid/apply {fixIds}` → `{ beforeScore, afterScore, appliedCount, skipped }`;
`.../undo`, `.../reject`. A Basic-tier user (zero AI budget) gets rules-based fixes with no error.

### UI checks

- **Review** button appears after Columns in both Table and Gantt toolbars.
- Panel: Critical/High groups open by default; **Show rows** filters the grid and shows an orange "Schedule Review: <rule>" bar with **Clear**; rows flagged Critical/High show an orange dot beside the row number.
- Keyboard: Tab cycles inside the panel, Escape closes it; the score chip has `role="status"`.
- Viewers see the latest run but no **Re-run review** button.


## 30. Working Calendar, Company Holidays and Working Days (Sep 2026)

Use a throwaway project (archive it afterwards) — applying a calendar change moves real tasks.

1. **Duration column:** a task Thu 8 Oct → Fri 9 Oct shows **2d**; Fri 9 → Mon 12 shows **2d**. Type `3` into Duration on a Thursday task → finish is the next Monday.
2. **New task:** add a task with a start on Friday and Estimated Days 2 → finish Monday. A plan starting on a Saturday: a task with no dates starts Monday.
3. **Working calendar:** schedule toolbar → **Working calendar**. Add Wed 7 Oct as a day off for a Mon–Fri task 5–9 Oct linked to a task starting 12 Oct → preview says 2 tasks move and the finish moves later; **Cancel** changes nothing; **Apply** moves them (5–12 Oct, 13 Oct onwards). Schedule History shows one "Day off added" line; Undo puts the dates back.
4. **Extra working day:** add a Saturday as a working day → it's no longer shaded, and a 2-day task starting that Friday finishes on Saturday.
5. **Company holidays:** Settings → Company holidays → add a date → preview lists tasks across projects; **Cancel** (don't apply on shared test data). A non-admin sees the list without add/remove.
6. **Viewer:** as a team member, the Working calendar panel is read-only (no toggles, no add/remove).
7. **Task form:** set a Saturday start → amber "isn't a working day" note; saving still works.
8. **Automatic moves:** link two tasks so the second must move past a weekend → it starts Monday, keeps its working-day length. Change a task's finish so the next one is pushed → it never lands on a weekend.
9. **Clean-up script:** `moveTasksOffDaysOff.js --dry-run` twice after a real run → "would move 0 task(s)".
10. Automated: `workingDays.test.ts` (client + server), `CalendarService.test.ts`, `ScheduleRecomputeService.test.ts`, guard `workingDaysGuard.test.ts`.

## 31. Rate Card, Support View, Goals, Read-only Buttons (Sep 2026)

**Test bed (private copy of the app on staging, for the permission checker):**
`bash scripts/testbed/testbed.sh sync && … reset && … up`, open the tunnel
(`ssh -L 8081:127.0.0.1:8081 ubuntu@147.5.127.99 -N`), `node scripts/testbed/seed.cjs`, then
`node scripts/qa/permission-matrix.cjs http://localhost:8081`, then `testbed.sh down`.
It switches itself off after an hour. Never point the checker or seed at prod.

**Rate card** (staging, qa.pm@pm.kpbc.ca / Test1234!):
1. Settings → Rate card → add QA Tester $60 from 1 Jan and $70 from 1 Oct → Current / Upcoming badges.
2. Add the same role and date again → "already has a rate starting …".
3. As qa.team → no Rate card tab; `GET /api/v1/rate-card` → 403. As qa.outsider → an empty card.
4. Resource form → Use rate card shows the role's rate and the upcoming change; overtime rate saves.

**Support view** (staging admin michaela@softtrust.com):
1. Admin → Tenants → View as support on QA Staging Co → short reason refused, wrong password refused.
2. Amber banner with the company, "read-only · recorded", countdown, Exit.
3. Pages show the company's projects; no change buttons anywhere; any change via the API → 403 `support_read_only`.
4. Exit → back to Admin → Tenants. As qa.pm: Settings → Support visits lists the visit and reason; qa.team has no such tab.

**Goals** (mock project "QA – Goals mock (owner names)" on staging):
1. New Goal → objective with only a name and due date saves (empty boxes are left out).
2. Key result 3 / 10 → 30%; the objective shows the average of its key results; edit to 7 → 70% and the average moves.
3. Each goal shows "Owner: You" or the owner's name.

**Read-only buttons:** as qa.team (or during a support visit) there is no New Project, Start, Add Resource, New Change Request, New Workflow, Create Link, Add Block or Get Started card; as qa.pm they are all there.

**Automated guards added this round:** `planFeatures.test`, `retiredSharedTables.test`, `collationGuard.test`, `momentVsDayGuard.test`, `adminFieldNames.test`, `snakeCaseReadsGuard.test`, `canChangeDataRoles.test`, `runCronJobRecord.test`, `goalKeyResultProgress.test`, `contextConfigIdentity.test`, `serverKeys.test`.

### Meeting Intelligence → From Teams (Oct 2026)
- Automated: `src/server/__tests__/services/teams/teamsMeetingImport.test.ts` — speaker list, who's-who matching (saved choice, name, invite email, guests), names sent to the AI, Graph calendar/transcript calls (ended meetings only, recurring-meeting transcript choice, 401/403 messages), one-time sign-in state (used once, forged state refused).
- Manual (needs a Microsoft 365 account with Teams and the Azure permissions in docs/ADMIN_MANUAL.md): as the project PM open Intelligence → From Teams → Connect Teams; hold a short Teams meeting with transcription on; check it shows **Ready**, the who's-who list, and that results show "Said by". A team member must not see the tab; a meeting without transcription shows **No transcript**.

### Meeting Coach (Oct 2026)
- Automated: `src/server/__tests__/services/meetingCoach.test.ts` (owner matching incl. two Toms, working-day due dates, scorecard counts/tips/trend) and the "Meeting Coach step" test in `MeetingIntelligenceService.test.ts` (owner ids from the AI ignored, scorecard saved, meeting date in the prompt).
- Manual on staging as qa.pm: paste a transcript with "That's an action for Tom… by Friday", "Let's log that as a risk", plus an unlabelled problem; check Called out vs AI spotted, the flags, Add called-out items → RAID log (owner set, duplicates skipped on a second click), and the scorecard. As qa.team: results visible, no Add buttons.

### People and generic roles (Oct 2026)
- Automated: `ResourceService.test.ts` (person without email refused with a usable message; generic role never gets an email/login; generic stays generic; `peopleNeeded`), `ResourceReplaceService.test.ts` (moves people/%, Assigned to and hours bookings on ticked tasks only; refuses another generic / same / missing resource; undo puts everything back), `ChangeHistoryService.test.ts` (reassign undo), `scheduleReviewRules.test.ts` (R37, R11 with placeholders and generics), `EmailService.test.ts` (nothing sent to @example.com), `placeholderEmail.test.ts` (names → placeholders, no duplicates, client = server = migration, and the guard that resources are only written through ResourceService).
- Manual on staging as qa.pm: Resources → **Add person** without email → refused with the "use a generic role" message; with an email → saved and nobody emailed; **Invite** → "Invite sent"; on a placeholder person the button reads **Add real email**. **Add generic role** "Generic Mobile Developer" → appears under Generic roles. In a task form pick a generic role (listed under GENERIC ROLES) and a placeholder person (amber note). Project → **Team**: the placeholder person appears under "Assigned to tasks · no login yet"; **Unfilled demand** shows people per week; **Replace…** → pick a person who'd be over 100% → red warning; Replace → tasks show the person; Schedule History shows "Replaced …" with Undo → back to the generic role. Schedule Review shows R37 for a generic task starting within two weeks. As qa.team: no Invite, Replace or Add buttons.

### Line managers and weekly timesheets (Oct 2026)
- Automated: `ResourceService.test.ts` (line manager rules), `backfillLineManagers.test.ts`, `WeeklyTimesheetService.test.ts` (approver, week bounds, planned/remaining/99%/over plan, submit, approve/send back rights, PM flags), `emptyBodyErrors.test.ts` (send back / flag without text → 400).
- Manual on staging: as qa.pm set qa.team's line manager to qa.pm. As qa.team: Timesheets shows planned hours per task; type hours, Submit week → "Waiting for approval"; adding hours to that week is refused; Recall works. As qa.pm: project Time tab → Waiting for approval → Flag this line; Timesheets → To approve shows the flag; Send back needs a reason; Approve → qa.team notified. qa.other (another company) sees nothing.
- Stage 3 (approval updates the plan): `ApprovedTimeService.test.ts` (labour at own/overtime/rate-card rates, % = approved ÷ planned capped at 99, done tasks and unplanned tasks keep their %, not started → in progress, actual start, other costs kept, roll-up, project spend), `timeEntryApprovedSums.test.ts` (only approved hours, per project). Manual on staging: approve qa.team's week → the task's actual cost, % and actual start change; Financials shows Labour (approved time) under Total Spent; a typed task cost appears as Other costs and is still counted.
- Stage 4 (month lock): `WeeklyTimesheetService.test.ts` (lock day, closed month refused even in a draft week, week view marks closed days; "today" pinned). Manual: try adding hours to a day last month after the 5th → refused with "… is closed"; the day is greyed in the grid.
- Task money calculated (T073): `TaskBudgetService.test.ts` (planned hours × own rate / rate card for generic roles, no booking → no budget, roll-up only on change, rate change re-prices the person's plans), `ApprovedTimeService.test.ts` (actual cost = labour), `autoRerun.test.ts` (budgets recalculated with the review). Manual: open a task — Planned cost and Actual cost are read-only; change the person's rate → within ~20 s the planned cost changes; Financials → Expenses shows "Moved from task …" for costs that were typed on tasks.
- Team Planner: `TeamPlannerService.test.ts` (drop check: before/after hours, overload warns not refuses, cost at the new rate, logged hours stay, week shift keeps working-day length + linked tasks + finish shift, predecessor holds it back; refusals: generic/already on it/finished/heading/milestone/undated/started task's dates/stale board; apply = one `planner_move` History change, bookings shifted, Undo restores; board: only managed projects' people, all their work counted, unreadable projects unnamed and locked), `ScheduleRecomputeService.test.ts` (`moves` option), `plannerLayout.test.ts` (client). Manual (staging, qa.pm): Resources → Team Planner → drag a block onto another person → check shows hours before → after → Give it → History shows it → Undo; drag a block one week right → linked tasks listed → Move it; Tab to a block + Enter opens the same check. As qa.team: the tab is not there.
- Bookings follow their task: `bookingDates.test.ts` (whole-task / partial / shortened / no dates; only changed tasks touched; guard over every task-date write). Manual (staging): give a task an hours booking on Resources, drag the task on the Gantt to a later week, open Team Planner — the person's hours are in the new weeks.

## Weekly PM review (Oct 2026)

- Unit: `__tests__/services/weeklyReviewPicker.test.ts` (what becomes a decision, the cap of 5, order, dismissals stay quiet unless worse, fine/uncertain notes), `WeeklyReviewService.test.ts` (facts from each source, a failing source is left out, dismiss checks the project, dashboard list), `pmWeeklyReviewJob.test.ts` (Friday 07:00 in the company zone incl. zones ahead of UTC, one notification per PM); client `__tests__/components/weeklyReview.test.tsx`; e2e `e2e/weekly-review.spec.ts`.
- Staging: as **qa.pm** open a project → Overview → **Run my weekly review**; check decisions, Why?, the tab buttons, Dismiss (the item folds away, the count drops), and the dashboard's **This week's reviews**. As **qa.team** the card is absent and `?tab=weekly-review` lands on Overview; the API returns 403. As **qa.outsider** the review API is refused.
- Friday run on a server: `sudo systemctl start pm-cron@pm-weekly-review.service` only does work in a company's Friday 07:00 hour; check `journalctl -u pm-cron@pm-weekly-review.service`.

## Failed saves in the schedule (Oct 2026)

- Unit: `src/client/src/__tests__/components/useScheduleMutations.test.tsx` ('a failed save': the cache goes back, the message, no Undo entry, two quick edits, bulk/reorder/create/delete/duplicate), `useInlineCellEditSaveResult.test.ts` (the "saved" flash waits for the save), `bulkMessageTimers.test.tsx` (Table assignee tick; bulk message timers), `useGridKeyboard.test.ts` (timers cleared on unmount).
- By hand on staging, as **qa.pm**: open a plan in the Gantt or Table. Make task saves fail: in the browser's developer tools, Network tab, right-click a task save request (or any `/api/v1/schedules/…/tasks/…` PUT) and choose **Block request URL** (do NOT use Offline — offline changes are held and sent when you reconnect, so they are not failures). Edit a task name and press Enter: the old name comes back, a red message says *Your change to "…" was not saved. The last saved version is shown again — please try again.*, no green tick appears and Ctrl+Z has nothing new to undo. Drag a bar: it goes back. Close the message with ✕, unblock the URL, make the edit again: it saves and stays.
- When the server refuses a change rather than being unreachable, its reason appears after the colon ("was not saved: <reason>.").

## Import tangle guard (Oct 2026)

`src/server/__tests__/utils/importCycleGuard.test.ts` reads every import in `src/server` and `src/client/src` with TypeScript's own parser and finds groups of files that import each other in a circle. Type-only imports don't count (they vanish when built); `await import()` "load it later" workarounds do. It counts the import links inside those groups and fails if the number rises above the ceiling at the top of the file, listing the links that closed the circle.

- Baseline 2026-10-03: server 104 links / 38 files (21 / 11 on 2026-09-01); client 5 / 5. After step 1B (notices): server 80 / 31. After step 1C (database layer): 74 / 28. After step 1D (History undo handlers): 30 / 13. After step 1E (workflows by notice): 7 / 5.
- **Layering:** the same file checks that repositories (`database/*Repository.ts`, `connection.ts`, `bookingDates.ts`) import from `services/` only type labels (`import type`) or three listed plain helpers.
- **"Something changed" notices** (`services/domainEvents.ts`): code that changes a plan, a rate or a RAID item posts `planChanged` / `personRatesChanged` / `rateCardChanged` / `raidChanged`; `services/domainListeners.ts` connects them to Schedule Review, budget re-pricing and RAID Review. `registerDomainListeners()` must run in every process that changes data — `index.ts` and `scripts/runCronJob.ts`; `domainEvents.test.ts` guards both, and that nobody calls the reactions directly again.
- The ceilings only go **down**: each untangling step lowers them in the same commit.
- To see the current tangles: `PRINT_TANGLES=1 npx vitest run src/server/__tests__/utils/importCycleGuard.test.ts`.
- If it fails on your change: don't raise the ceiling. Announce the change instead of calling the other part directly, or move the shared piece down a layer.

## Accessible-name guard (Oct 2026)

`src/client/src/__tests__/utils/a11yNamesGuard.test.ts` runs the scanner `scripts/a11yScan.ts` (TypeScript parser) over every client `.tsx` and fails if any `<input>`, `<select>`, `<textarea>` or icon-only `<button>` has no accessible name (label `htmlFor` + `id`, wrapping `<label>`, `aria-labelledby`, or `aria-label` when there is no visible text) — a ratchet: unlisted files must have none, listed allowances only go down (529 → 1 on 2026-10-06). List them with `npx tsx scripts/a11y-scan.ts`.

## Dead-code check (Oct 2026)

`npm run deadcode` (`scripts/deadCodeCheck.mjs`, ~70 s) runs knip on the server (`knip.json`), the client (`src/client/knip.json`) and the MCP server (`mcp-server/knip.json`) and lists unused files, unused exports/types, and unused or unlisted packages. It compares them with the known list `scripts/deadcode-baseline.json` (580 items on 2026-10-07, incl. 21 whole files) and **fails on anything new**. `deploy.sh` runs it on every prod release (even with `--skip-tests`) and on staging when tests run.

- If it fails on your change: remove the unused code. If you replaced a screen or feature, the old one goes in the same change (the plan names it under "Removes:").
- The baseline only **shrinks**: after removing dead code, `node scripts/deadCodeCheck.mjs --update`. Adding to it needs the user's OK.
- Tests count as users (a helper used only by a guard test is not dead). Server routes nothing calls are not covered — see the 2026-10-07 efficiency report.

## Code checker — ESLint (Oct 2026)

`npm run lint` (`eslint.config.mjs`; ~7 min the first time on this machine because it loads the TypeScript projects, faster after with its cache) checks the server, the client and the MCP server for **real problems, not style**:

- **bugs:** promises nobody waits for (`no-floating-promises` — a save "succeeds" before it happened), promises passed where a plain function is expected, `==`, loops that can't end or run once, values returned from a Promise executor, `.map`/`.filter` callbacks that return nothing, identical `if` conditions or branches;
- **security:** `eval` / `new Function`, regular expressions that can freeze the server on crafted input, `require` of a computed path;
- **slow patterns:** `await` inside a loop (one database call per item — ask once for all);
- **complexity:** cognitive complexity over 25 per function, nesting deeper than 5, identical functions;
- **React (client):** rules of hooks, missing effect dependencies (stale data / endless reloads), keyboard and screen-reader basics (`jsx-a11y`).

Problems that existed on 2026-10-08 — 1,752 in 487 files, plus 242 list-searches-in-loops added the same day; 1,974 in 489 files after test-file regexes were exempted (470 unawaited promises, 413 awaits in loops, 127 over-complex functions, 96 effect dependencies, ~330 a11y, 35 risky regexes…) — are listed in `eslint-suppressions.json`. **Anything new fails.** The list only shrinks: after fixing some, `npm run lint -- --prune-suppressions`. Never add to it (`--suppress-rule`/`--suppress-all`) without the user's OK; an `eslint-disable` comment needs a reason next to it. `deploy.sh` runs it on every prod release (even with `--skip-tests`) and on staging when tests run.

## Efficiency guard (Oct 2026)

`src/server/__tests__/utils/efficiencyGuard.test.ts` (part of `npx vitest run`, no database needed) reads the server code and the migrations. Tables that grow every day (audit, workflow runs, agent logs, notifications, chat, usage logs, time entries, tasks…) are listed in `GROWING`. Four rules:

1. A SELECT on a growing table has a WHERE, a LIMIT or is a COUNT — never "read it all".
2. Its WHERE uses a column that starts an index on that table (indexes are read from every `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD INDEX` in the migrations; filters through a joined table are skipped).
3. Every growing table has a clean-up (`DELETE … WHERE … < NOW() - INTERVAL …`) or is in `KEEP_FOREVER` with the reason.
4. Heavy routes (export, verify, download, docx/pdf, import, bulk, rebuild, reindex, simulate, scan…) check a role or the project **and** are rate-limited.

What existed on 2026-10-08 is listed at the top as allowances (1 unbounded read, 8 unindexed filters, 9 tables never cleaned, 28 heavy routes; the same day the read, the 8 filters and 21 of the routes were fixed — heavy routes use the shared `heavyActionLimit(action, limit)` preHandler from `middleware/rateLimiter.ts`). They only go down — fix, then lower the number in the same change; raising one needs the user's OK. `PRINT_EFFICIENCY=1 npx vitest run src/server/__tests__/utils/efficiencyGuard.test.ts` lists every finding. It is a code reader, not the database: it can miss a query built in pieces, so the slow-query log on staging (0.5 s) stays on as the real-world net.

The code checker adds the in-memory side: **`no-restricted-syntax`** flags searching a list (`find`/`filter`/`findIndex`) inside a loop or inside a `map`/`forEach`/… callback (2,000 tasks × 2,000 people = 4 million steps; a `Map` built once = 4,000), and sorting or building a `RegExp` inside a loop. Existing cases are in `eslint-suppressions.json`. If both lists are always small, disable the line with a reason (`-- small: …`).

## Copy-paste check (Oct 2026)

`npm run duplication` (`scripts/duplicationCheck.mjs`, ~20 s; settings `.jscpd.json`): jscpd finds blocks of 15+ lines that appear in two places (tests excluded). 2026-10-08: 69 copies, 2,070 lines in 67 files (measured on a clean checkout — files with Windows line endings in a working folder hide some copies from jscpd, so a working folder may show fewer; releases build from a clean checkout), listed in `scripts/duplication-baseline.json`. A copied block in a file that has never had one fails, and so do more copies than the baseline or the copied lines growing by more than 60: make it one shared function or component. (It compares by file, not by pair, because jscpd can pair the same block with a different file from one machine to another.) Shrink the list with `--update` after removing copies. Runs in `deploy.sh` with the code checker.

## Speed tests (Oct 2026)

`src/server/__tests__/performance/*.perf.test.ts` and `src/client/src/__tests__/performance/scheduleScreens.perf.test.tsx` run the heavy jobs on a generated plan (`perfData.ts`: 2,000 tasks in phases, ~1.2 links per task, a working-days calendar, 55 people) and fail if a job gets slower than its limit or stops growing in step with the plan. Each test measures the job at N/4 and N; the growth per doubling must stay under 3.0 (in proportion ≈ 2, an accidental n² ≈ 4). Limits are 3× the measured median on 2026-10-08 (minimum 50 ms) and are checked against the fastest of a few samples, with one retry, so a busy machine doesn't fail them while a real slowdown does. The table in each file's header has the numbers.

Covered: Schedule Review, date cascade, critical path, Monte Carlo (plan size and iterations), status report, client report, re-flow (save, dry run, calendar change), Team Planner board, workload heatmap (one project, everyone); in the browser: Gantt rows and numbering, timeline strip, Gantt search and sort, Table sort by Duration and group, planner lanes, resource conflicts. About 30–50 s. They run on their own, one file at a time — `npm run test:perf` (`scripts/perfTests.mjs`); the normal `npx vitest run` leaves them out (`PERF_TESTS` in `vitest.config.ts`), because another test file running alongside made their timings fail at random. `deploy.sh` runs them on every prod release.

Made faster on 2026-10-08 (limits lowered to 3× the new times): the workload heatmap now visits each booking only for the weeks it covers (`weeklyLoad.ts` `bookedHoursByWeek`) — one project's heatmap at 4,000 tasks 1,543 ms → 373 ms (limit 1,120 ms), everyone's at 2,000 tasks 733 ms → 210 ms (limit 630 ms); Table sort by Duration works out each task's value once per sort (`sortValues.ts` `sortByValue`) — 1,000 tasks 241 ms → 52 ms (limit 160 ms). Same numbers and order as before: `workloadEquivalence.test.ts` and `sortByValue.test.ts` check them against the old code.

## App download size limit (Oct 2026)

`npm run bundle-budget` (`scripts/bundleBudget.mjs`, after `npm run build:client`) checks `src/client/dist`. `deploy.sh` runs it after every build that includes the client.

| Measure | 2026-10-07 | Limit |
|---|---|---|
| First load — what `index.html` loads at once, gzip-compressed | 195 KB | 260 KB |
| Largest piece loaded later (one lazy chunk, uncompressed; html2pdf) | 953 KB | 1,100 KB |
| All JavaScript together, uncompressed | 4.94 MB | 5.6 MB |

If it fails: load the new code only where it's needed (`lazy()` / `await import()`, as the PDF and Excel readers do). Raising a limit needs the user's OK.

## Production smoke tests (Oct 2026)

`SMOKE_CREDENTIALS=path/to/prod-smoke-account.json npx playwright test -c playwright.prod.config.ts` — 10 read-only page checks on kovarti.com. The login comes from the same credentials file as `scripts/prod-smoke.cjs` (kept outside the repository); the checks reuse the session the setup step saves. Staging tests use the QA logins (qa.pm / qa.team / qa.outsider @pm.kpbc.ca, see `e2e/staging-helpers.ts`).

- **Real-staging e2e suite** (`npx playwright test --config playwright.staging-full.config.ts`, ~1.5 min, 26 tests): pre-launch pages, Gantt columns, **Team Planner** (`e2e/team-planner.spec.ts`: board counts all work; drag a task to another person → check → save → Undo; Enter opens the check; booked hours move with the task; team member gets no planner and is refused) and **timesheets** (`e2e/timesheets.spec.ts`: team member logs hours, sees planned hours, submits; a submitted week takes no more hours; line manager approves; the task gets the hours, In progress, % between 0 and 100). Each spec makes its own project in QA Staging Co and archives it; the timesheet spec finds an empty, open week of its own (2027 onwards) because an approved week is final. Data helpers: `e2e/qa-data.ts`.
- Spent includes expenses + EVM actual cost by date (T075): `ApprovedTimeService.test.ts` (spent SQL adds expenses; `costTimeline` labour per day incl. overtime + expenses + undated), `SCurveService.test.ts` (AC = spent by each date, never past the status date), `ExpenseService.test.ts` (spent recomputed on add/change/remove), `ProjectService.test.ts` (typed total − labour − expenses = other costs). Manual (staging): Financials → add a $500 expense → Total Spent rises by $500 and the dashboard/Budget Watch show the same figure; EVM → AC rises in the week of the expense date.
- Agent/workflow scoping: `DagWorkflowService.test.ts` (a project's workflow skips other projects' task/project/proposal events; company-wide runs everywhere), `dagWorkflowScope.test.ts` (auto-approve skips another project's proposal; run-agent uses the workflow's project), `AutonomyService.test.ts` (company-wide Tier 3 ignored), `ragAgentCapability.test.ts` (meeting notes only from its project).
- Nightly checks: `scanOrchestrator.test.ts` (delays alert once per plan, no AI proposal; budget + Monte Carlo run; sample/finished projects skipped), `registryAgentRunners.test.ts` (budget from EVM metrics only, Monte Carlo lateness in working days, linkId de-dup), `AutoRescheduleService.test.ts` (expected progress in working days, pinned to a Wednesday).
- **Retired agents (2026-10-04):** the tests for the 12 removed agents and their helpers (ConfidenceCalculator, ProposalRateLimiter, AgentFeedbackService, ConflictResolver) were removed with them; earlier entries in this guide that name those agents are history. Nightly checks are covered by `scanOrchestrator.test.ts` (incl. one scan per company at a time) and `registryAgentRunners.test.ts`.
- Schedule Review 1.8: `scheduleReviewRules.test.ts` (R38 bottleneck: 4+ open waiting, finished waiters don't count, info = no deduction; R40 open sprint past 5 working days; no R39), `builtInTemplatesReview.test.ts` (templates still clean). Monte Carlo nightly check skips empty plans quietly (`registryAgentRunners.test.ts`).
