# Agent Communication Architecture

> Last updated: September 2026

## Overview

Kovarti PM uses **16 specialized AI agents** (plus the Dreaming batch agent) that analyze project data, detect risks, propose actions, and generate insights. This document describes how these agents communicate today, the context engineering layer, and the recommended upgrade path to a more modern, event-driven architecture.

---

## Current Architecture: Blackboard Pattern (Shared Memory)

### How It Works

All 16 agents communicate through a **shared blackboard** — the `agent_memory` table in each tenant database. Agents write their findings as memory entries, and other agents read those entries to inform their own analyses.

The `agent_memory` table now includes **versioning** columns (`version`, `version_hash`) and **permission scoping** (`permission_scope`: org/project/user). All writes are versioned with audit trail via `memory_change_log`. This enables optimistic concurrency control (409 on hash mismatch) and rollback to previous versions.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Risk Agent  │     │ Budget Agent │     │ Schedule Agent│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │ write               │ write               │ write
       ▼                     ▼                     ▼
  ┌─────────────────────────────────────────────────────┐
  │              agent_memory table (blackboard)        │
  │  memory_type | agent_id | entity_id | key_name | value │
  └─────────────────────────────────────────────────────┘
       ▲                     ▲                     ▲
       │ read                │ read                │ read
┌──────┴───────┐     ┌──────┴───────┐     ┌──────┴───────┐
│ Scope Agent  │     │ Predict Agent│     │ Hygiene Agent│
└──────────────┘     └──────────────┘     └──────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `InterAgentQueryService` | `src/server/services/agents/InterAgentQueryService.ts` | Query insights from specific agents or all agents for a project |
| `memoryContext.ts` | `src/server/services/agents/memoryContext.ts` | Build cross-agent context for Claude prompts (includes skill catalog) |
| `AgentMemoryService` | `src/server/services/AgentMemoryService.ts` | CRUD operations on `agent_memory` table |
| `VersionedMemoryService` | `src/server/services/context/VersionedMemoryService.ts` | Versioned memory with optimistic locking and audit trail |
| `ContextConfigService` | `src/server/services/context/ContextConfigService.ts` | Hierarchical AI context config (org -> project -> user) |
| `DreamingService` | `src/server/services/context/DreamingService.ts` | Batch memory refinement from conversation analysis |
| `SkillRegistryService` | `src/server/services/context/SkillRegistryService.ts` | Skill catalog with progressive disclosure |
| `ReasoningEngine` | `src/server/services/agents/ReasoningEngine.ts` | Orchestrates agent analysis with memory context |

### Data Flow

1. **Agent runs** (triggered by cron or on-demand)
2. **Memory context loaded** — `getMemoryContext()` fetches:
   - Agent's own reflections (last 5)
   - Agent's project memories
   - **Cross-agent insights** — latest 10 memories from _other_ agents for the same project
3. **Context injected** — `formatMemoryContextForPrompt()` formats insights into the Claude prompt under `## Insights from Other Agents`, plus skill front-matter catalog from `SkillRegistryService`
4. **Agent analyzes** — Claude sees what other agents found and can build on their work
5. **Agent writes results** — findings stored back to `agent_memory` as `latest_scan`

### Strengths

- **Simple** — no message queues, no event bus, no additional infrastructure
- **Persistent** — all communication is durable in the database
- **Queryable** — insights can be queried historically, not just real-time
- **Zero coupling** — agents don't know about each other's existence

### Limitations

- **Polling, not reactive** — agents only see other agents' work when they next run (cron-based)
- **No causal chains** — if Budget Agent finds a cost spike, Risk Agent won't know until its next scan
- **No conflict resolution** — if two agents make contradictory recommendations, there's no arbitration
- **No delegation** — an agent can't ask another agent to do something

---

## Current Agents (16)

