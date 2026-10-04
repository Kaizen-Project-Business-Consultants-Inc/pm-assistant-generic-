# Kovarti PM Assistant — Agentic System Architecture

> **Status, October 2026 — historical design.** The agents described here were retired on 2026-10-04
> after a review found they duplicated Schedule Review, the Team Planner, EVM, status reports and
> Lessons, their AI replies failed, their suggested actions couldn't be carried out, and some
> reached across projects. What runs today: three nightly checks with no AI (slipping tasks, budget,
> Monte Carlo) — see docs/AI_DESIGN_FEATURES.md. The "intelligent PM" direction continues as PM
> playbooks (docs/playbooks/). Agents only suggest; the project's PM decides.


This document defines the architecture, governance, and implementation of PM Assistant's agentic system — 14 autonomous AI agents that detect issues, reason via Claude, and propose (or auto-execute) corrective actions with human-in-the-loop governance.

---

## Table of Contents

1. [I. Strategy & Governance](#i-strategy--governance)
2. [II. Database Schema](#ii-database-schema)
3. [III. Core Services](#iii-core-services)
4. [IV. Agent Implementations](#iv-agent-implementations)
5. [V. Policy Engine Configuration](#v-policy-engine-configuration)
6. [VI. API Routes](#vi-api-routes)
7. [VII. Frontend Components](#vii-frontend-components)
8. [VIII. Testing](#viii-testing)
9. [IX. Observability & Monitoring](#ix-observability--monitoring)
10. [X. Documentation](#x-documentation)

---

## I. Strategy & Governance

The rulebook that governs all agent behavior. Must be defined before any agent code is written. Maps directly to PolicyEngine configuration.

### Vision & Objectives
- Define the agent vision and business objectives
- Define what "agentic" means for PM Assistant — the transition from reactive alerts to autonomous decision-making with human oversight

### Autonomy Model
- Define autonomy tiers and progression criteria:
  - **Tier 1: Notify** — detect issues, create notifications, no proposals
  - **Tier 2: Propose** — detect issues, reason about solutions, propose actions, require human approval
  - **Tier 3: Auto-Execute** — detect issues, reason, execute low-risk actions autonomously, notify after the fact
- Define how agents progress from Tier 1 to Tier 3 (proposal acceptance rate, time in service, zero rollbacks)

### Agent Roster
- Define every agent, its domain, its scope, its boundaries
- Define what each agent is responsible for and what it must never touch
- Define agent-to-agent interaction rules:
  - Can agents trigger other agents?
  - Can agents chain or delegate work?
  - What prevents infinite loops?

### Confidence Framework
- Define how confidence scores are calculated (data quality, historical accuracy, model certainty)
- Define what thresholds mean:
  - Below 40%: notify only, never propose
  - 40-60%: propose with explicit "low confidence" warning
  - 60-80%: propose normally
  - Above 80%: eligible for auto-execution (if policy allows)
- Define how confidence is displayed to users

### Risk Classification
- Define the risk matrix — every possible agent action classified:
  - **Low**: read-only queries, generating reports, searching knowledge base
  - **Medium**: modifying task dates, updating progress percentages
  - **High**: reassigning resources, changing task dependencies, modifying schedules
  - **Critical**: modifying budgets, changing project scope, deleting entities, creating change requests
- Map each risk level to default policy enforcement

### Policy Defaults
- Define default policies per risk level:
  - Low risk: `log_only` — agent acts, action is logged
  - Medium risk: `require_approval` — agent proposes, user approves
  - High risk: `require_approval` with manager sign-off
  - Critical risk: `block` by default — must be explicitly enabled per project

### Escalation Protocol
- Define timeout rules: if proposal not reviewed in 24 hours, escalate to project manager
- Define fallback: if project manager doesn't respond in 48 hours, escalate to admin
- Define confidence-based escalation: if agent confidence < 60%, always require approval regardless of risk level
- Define multi-signal escalation: if multiple agents flag the same project, escalate compound risk

### Communication Model
- Define how agents surface findings to users:
  - In-app notifications (always)
  - Email notifications (configurable per user)
  - AI chat panel (conversational interaction with agent reasoning)
  - Dashboard widgets (aggregate view)
- Define notification priority mapping (critical=immediate, high=daily digest, medium=weekly)

### Multi-Tenancy
- Define data isolation rules in agent reasoning context
- Agents must never include data from other users' projects in Claude prompts
- Cross-project intelligence is scoped to a single user's portfolio only
- Define how shared resources across projects are handled

### Concurrency
- Define conflict resolution when agents and humans edit simultaneously:
  - Agent proposals include a version/timestamp of the data they're based on
  - If underlying data changes after proposal is created but before approval, mark proposal as "stale" and re-evaluate
  - Human edits always win over pending agent proposals
  - Two agents cannot modify the same entity in the same scan cycle

### Data Access Rules
- Define per-agent read/write permissions:
  - Schedule Recovery Agent: read tasks/schedules/resources, write task dates and assignments
  - Budget Intelligence Agent: read budgets/costs/EVM, write budget forecasts and change requests
  - Resource Optimization Agent: read resources/assignments/capacity, write resource assignments
  - Cross-Project Intelligence Agent: read-only across portfolio
  - Risk Escalation Agent: read-only, write notifications only
  - Stakeholder Communication Agent: read tasks/schedules/budgets/EVM, write status reports as proposals

### Cost Budget
- Define max Claude API calls per scan cycle
- Define max Claude API calls per project per day
- Define circuit breaker thresholds: if daily spend exceeds $X, pause non-critical agents
- Define token budget per agent invocation (input + output limits)
- Track and report costs per agent, per project, per time period

### Rollback Rules
- Define which actions are reversible (date changes, reassignments) vs. irreversible (sent emails, external integrations)
- Auto-executed actions must be reversible; irreversible actions always require approval
- Define rollback procedure: revert all actions in reverse order, log rollback to audit ledger
- Define partial failure handling: if action 3 of 5 fails, roll back actions 1-2

### Degradation Strategy
- Define behavior when Claude API is down: skip reasoning agents, continue deterministic agents (Monte Carlo, critical path)
- Define behavior when DB is slow: reduce scan scope, skip non-critical agents
- Define behavior when RAG has no data: proceed without knowledge enrichment, lower confidence score
- Define behavior when a specific agent fails repeatedly: circuit breaker, disable after N consecutive failures, alert admin

### Success Metrics
- Proposal acceptance rate (target: >70%)
- Time-to-resolution (time from detection to fix)
- False positive rate (proposals rejected as unnecessary)
- User satisfaction (feedback on proposal quality)
- Cost per insight (Claude spend divided by actionable proposals)
- Mean time between agent-caused incidents

### Testing Strategy
- Define how to validate reasoning quality before shipping
- Golden test cases: known project scenarios with known-good agent responses
- Shadow mode: run new agent version alongside old, compare outputs without executing
- Canary deployment: enable new agent for 1 project first, monitor for 1 week

### Versioning Strategy
- Define how agent versions coexist (registry already supports versioning)
- Define A/B testing: run v1 and v2 simultaneously, compare proposal quality
- Define rollback: if v2 has lower acceptance rate after N proposals, auto-revert to v1
- Define deprecation: v1 disabled after v2 proves stable for 30 days

### Observability Requirements
- Agent execution latency (p50, p95, p99)
- Error rates per agent per day
- Claude token usage per agent per scan
- Proposal lifecycle metrics (created, approved, rejected, expired, executed, rolled back)
- Queue depth (pending proposals per project)
- Dashboard for all of the above

---

## II. Database Schema

New tables required to support agentic behavior. All migrations follow existing pattern: `NNN_descriptive_name.sql` in `src/server/database/migrations/`.

### agent_proposals
Stores recovery plans, action lists, reasoning, and lifecycle status.

```sql
CREATE TABLE agent_proposals (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36),
  agent_id VARCHAR(255) NOT NULL,          -- e.g., 'schedule-recovery-v1'
  agent_version VARCHAR(50) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'rolled_back', 'failed') NOT NULL DEFAULT 'pending',
  title VARCHAR(500) NOT NULL,
  reasoning TEXT NOT NULL,                  -- Claude's chain-of-thought
  summary TEXT NOT NULL,                    -- Human-readable summary
  confidence_score DECIMAL(5,2) NOT NULL,   -- 0.00 to 100.00
  confidence_factors JSON,                  -- What contributed to the score
  risk_level ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  data_snapshot_version VARCHAR(36),        -- Version of data used for reasoning
  expires_at DATETIME,                      -- Auto-expire if not reviewed
  created_by VARCHAR(36) NOT NULL,          -- User whose project triggered this
  reviewed_by VARCHAR(36),
  reviewed_at DATETIME,
  executed_at DATETIME,
  rolled_back_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_project_status (project_id, status),
  INDEX idx_agent_status (agent_id, status),
  INDEX idx_expires (expires_at)
);
```

### agent_proposal_actions
Individual actions within a proposal. Executed in order.

```sql
CREATE TABLE agent_proposal_actions (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  execution_order INT NOT NULL,
  action_type ENUM('update_task_dates', 'reassign_resource', 'update_dependency', 'update_progress', 'create_change_request', 'update_budget', 'send_notification') NOT NULL,
  target_entity_type VARCHAR(50) NOT NULL,  -- 'task', 'resource', 'schedule', 'project'
  target_entity_id VARCHAR(36) NOT NULL,
  old_value JSON,                           -- State before change (for rollback)
  new_value JSON,                           -- Proposed new state
  reasoning TEXT,                           -- Why this specific action
  status ENUM('pending', 'executed', 'rolled_back', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  executed_at DATETIME,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  INDEX idx_proposal_order (proposal_id, execution_order)
);
```

### agent_proposal_reviews
Tracks who reviewed, when, and why.

```sql
CREATE TABLE agent_proposal_reviews (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(36) NOT NULL,
  decision ENUM('approved', 'rejected', 'requested_changes') NOT NULL,
  comment TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  INDEX idx_proposal (proposal_id)
);
```

### agent_feedback
Tracks whether executed proposals actually helped.

```sql
CREATE TABLE agent_feedback (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36) NOT NULL,
  submitted_by VARCHAR(36) NOT NULL,
  outcome ENUM('effective', 'partially_effective', 'ineffective', 'made_worse', 'rolled_back') NOT NULL,
  comment TEXT,
  metrics_before JSON,                      -- Project health snapshot before execution
  metrics_after JSON,                       -- Project health snapshot after execution
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE CASCADE,
  UNIQUE KEY idx_proposal_unique (proposal_id)
);
```

### agent_cost_ledger
Tracks Claude API token usage per agent invocation.

```sql
CREATE TABLE agent_cost_ledger (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(36),
  scan_id VARCHAR(36),                      -- Groups entries from same scan cycle
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  model VARCHAR(100),
  latency_ms INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_date (agent_id, created_at),
  INDEX idx_project_date (project_id, created_at),
  INDEX idx_scan (scan_id)
);
```

### agent_confidence_log
Stores confidence scores and contributing factors for analysis.

```sql
CREATE TABLE agent_confidence_log (
  id VARCHAR(36) PRIMARY KEY,
  proposal_id VARCHAR(36),
  agent_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  data_quality_score DECIMAL(5,2),          -- How complete/fresh is the input data
  historical_accuracy_score DECIMAL(5,2),   -- How accurate has this agent been historically
  model_certainty_score DECIMAL(5,2),       -- Claude's self-reported certainty
  factors JSON,                             -- Detailed breakdown
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES agent_proposals(id) ON DELETE SET NULL,
  INDEX idx_agent_project (agent_id, project_id)
);
```

---

## III. Core Services

New services that form the agentic pipeline. Each is a standalone module in `src/server/services/agents/`.

### ReasoningEngine
`src/server/services/agents/ReasoningEngine.ts`

- Assembles full project context for Claude (tasks, schedule, resources, critical path, historical data, RAG results)
- Builds structured prompts with clear instructions for output format
- Calls claudeService with structured output (JSON mode)
- Parses Claude's response into typed recovery plan / action plan
- Extracts chain-of-thought reasoning for transparency
- Tracks token usage via AgentCostTracker
- Handles Claude API failures gracefully (returns degraded result with lower confidence)

### ActionProposalService
`src/server/services/agents/ActionProposalService.ts`

- Creates proposals from agent reasoning output
- Persists to `agent_proposals` and `agent_proposal_actions`
- Manages proposal lifecycle (pending -> approved/rejected -> executed/rolled_back)
- Links to ApprovalWorkflowService for gating
- Handles proposal expiration (configurable TTL, default 48 hours)
- Marks proposals as "stale" if underlying data changes
- Queries: by project, by status, by agent, by date range

### ActionExecutor
`src/server/services/agents/ActionExecutor.ts`

- Executes approved proposals step by step in `execution_order`
- Each action is atomic: snapshot old state before mutation
- Calls domain services: scheduleService, resourceService, approvalWorkflowService
- Logs every mutation to audit ledger (hash-chained)
- On failure: rolls back all previously executed actions in reverse order
- Updates proposal status throughout (executing -> executed/failed/rolled_back)
- Fires webhooks and notifications on completion

### ConfidenceCalculator
`src/server/services/agents/ConfidenceCalculator.ts`

- Computes confidence scores from multiple factors:
  - **Data quality** (0-100): how complete is the project data? Missing dates, unassigned tasks, stale progress = lower score
  - **Historical accuracy** (0-100): what % of past proposals from this agent were accepted and effective?
  - **Model certainty** (0-100): Claude's self-reported certainty from structured output
- Weighted average produces final confidence score
- Logs scores to `agent_confidence_log` for trend analysis
- Returns factors breakdown for UI display

### AgentCostTracker
`src/server/services/agents/AgentCostTracker.ts`

- Wraps claudeService calls to capture token usage
- Records to `agent_cost_ledger` per invocation
- Enforces budget limits:
  - Per agent per scan cycle
  - Per project per day
  - Global daily limit
- Circuit breaker: if budget exceeded, returns error and skips agent
- Provides aggregation queries for dashboard (daily/weekly/monthly by agent/project)

### AgentFeedbackService
`src/server/services/agents/AgentFeedbackService.ts`

- Records user feedback on executed proposals (effective/ineffective/made worse)
- Captures before/after project health metrics for objective measurement
- Feeds into ConfidenceCalculator's historical accuracy score
- Provides aggregate stats per agent (effectiveness rate, user satisfaction)

### ConflictResolver
`src/server/services/agents/ConflictResolver.ts`

- Detects stale proposals: compares `data_snapshot_version` against current entity state
- When underlying data changes after proposal creation:
  - If minor change: mark proposal as "needs review"
  - If major change (entity deleted, status changed): auto-expire proposal
- Prevents two agents from proposing changes to the same entity in the same scan
- Human edits always invalidate conflicting pending proposals

### DegradationHandler
`src/server/services/agents/DegradationHandler.ts`

- Monitors health of external dependencies (Claude API, database, RAG)
- When Claude API is unavailable:
  - Skip reasoning agents entirely
  - Continue deterministic agents (Monte Carlo, critical path detection)
  - Lower all confidence scores
  - Notify admin
- When database is slow:
  - Reduce scan scope (active projects only, skip planning)
  - Increase scan interval temporarily
- Circuit breaker per agent: disable after N consecutive failures, alert admin
- Provides health status for `/api/v1/agent/health` endpoint

---

## IV. Agent Implementations

Each agent follows the pattern: perceive -> reason -> plan -> propose. Registered in `agentCapabilities.ts`.

### Schedule Recovery Agent
`src/server/services/agents/ScheduleRecoveryAgent.ts`

- **Trigger**: delay detected by existing auto-reschedule scan
- **Perception**: delayed tasks, critical path, resource availability, historical velocity
- **Reasoning**: Claude analyzes root cause, impact on downstream tasks, recovery options
- **Output**: ranked recovery options, each with concrete task/resource changes
- **Registration**: `schedule-recovery-v1`, capability `schedule.recover`
- **Input schema**: `{ scheduleId, delays[], criticalPath, resources[] }`
- **Output schema**: `{ recoveryPlan, proposals[], reasoning, confidence }`
- **Risk level**: high (modifies task dates and assignments)
- **Default policy**: require_approval

### Budget Intelligence Agent
`src/server/services/agents/BudgetIntelligenceAgent.ts`

- **Trigger**: CPI/SPI threshold breach or trending negative
- **Perception**: EVM metrics, cost breakdown by task, resource costs, burn rate history
- **Reasoning**: Claude correlates budget deviation with specific tasks/resources, forecasts scenarios
- **Output**: budget recovery recommendations (reallocation, scope reduction, resource changes)
- **Registration**: `budget-intelligence-v1`, capability `budget.recover`
- **Input schema**: `{ projectId, forecast, evmMetrics, costBreakdown }`
- **Output schema**: `{ analysis, recommendations[], budgetImpact, reasoning, confidence }`
- **Risk level**: critical (involves budget modifications)
- **Default policy**: block (must be explicitly enabled)

### Resource Optimization Agent
`src/server/services/agents/ResourceOptimizationAgent.ts`

- **Trigger**: resource overallocation (>100% utilization), under-utilization (<40%), or bottleneck roles detected
- **Perception**: resource workloads via `resourceService.computeWorkload()` — utilization %, peak utilization, role-based grouping
- **Reasoning**: Claude analyzes workload imbalances, identifies root causes (uneven distribution, skill gaps, staffing shortfalls), proposes rebalancing
- **Output**: resource rebalancing proposal with `reassign_resource`, `create_change_request`, `send_notification` actions
- **Registration**: `resource-optimization-v1`, capability `resource.optimize`
- **Input schema**: `{ projectId, userId, scanId? }`
- **Output schema**: `{ analysis, proposal, indicators, skipped, skipReason? }`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → detect indicators → reason → propose
- **Risk level**: high (resource reassignment actions)
- **Default policy**: require_approval

### Cross-Project Intelligence Agent
`src/server/services/agents/CrossProjectIntelligenceAgent.ts`

- **Trigger**: runs once per scan cycle after all per-project agents complete
- **Perception**: health snapshots across all active/planning projects — health scores, EVM metrics (CPI/SPI), overdue tasks, resource allocation, budget utilization
- **Reasoning**: Claude identifies cross-project patterns (common root causes, resource contention, cascading delays, portfolio risk distribution)
- **Output**: strategic insights, warnings, and recommendations with `send_notification` and `create_change_request` actions
- **Registration**: `cross-project-intelligence-v1`, capability `portfolio.analyze`
- **Input schema**: `{ userId, scanId? }`
- **Output schema**: `{ analysis, proposal, indicators, skipped, skipReason? }`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather indicators → reason → propose
- **Significance thresholds**: requires ≥2 active projects; triggers when ≥2 at-risk, ≥2 budget deficit, ≥1 resource bottleneck, or ≥1 common risk
- **Risk level**: low (read-only analysis, notification only)
- **Default policy**: log_only

### Risk Escalation Agent
`src/server/services/agents/RiskEscalationAgent.ts`

- **Trigger**: runs last in each scan cycle after all per-project and portfolio agents complete
- **Perception**: per-project agent flags accumulated during the scan (schedule delay, budget overrun, scope creep, resource bottleneck, meeting overdue)
- **Reasoning**: Claude identifies compound risks where multiple risk factors converge on the same project, assesses cascading effects, and determines escalation urgency
- **Output**: escalation proposals with `send_notification` and `create_change_request` actions
- **Registration**: `risk-escalation-v1`, capability `risk.escalate`
- **Input schema**: `{ userId, projectResults[{ projectId, projectName, agentFlags, details }], scanId? }`
- **Output schema**: `{ analysis, proposal, indicators, skipped, skipReason? }`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather indicators → reason → propose
- **Compound threshold**: project must be flagged by ≥2 agents to be considered a compound risk
- **Risk level**: low-to-high (creates notifications and change requests for compound risks)
- **Default policy**: log_only

### Stakeholder Communication Agent
`src/server/services/agents/StakeholderCommunicationAgent.ts`

- **Trigger**: runs per-project during each scan cycle (after resource optimization agent)
- **Perception**: gathers comprehensive project status snapshot — completion rate, EVM metrics (CPI/SPI), upcoming milestones (14 days), recently completed tasks (7 days), risk indicators (overdue, budget, schedule)
- **Reasoning**: Claude generates stakeholder-ready status report with executive summary, key highlights, risks/concerns, upcoming milestones, and recommended actions
- **Output**: status report proposal with `send_notification` action containing the full report
- **Registration**: `stakeholder-communication-v1`, capability `stakeholder.report`
- **Input schema**: `{ projectId, userId, scanId? }`
- **Output schema**: `{ analysis, proposal, snapshot, skipped, skipReason? }`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather snapshot → reason → propose
- **Skips when**: no tasks in project, reasoning engine unavailable, snapshot gathering fails
- **Risk level**: low (informational report, no data mutations)
- **Default policy**: require_approval

### IV.I — Agent 11: Project Hygiene Agent

- **Trigger**: per-project scan cycle
- **Perception**: detects stale tasks (14+ days unchanged), missing dates/assignments/estimates, abandoned sprints (past end date, not completed), zero-progress in-progress tasks (7+ days stale)
- **Reasoning**: Claude analyzes hygiene indicators and recommends cleanup actions
- **Output**: proposal with notification listing hygiene issues and recommendations
- **Registration**: `project-hygiene-v1`, capability `project.hygiene`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather indicators → reason → propose
- **Significance**: ≥3 stale tasks OR ≥5 missing-date tasks OR ≥1 abandoned sprint OR ≥3 zero-progress tasks
- **Risk level**: low
- **Default policy**: require_approval

### IV.J — Agent 12: Dependency Risk Agent

- **Trigger**: per-project scan cycle
- **Perception**: builds dependency graph from all tasks, detects blocked chains (tasks depending on overdue/stalled blockers, traverses up to 5 levels), bottleneck tasks (≥3 dependents), long chains (depth >5)
- **Reasoning**: Claude analyzes dependency risks and proposes mitigation strategies
- **Output**: proposal with dependency risk analysis and recommended actions
- **Registration**: `dependency-risk-v1`, capability `dependency.analyze`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather indicators → reason → propose
- **Significance**: ≥1 blocked chain OR ≥1 bottleneck task OR ≥1 long chain
- **Risk level**: dynamic (critical/high/medium based on severity)
- **Default policy**: require_approval

### IV.K — Agent 13: Lessons Learned Agent

- **Trigger**: per-project, only when completion ≥90% OR status = `completed`
- **Perception**: gathers project completion rate, overdue task count, budget variance, project duration
- **Reasoning**: Claude extracts structured lessons by category (schedule, budget, resource, risk, technical, communication, stakeholder, quality) with impact assessment and recommendations
- **Output**: stores lessons in `lessons_learned` table; proposal with notification summarizing extracted lessons
- **Registration**: `lessons-learned-v1`, capability `lessons.extract`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → check completion → gather data → reason → store → propose
- **Skips when**: project already has ≥10 stored lessons (deduplication)
- **Risk level**: low
- **Default policy**: require_approval

### IV.L — Agent 14: Predictive Alerting Agent

- **Trigger**: per-project scan cycle
- **Perception**: analyzes velocity trend (recent 3-sprint avg vs historical), progress trajectory (completion % vs time elapsed %), risk accumulation (agent proposals in last 30 days), similar project comparison (avg completion/budget from 10 similar completed projects)
- **Reasoning**: Claude generates early warning with probability assessment
- **Output**: proposal with predictive alert and recommended preventive actions
- **Registration**: `predictive-alerting-v1`, capability `prediction.alert`
- **Guard chain**: cost budget → kill switch → rate limiter → circuit breaker → gather indicators → reason → propose
- **Significance**: velocity decline >20% OR behind schedule >15% OR ≥3 agent flags in 30 days
- **Risk level**: dynamic (critical/high/medium based on severity)
- **Default policy**: require_approval

### IV.M — Autonomous Execution (Tier 3)

Agents can be promoted from Tier 2 (propose-only) to Tier 3 (auto-execute) when they demonstrate sustained reliability.

**Autonomy tiers:**
- **Tier 1**: Disabled (agent does not run)
- **Tier 2** (default): Propose only — proposals require manual approval
- **Tier 3**: Auto-execute — proposals that meet confidence and risk gates are executed automatically

**Promotion criteria (Tier 2 → 3):**
- ≥30 days since first proposal
- ≥20 total proposals
- ≥80% acceptance rate
- ≥70% effectiveness rate (executed / accepted)
- Zero rollbacks

**Auto-execute gates:** Tier 3 AND confidence ≥ `minConfidenceThreshold` (default 80) AND risk ≤ `maxRiskLevel` (default `low`)

**API endpoints:**
- `GET /api/v1/agent/autonomy` — list autonomy configs
- `GET /api/v1/agent/autonomy/:agentId/eligibility` — promotion eligibility stats
- `PUT /api/v1/agent/autonomy/:agentId` — promote/demote (admin only)

**Service:** `AutonomyService` (`src/server/services/agents/AutonomyService.ts`)
**Table:** `agent_autonomy_config` (migration 003_agent_autonomy.sql)

---

## V. Policy Engine Configuration

Seed default policies from the strategy document. Policies are stored in the `policies` table and evaluated by `PolicyEngineService`.

### Default Policies to Seed

```
Policy: agent-low-risk-auto
  Action Pattern: agent.invoke.portfolio.*
  Condition: confidence_score >= 60
  Enforcement: log_only

Policy: agent-medium-risk-approval
  Action Pattern: agent.invoke.schedule.*
  Condition: confidence_score >= 40
  Enforcement: require_approval

Policy: agent-high-risk-approval
  Action Pattern: agent.invoke.resource.*
  Condition: confidence_score >= 40
  Enforcement: require_approval

Policy: agent-critical-risk-block
  Action Pattern: agent.invoke.budget.*
  Condition: always
  Enforcement: block

Policy: agent-low-confidence-block
  Action Pattern: agent.invoke.*
  Condition: confidence_score < 40
  Enforcement: block

Policy: agent-cost-circuit-breaker
  Action Pattern: agent.invoke.*
  Condition: daily_cost_usd > 10
  Enforcement: block
```

### Approval Chain Configuration
- Low risk: no approval needed
- Medium risk: project owner approval
- High risk: project owner + manager approval
- Critical risk: admin approval required

### Migration
- Create migration `NNN_seed_agent_policies.sql` to insert default policies
- Policies can be modified per project via the policy management API

---

## VI. API Routes

New endpoints in `src/server/routes/agent/`. All require authentication.

### Proposal Management
```
GET    /api/v1/agent/proposals                    — List proposals (query: projectId, status, agentId, page, limit)
GET    /api/v1/agent/proposals/:id                — Get proposal with actions and reasoning
POST   /api/v1/agent/proposals/:id/approve        — Approve proposal (body: { comment? })
POST   /api/v1/agent/proposals/:id/reject         — Reject proposal (body: { reason })
POST   /api/v1/agent/proposals/:id/execute        — Execute approved proposal
GET    /api/v1/agent/proposals/:id/actions         — Get individual actions and their status
```

### Feedback
```
GET    /api/v1/agent/proposals/:id/feedback       — Get outcome feedback for executed proposal
POST   /api/v1/agent/proposals/:id/feedback       — Submit feedback (body: { outcome, comment })
```

### Cost & Health
```
GET    /api/v1/agent/costs                        — Token usage (query: agentId, projectId, since, until, groupBy)
GET    /api/v1/agent/health                       — Agent system health (latency, error rates, circuit breaker status)
GET    /api/v1/agent/confidence/:agentId           — Confidence trend for an agent
```

### Settings
```
GET    /api/v1/agent/settings/:projectId          — Get agent settings for project (autonomy tier, enabled agents, cost limits)
PUT    /api/v1/agent/settings/:projectId          — Update agent settings for project
```

---

## VII. Frontend Components

New React components in `src/client/src/components/agent/` and pages in `src/client/src/pages/`.

### AgentProposalsPanel
- Lists pending/recent proposals with:
  - Title, agent name, confidence badge, risk level, created time
  - Approve/reject action buttons for pending proposals
  - Expandable reasoning section
- Filterable by status, agent, project
- Integrated into project detail view

### ProposalDetailView
- Full page view of a single proposal:
  - Chain-of-thought reasoning (formatted markdown)
  - Action list with old/new values, execution order
  - Risk assessment per action
  - Confidence breakdown (data quality, historical accuracy, model certainty)
  - Review history (who approved/rejected, comments)
  - Execution log (if executed)
  - Feedback form (if executed)

### AgentDashboard
- Overview page for agent system health:
  - Proposal stats: created, approved, rejected, expired, executed this period
  - Acceptance rate trend chart
  - Cost tracking: tokens used, estimated spend, budget remaining
  - Agent health: latency, error rates, last successful run
  - Top insights: most impactful proposals

### AgentActivityTimeline
- Visual timeline of agent actions across all projects:
  - Chronological feed of detections, proposals, approvals, executions
  - Filterable by project, agent, time range
  - Clickable entries link to proposal detail

### ConfidenceBadge
- Reusable component showing confidence level:
  - Color coded: red (<40%), yellow (40-60%), green (60-80%), blue (>80%)
  - Tooltip with factor breakdown
  - Used in proposals list, detail view, notifications

### AgentSettingsPanel
- Per-project agent configuration:
  - Autonomy tier selector (notify / propose / auto-execute)
  - Toggle individual agents on/off
  - Cost limit per day
  - Notification preferences
  - Policy overrides

### Integration Points
- Wire proposal notifications into existing NotificationService
- Add proposal count badge to sidebar navigation
- Add agent insights to project dashboard
- Enable agent interaction in AI chat panel ("why is this delayed?" triggers reasoning)

---

## VIII. Testing

### Unit Tests

**ReasoningEngine tests** (`src/server/__tests__/services/agents/ReasoningEngine.test.ts`)
- Mock Claude responses, verify structured output parsing
- Test context assembly with missing data (graceful degradation)
- Test prompt construction with various project states
- Test token tracking integration

**ActionExecutor tests** (`src/server/__tests__/services/agents/ActionExecutor.test.ts`)
- Verify sequential action execution in correct order
- Verify rollback on partial failure (action 3 fails, actions 1-2 rolled back)
- Verify audit logging for every mutation
- Verify old_value snapshot is accurate
- Test concurrent execution prevention (same proposal can't execute twice)

**ConfidenceCalculator tests** (`src/server/__tests__/services/agents/ConfidenceCalculator.test.ts`)
- Verify score computation from various input combinations
- Test with missing historical data (defaults to lower confidence)
- Test threshold behavior (score just above/below boundaries)

**ConflictResolver tests** (`src/server/__tests__/services/agents/ConflictResolver.test.ts`)
- Test stale detection when task dates change
- Test stale detection when task is deleted
- Test that human edits invalidate conflicting proposals
- Test same-entity conflict between two agents

**ActionProposalService tests** (`src/server/__tests__/services/agents/ActionProposalService.test.ts`)
- Test proposal creation and persistence
- Test lifecycle transitions (pending -> approved -> executed)
- Test expiration logic
- Test stale marking

### Integration Tests

**Full pipeline test** (`src/server/__tests__/integration/agentPipeline.test.ts`)
- End-to-end: detect delay -> reason -> propose -> approve -> execute -> verify state change -> audit log
- With mocked Claude (deterministic response)
- Verify all database state at each stage

**Policy gate test** (`src/server/__tests__/integration/agentPolicy.test.ts`)
- Agent proposes action, policy blocks it, verify proposal is created with blocked status
- Agent proposes action, policy requires approval, verify approval flow
- Agent proposes action, policy allows, verify auto-execution

### Regression Tests

**Golden test cases** (`src/server/__tests__/agents/golden/`)
- Known project scenarios with known-good agent responses
- Run against new agent versions to detect reasoning quality regressions
- Stored as JSON fixtures with input context + expected output shape

### Load Tests

**Scan cycle performance** (`src/server/__tests__/load/agentScan.test.ts`)
- Measure time for full portfolio scan with 10, 50, 100 projects
- Verify scan completes within acceptable time (target: <5 min for 100 projects)
- Verify memory usage stays within LVE limits (2GB RAM)

---

## IX. Observability & Monitoring

### Health Endpoint
`GET /api/v1/agent/health` returns:
```json
{
  "status": "healthy | degraded | unhealthy",
  "agents": {
    "schedule-recovery-v1": {
      "lastRun": "2026-06-28T02:00:00Z",
      "lastDurationMs": 4500,
      "errorRate24h": 0.02,
      "circuitBreaker": "closed",
      "proposalsCreated24h": 3,
      "proposalsApproved24h": 2
    }
  },
  "costs": {
    "today": { "tokens": 45000, "estimatedUsd": 1.35 },
    "budgetRemaining": 8.65
  },
  "pendingProposals": 5,
  "claudeApiStatus": "available"
}
```

### Metrics to Track
- Agent execution latency: p50, p95, p99 per agent
- Error rates: per agent per day, with error type breakdown
- Claude token usage: per agent, per project, per scan cycle
- Proposal lifecycle:
  - Created per day/week
  - Time to review (pending -> approved/rejected)
  - Acceptance rate (approved / (approved + rejected))
  - Execution success rate
  - Rollback rate
  - Expiration rate
- Confidence score distribution per agent
- Feedback scores (effective / partially effective / ineffective / made worse)

### Alerts
- Agent failure rate > 20% in 1 hour -> notify admin
- Cost budget > 80% consumed -> notify admin
- Proposal acceptance rate < 50% over 7 days -> review agent reasoning
- Circuit breaker opened -> notify admin
- No scan completed in 48 hours -> notify admin

### Dashboard
- Real-time agent status (AgentDashboard component)
- Historical trends (acceptance rate, cost, latency over time)
- Per-project agent activity drill-down

---

## X. Documentation

Update the following documents when agent features are implemented. Documentation ships in the same commit as the code.

### README.md
- Add agent architecture overview
- Add agent feature list
- Add agent configuration section (env vars)

### PRODUCT_MANUAL.md
- How agents work (end-user perspective)
- How to review and approve proposals
- How to provide feedback on executed proposals
- How to configure agent settings per project

### ADMIN_MANUAL.md (or create if not exists)
- Agent configuration guide (env vars, policies, cost limits)
- How to enable/disable agents globally and per project
- How to monitor agent health
- How to troubleshoot agent issues
- Policy management guide

### SECURITY_GUIDE.md
- Agent data access and isolation model
- Audit trail for agent actions
- Policy engine configuration for security
- Multi-tenancy safeguards

### API Documentation
- All new endpoints documented with request/response schemas
- Agent capability reference (registered agents, I/O schemas)
- Webhook events for agent actions

### TESTING_GUIDE.md
- How to run agent tests
- How to create golden test cases
- How to test agent reasoning quality

---

## Implementation Order

```
1. AGENT_STRATEGY.md (strategy, policy, governance sections)    -- defines the rules
2. Database migrations (6 new tables)                           -- persistence layer
3. Core services (8 services)                                   -- agentic pipeline
4. Schedule Recovery Agent (first agent)                        -- prove the pattern
5. Policy seed migration                                        -- default guardrails
6. API routes (proposals, feedback, costs, health)              -- expose to frontend
7. Frontend (proposals panel, detail view, dashboard)           -- user interaction
8. Tests (unit, integration, golden, load)                      -- quality gates
9. Observability (health endpoint, metrics, alerts)             -- operational visibility
10. Documentation updates                                       -- ship with code
11. Budget Intelligence Agent (second agent)                    -- expand coverage
12. Resource Optimization Agent (third agent)                   -- cross-project
13. Cross-Project Intelligence Agent (fourth agent)             -- portfolio level
14. Risk Escalation Agent (fifth agent)                         -- compound risks
15. Stakeholder Communication Agent (sixth agent)               -- status reports
16. Project Hygiene Agent (seventh agent)                        -- data quality
17. Dependency Risk Agent (eighth agent)                         -- blocked chains
18. Lessons Learned Agent (ninth agent)                          -- auto-extract
19. Predictive Alerting Agent (tenth agent)                      -- early warnings
20. Autonomous Execution (Tier 3)                                -- auto-execute
```

Each step is a commit-and-push cycle. Each agent follows the same pattern: register capability, wire into scheduler, test, document.

---

## Current Infrastructure (built and deployed)

| Component | File | Status |
|-----------|------|--------|
| Agent Registry | `src/server/services/AgentRegistryService.ts` | Production-ready |
| Agent Scheduler (14 agents) | `src/server/services/AgentSchedulerService.ts` | Production-ready |
| Agent Capabilities (15 registered) | `src/server/services/agentCapabilities.ts` | Production-ready |
| Policy Engine | `src/server/services/PolicyEngineService.ts` | Production-ready |
| Audit Ledger (hash-chained) | `src/server/services/AuditLedgerService.ts` | Production-ready |
| Agent Activity Log | `src/server/services/AgentActivityLogService.ts` | Production-ready |
| Claude Service | `src/server/services/claudeService.ts` | Production-ready |
| Auto-Reschedule Service | `src/server/services/AutoRescheduleService.ts` | Production-ready |
| Critical Path Service | `src/server/services/CriticalPathService.ts` | Production-ready |
| EVM Forecast Service | `src/server/services/EVMForecastService.ts` | Production-ready |
| Monte Carlo Service | `src/server/services/MonteCarloService.ts` | Production-ready |
| RAG Service | `src/server/services/RagService.ts` | Production-ready |
| Meeting Intelligence | `src/server/services/MeetingIntelligenceService.ts` | Production-ready |
| Lessons Learned | `src/server/services/LessonsLearnedService.ts` | Production-ready |
| Approval Workflow | `src/server/services/ApprovalWorkflowService.ts` | Production-ready |
| Notification Service | `src/server/services/NotificationService.ts` | Production-ready |
| Webhook Service | `src/server/services/WebhookService.ts` | Production-ready |
| DAG Workflow Engine | `src/server/services/DagWorkflowService.ts` | Production-ready |
| Service Container (DI) | `src/server/container.ts` | Production-ready |
| **ReasoningEngine** | `src/server/services/agents/ReasoningEngine.ts` | Production-ready |
| **ActionProposalService** | `src/server/services/agents/ActionProposalService.ts` | Production-ready |
| **ActionExecutor** | `src/server/services/agents/ActionExecutor.ts` | Production-ready |
| **ConfidenceCalculator** | `src/server/services/agents/ConfidenceCalculator.ts` | Production-ready |
| **AgentCostTracker** | `src/server/services/agents/AgentCostTracker.ts` | Production-ready |
| **ConflictResolver** | `src/server/services/agents/ConflictResolver.ts` | Production-ready |
| **ProposalRateLimiter** | `src/server/services/agents/ProposalRateLimiter.ts` | Production-ready |
| **DegradationHandler** | `src/server/services/agents/DegradationHandler.ts` | Production-ready |
| **KillSwitchService** | `src/server/services/agents/KillSwitchService.ts` | Production-ready |
| **AgentFeedbackService** | `src/server/services/agents/AgentFeedbackService.ts` | Production-ready |
| **ScheduleRecoveryAgent** | `src/server/services/agents/ScheduleRecoveryAgent.ts` | Production-ready |
| **ScopeCreepAgent** | `src/server/services/agents/ScopeCreepAgent.ts` | Production-ready |
| **BudgetIntelligenceAgent** | `src/server/services/agents/BudgetIntelligenceAgent.ts` | Production-ready |
| **ResourceOptimizationAgent** | `src/server/services/agents/ResourceOptimizationAgent.ts` | Production-ready |
| **CrossProjectIntelligenceAgent** | `src/server/services/agents/CrossProjectIntelligenceAgent.ts` | Production-ready |
| **RiskEscalationAgent** | `src/server/services/agents/RiskEscalationAgent.ts` | Production-ready |
| **StakeholderCommunicationAgent** | `src/server/services/agents/StakeholderCommunicationAgent.ts` | Production-ready |
| **ProjectHygieneAgent** | `src/server/services/agents/ProjectHygieneAgent.ts` | Production-ready |
| **DependencyRiskAgent** | `src/server/services/agents/DependencyRiskAgent.ts` | Production-ready |
| **LessonsLearnedAgent** | `src/server/services/agents/LessonsLearnedAgent.ts` | Production-ready |
| **PredictiveAlertingAgent** | `src/server/services/agents/PredictiveAlertingAgent.ts` | Production-ready |
| **AutonomyService** | `src/server/services/agents/AutonomyService.ts` | Production-ready |
| Agent trigger route | `src/server/routes/agent/agent.ts` | Production-ready |
| Policy routes | `src/server/routes/agent/policies.ts` | Production-ready |
| Agent activity log route | `src/server/routes/agent/agentActivityLog.ts` | Production-ready |
| Alert routes | `src/server/routes/agent/alerts.ts` | Production-ready |
| **Proposal routes** | `src/server/routes/agent/proposals.ts` | Production-ready |
| **Kill switch routes** | `src/server/routes/agent/killSwitch.ts` | Production-ready |
| **Agent health routes** | `src/server/routes/agent/agentHealth.ts` | Production-ready |
| **Autonomy routes** | `src/server/routes/agent/autonomy.ts` | Production-ready |