| Agent | File | Focus |
|-------|------|-------|
| Budget Intelligence | `BudgetIntelligenceAgent.ts` | Cost tracking, burn rate, budget alerts |
| Cross-Project Intelligence | `CrossProjectIntelligenceAgent.ts` | Portfolio-level patterns |
| Dependency Risk | `DependencyRiskAgent.ts` | Task dependency chains, critical path |
| Lessons Learned | `LessonsLearnedAgent.ts` | Extract and surface lessons |
| Predictive Alerting | `PredictiveAlertingAgent.ts` | Forecast delays, SPI/CPI trends |
| Project Hygiene | `ProjectHygieneAgent.ts` | Stale tasks, missing data, cleanup |
| Resource Optimization | `ResourceOptimizationAgent.ts` | Overallocation, utilization gaps |
| Risk Escalation | `RiskEscalationAgent.ts` | Risk severity changes, escalation |
| Schedule Recovery | `ScheduleRecoveryAgent.ts` | Slippage detection, recovery plans |
| Scope Creep | `ScopeCreepAgent.ts` | Unplanned work, scope growth |
| Stakeholder Communication | `StakeholderCommunicationAgent.ts` | Comm gap detection, update reminders |
| Insight Assembly | `InsightAssemblyService.ts` | Aggregates insights across agents |
| Action Proposal | `ActionProposalService.ts` | Proposes concrete actions for PM review |
| Confidence Calculator | `ConfidenceCalculator.ts` | Weights and scores agent outputs |
| Conflict Resolver | `ConflictResolver.ts` | Detects contradictory recommendations |
| Autonomy | `AutonomyService.ts` | Manages agent autonomy levels |
| **Dreaming** | `DreamingService.ts` | Batch agent: analyzes `chat_conversations`, extracts patterns, proposes memory updates. Runs nightly via cron (02:30), not on project events. |

---

## Context Engineering Layer

Inspired by Anthropic's context engineering framework, the system now implements four pillars:

### 1. Hierarchical Context Configuration
Org -> Project -> User layered AI instructions stored in `ai_context_configs`. Higher-scope admins can lock keys to prevent lower-scope overrides. Resolved context is injected into every AI system prompt via `ContextConfigService.resolveContext()`.

### 2. Dreaming / Batch Memory Refinement
Nightly cron job (02:30) analyzes recent `chat_conversations` using Claude to identify patterns (recurring corrections, preferences, domain terminology). Creates `dreaming_proposals` with confidence scores. Proposals >= 0.90 confidence are auto-applied; others require manual approval via the Settings > AI Context tab.

### 3. Versioned Permissioned Memory
The `agent_memory` table now has `version`, `version_hash`, `created_by`, `source`, and `permission_scope` columns. All mutations are logged to `memory_change_log`. Updates require the current `version_hash` (optimistic locking, 409 on mismatch). Rollback restores the previous value from the audit log.

### 4. Progressive Skill Disclosure
The `agent_skills` table stores a skill catalog with short summaries (front-matter) and detailed procedures. Front-matter is always included in agent context via `formatMemoryContextForPrompt()`. Detailed procedures are loaded on-demand when an agent needs to execute a skill. Skills are filtered by user role.

---

## Target Architecture: Event-Driven Pub/Sub + Tool-Use Delegation

### Why Upgrade

The blackboard pattern works well for periodic batch analysis. But as agents become more autonomous (proposing actions, executing automations), they need:

1. **Real-time reactivity** — when Risk Agent detects a red risk, Budget Agent should immediately check cost impact
2. **Directed delegation** — Mjuzi Chat should be able to ask a specific agent to run analysis on demand
3. **Conflict arbitration** — when agents disagree, a mediator should resolve before surfacing to the PM
4. **Audit trail** — every agent interaction should be traceable for governance

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AgentEventBus                         │
│  (in-process EventEmitter, no external infrastructure)  │
│                                                          │
│  Events:                                                 │
│    agent.insight.published                               │
│    agent.action.proposed                                 │
│    agent.delegation.request                              │
│    agent.delegation.response                             │
│    agent.conflict.detected                               │
└──────────┬──────────┬──────────┬──────────┬─────────────┘
           │          │          │          │
     ┌─────▼──┐ ┌─────▼──┐ ┌─────▼──┐ ┌────▼───┐
     │ Risk   │ │ Budget │ │Schedule│ │ Mjuzi  │
     │ Agent  │ │ Agent  │ │ Agent  │ │  Chat  │
     └────────┘ └────────┘ └────────┘ └────────┘
```

### Phase 1: AgentEventBus (Foundation)

Add an in-process event bus for agent-to-agent signaling. No external infrastructure needed.

**New file:** `src/server/services/agents/AgentEventBus.ts`

```typescript
import { EventEmitter } from 'events';

interface AgentEvent {
  type: string;
  sourceAgent: string;
  projectId: string;
  payload: unknown;
  timestamp: string;
  correlationId: string;
}

class AgentEventBus extends EventEmitter {
  publish(event: AgentEvent): void {
    this.emit(event.type, event);
    this.emit('*', event); // wildcard listener for logging
  }

  subscribe(eventType: string, handler: (event: AgentEvent) => void): void {
    this.on(eventType, handler);
  }
}

export const agentEventBus = new AgentEventBus();
```

**Migration:** `T0XX_agent_events.sql`

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  event_type VARCHAR(100) NOT NULL,
  source_agent VARCHAR(100) NOT NULL,
  target_agent VARCHAR(100),
  project_id CHAR(36),
  correlation_id CHAR(36),
  payload JSON,
  status ENUM('published', 'consumed', 'failed') DEFAULT 'published',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_type (project_id, event_type),
  INDEX idx_correlation (correlation_id),
  INDEX idx_created (created_at)
);
```

### Phase 2: Reactive Subscriptions

Wire agents to react to each other's events:

| When this happens... | ...trigger this |
|---|---|
| Risk Agent publishes HIGH risk | Budget Agent checks cost exposure |
| Budget Agent detects overspend >15% | Risk Agent creates budget risk item |
| Schedule Agent detects >5 day slippage | Predictive Agent re-forecasts completion |
| Scope Creep Agent detects growth >20% | Stakeholder Agent flags communication gap |
| Any agent proposes action | Conflict Resolver checks for contradictions |

### Phase 3: Mjuzi Tool-Use Delegation

Enable Mjuzi Chat to invoke agents on demand via a new MCP tool:

```typescript
// New MCP tool: invoke_agent
{
  name: 'invoke_agent',
  description: 'Run a specific agent analysis on demand',
  parameters: {
    agentId: { type: 'string', enum: ['risk', 'budget', 'schedule', ...] },
    projectId: { type: 'string' },
    question: { type: 'string', description: 'What to analyze' },
  }
}
```

This lets Mjuzi delegate specialized analysis:
- User asks "Will we hit our Q4 deadline?" → Mjuzi invokes Schedule Agent + Predictive Agent
- User asks "What's our budget risk?" → Mjuzi invokes Budget Agent + Risk Agent

### Phase 4: Conflict Resolution Protocol

When agents produce contradictory recommendations:

1. `ConflictResolver` detects overlap via `agent.action.proposed` events
2. Conflicting proposals are held (not surfaced to PM yet)
3. Claude evaluates both proposals with full context from both agents
4. Resolution: merge, pick one, or escalate to PM with both options annotated

### Phase 5: Agent Communication Dashboard

Surface agent-to-agent activity to PMs:

- Event timeline showing agent interactions
- Delegation chains (which agent asked which)
- Conflict resolution history
- Agent collaboration graph (who talks to whom most)

---

## Modern Agent Patterns — Ranked

Ranked by efficiency and modernity for a PM tool context:

| Rank | Pattern | Description | Fit for Kovarti |
|------|---------|-------------|-----------------|
| 1 | **Event-Driven Pub/Sub** | Agents publish events, others subscribe reactively | Best — matches our domain (project events → agent reactions) |
| 2 | **Tool-Use Delegation** | Agents invoke each other as tools via function calling | Great for Mjuzi → specialist agent delegation |
| 3 | **Orchestrator with Handoffs** | Central coordinator routes work to specialists | Good for complex multi-agent workflows |
| 4 | **Google A2A Protocol** | Standardized agent-to-agent communication | Overkill — designed for cross-organization agents |
| 5 | **Shared Scratchpad** | Agents read/write a shared workspace | Already have this (blackboard) — upgrade, don't duplicate |
| 6 | **Blackboard/Shared Memory** | Current pattern — polling-based shared state | Current state, works but not reactive |

**Recommended approach:** Layers 1 + 2 combined. Keep the blackboard for persistent memory (it works well), add event bus for reactivity, add tool-use for on-demand delegation.

---

## Implementation Priority

| Phase | Effort | Value | Dependencies |
|-------|--------|-------|-------------|
| 1. AgentEventBus | Small | Foundation for everything | None |
| 2. Reactive Subscriptions | Medium | Real-time agent collaboration | Phase 1 |
| 3. Mjuzi Delegation | Medium | User-facing improvement | Phase 1 |
| 4. Conflict Resolution | Small | Already partially built | Phase 2 |
| 5. Dashboard | Medium | Visibility/governance | Phase 1 |

**Total estimated files:** 5 new, ~14 modified. No external infrastructure required — everything runs in-process with database persistence for audit trail.

---

## Risk Mitigation

- **Infinite loops:** Event handlers must not re-publish events that trigger themselves. Use `correlationId` to detect cycles.
- **Performance:** Event handlers run async and fire-and-forget. Agent analysis is already bounded by AI API latency.
- **Backwards compatibility:** Blackboard (agent_memory) remains the source of truth. Event bus is additive, not replacement.
- **Testing:** Each reactive subscription should have unit tests verifying: event triggers handler, handler produces expected output, cycles are detected and broken.
