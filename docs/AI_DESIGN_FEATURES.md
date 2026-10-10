# AI Design Features - PM Assistant

**Last updated:** June 30, 2026
**LLM Provider:** Claude API (Anthropic SDK)
**Architecture:** Fastify + TypeScript backend, React frontend, MySQL database
**AI Kill Switch:** `AI_ENABLED` environment variable disables all AI features globally
**Agent Kill Switch:** `KillSwitchService` provides runtime API-controlled agent shutdown (global, per-agent, per-project) with audit trail — distinct from the env-var kill switch
**Agentic System:** three rule-based nightly checks (no AI) that propose, never act — **switched off** (`AGENT_ENABLED` unset on staging and production). The earlier 14 AI agents and the auto-execute tier were retired in October 2026.

---

## Overview

PM Assistant is an AI-assisted project management platform. AI runs when a person asks for it (a button, opening a tab, a chat question) and every change it suggests waits for the project's PM. Rule-based checks (Schedule Review, RAID Review, the Weekly PM review) find problems without AI. The earlier autonomous agents that "continuously monitored" projects were retired in October 2026, and the remaining nightly checks are switched off. Every AI capability is powered by the Anthropic Claude SDK, with structured JSON output validated by Zod schemas. All features degrade gracefully when AI is unavailable -- the application remains fully functional without AI.

Key architectural components:
- **Claude Service** (`claudeService.ts`) -- Core SDK integration with streaming, JSON schema mode, tool use, rate limiting, retry logic, and token tracking
- **AI Context Builder** (`aiContextBuilder.ts`) -- Assembles rich project/portfolio context for every AI call from database records
- **AI Action Executor** (`aiActionExecutor.ts`) -- Executes AI-recommended mutations (create/update tasks, projects) with policy-engine gating and audit logging
- **AI Tool Definitions** (`aiToolDefinitions.ts`) -- Claude tool schemas for agentic tool-use in chat
- **AI Usage Logger** (`aiUsageLogger.ts`) -- Tracks every AI request: tokens, cost, latency, success/failure
- **Prompt Templates** -- Versioned `PromptTemplate` class with variable interpolation; all prompts are version-controlled, not hardcoded strings
- **Agent Scheduler** (`AgentSchedulerService.ts`) -- Runs the three rule-based checks (no AI) from the `pm-cron@agent-scan` timer when `AGENT_ENABLED=true` (off today), or for one project on demand from its Agent Activity tab
- **Agentic Pipeline** (`services/agents/`) -- Autonomous reasoning, proposal creation, and controlled execution:
  - **ReasoningEngine** -- Assembles context, calls Claude with structured prompts, parses recovery/scope analysis plans
  - **ActionProposalService** -- Creates and manages proposals with lifecycle tracking (pending -> approved -> executed)
  - **ActionExecutor** -- Executes approved proposals step-by-step with rollback on failure
  - **ConfidenceCalculator** -- Weighted confidence scoring (data quality 40%, historical accuracy 30%, model certainty 30%)
  - **AgentCostTracker** -- Token usage tracking, budget enforcement, cost aggregation
  - **ConflictResolver** -- Detects stale proposals, prevents dual-agent conflicts, human-edit-wins rule
  - **ProposalRateLimiter** -- Per-agent/project rate limits (3/agent/24h, 10/all/24h, 10/agent/7d, 30/all/7d)
  - **DegradationHandler** -- Circuit breakers per agent, DB health monitoring, scan scope recommendation
  - **KillSwitchService** -- Global/per-agent/per-project emergency shutdown with audit logging
  - **AgentFeedbackService** -- Records proposal outcomes, feeds into historical accuracy scoring
- **MCP Server** (`mcp-server/`) -- Model Context Protocol server exposing 15+ tool categories to Claude Desktop and Claude Web

---

## 1. Mjuzi Chat

**Service:** `AIChatService` (`aiChatService.ts`)
**Repository:** `ChatRepository` (`database/ChatRepository.ts`)
**Endpoints:** `POST /api/v1/ai-chat/message` (non-streaming with tools), `POST /api/v1/ai-chat/stream` (SSE streaming)

Mjuzi is the persistent, context-aware conversational AI assistant available throughout the application.

**Capabilities:**
- Non-streaming mode with full agentic tool use, or streaming responses via Server-Sent Events (typewriter effect)
- Context-aware: knows which page and project the user is viewing (`dashboard`, `project`, `schedule`, `reports`, `general`)
- Agentic tool use: Claude can call tools to create tasks, update projects, assign resources, and more -- all gated by the policy engine
- **Database-backed persistence:** conversations and messages stored in `chat_conversations` and `chat_messages` tables via `ChatRepository`. Survives server restarts.
- **Agent memory integration:** injects `InterAgentQueryService` scan findings (none today — the nightly scan is switched off, `AGENT_ENABLED` unset), prior conversation count, and Mjuzi's own project memories (`agentMemoryService.recall('mjuzi-chat', ...)`) into the system prompt. All of these live in the company's own database since 2026-10-09; before that the scan findings were written to the shared database but read from the company's, so they never reached the prompt
- **Action memory:** after tool use, stores a summary via `agentMemoryService.store()` for future reference
- Action results embedded in responses (e.g., "I created task X" with confirmation)
- Conversation history UI: browse, switch, and resume past conversations
- Conversation continues across page navigation and browser refreshes
- **Knowledge Base RAG:** `search_knowledge_base` tool searches embedded product documentation. 5 doc files (USER_GUIDE, PRODUCT_MANUAL, WORLD_CLASS_FEATURES, ADMIN_MANUAL, AI_DESIGN_FEATURES) are chunked by `###` heading, embedded via OpenAI text-embedding-3-small, and stored in `knowledge_base_chunks` table. Vector search uses MariaDB `VEC_DISTANCE_COSINE()` on the `embeddings` table (document_type='knowledge_base'). Admin reindex endpoint: `POST /api/v1/admin/knowledge-base/reindex`. Claude calls this tool automatically for how-to and feature questions.

**Tool-use flow:**
1. User sends a message with optional context (project ID, page type)
2. AIChatService builds project context via AIContextBuilder, enriched with agent insights and Mjuzi memories
3. Claude receives the message with tool definitions from `aiToolDefinitions.ts`
4. If Claude invokes a tool, AIActionExecutor runs the action with policy checks and audit logging
5. Response returned to client; conversation and messages persisted to database

---

## 2. Auto-Rescheduling

**Service:** `AutoRescheduleService` (`AutoRescheduleService.ts`)
**Endpoints:** `GET /api/auto-reschedule/delays/:scheduleId`, `POST /api/auto-reschedule/propose/:scheduleId`, `POST /api/auto-reschedule/apply/:proposalId`

Detects schedule delays and generates AI-powered reschedule proposals.

**Capabilities:**
- Scans tasks for delays by comparing actual progress to planned dates
- Uses critical path analysis to assess downstream impact
- Claude generates reschedule proposals with per-task date adjustments
- Each proposal includes rationale, estimated impact (original vs proposed end date, days change, critical path effect)
- Proposals are persisted to the database with status tracking (`pending`, `accepted`, `rejected`)
- Users review and accept/reject proposals; accepted proposals apply date changes automatically
- Integrated with audit ledger for accountability

---

## 3. Natural Language Queries

**Service:** `NLQueryService` (`NLQueryService.ts`)
**Endpoint:** `POST /api/ai/nl-query`

Ask questions about projects in plain English, get answers with auto-generated charts.

**Capabilities:**
- Two-phase AI pipeline:
  1. **Tool-loop phase:** Claude uses read-only tools (`list_projects`, `get_project_details`, `get_evm_metrics`, `get_critical_path`, `get_resource_workload`, `aggregate_portfolio_stats`) to gather real data
  2. **Structuring phase:** A second Claude call formats the answer into structured JSON with markdown text, chart specifications, and follow-up suggestions
- Chart types: bar, line, pie, horizontal bar -- rendered client-side
- Follow-up question suggestions for drill-down exploration
- All answers grounded in real data; no hallucinated numbers

---

## 4. Meeting Intelligence

**Service:** `MeetingIntelligenceService` (`MeetingIntelligenceService.ts`)
**Endpoint:** `POST /api/meetings/analyze`

Upload meeting notes or transcripts; AI extracts action items and updates tasks.

**Capabilities:**
- Accepts plain-text meeting transcripts
- Claude analyzes against existing tasks and resources for context
- Extracts: action items, responsible parties, deadlines, decisions made, key discussion points
- Maps extracted items to existing tasks (updates) or creates new tasks
- Matches assignees to known resources by name and role
- Confidence scoring on each extraction
- Validates output against `MeetingAIResponseSchema`
- **Meeting Coach (Oct 2026):** every item carries `calledOut` (true only when someone explicitly labelled it in the meeting, any natural wording) and a short `quote`. The prompt gives the meeting date and weekday so spoken dates ("by Friday") become YYYY-MM-DD; with no date said, dueDate stays empty. Owner ids are never taken from the model: names are resolved to project members in `meetingCoach.resolveOwner`, and ambiguous first names become a PM choice. The scorecard is deterministic (`buildScorecard`), not AI.
- **Speaker attribution (Oct 2026):** when the transcript names its speakers (`[Name] (H:MM:SS)` lines — Teams VTT uploads and Meeting Intelligence → From Teams), the AI fills `saidBy`/`at` on action items, risks and issues and `madeBy`/`at` on decisions, using the names exactly as written; a speaker who takes an action on themselves becomes its assignee; speakers marked "(not a project member)" are not made assignees unless clearly given the task; with no speaker names the fields stay empty (never guessed). From Teams rewrites speakers to the confirmed project member names before analysis.

---

## 5. Lessons Learned

**Service:** `LessonsLearnedService` (`LessonsLearnedService.ts`)
**Endpoint:** `POST /api/lessons-learned/extract`, `POST /api/lessons-learned/patterns`, `POST /api/lessons-learned/mitigate`

AI-driven pattern recognition across projects with mitigation suggestions.

**Capabilities:**
- **Lesson extraction:** Analyzes project and schedule data to extract actionable lessons categorized by type (schedule, budget, resource, risk, technical, communication, stakeholder, quality) with positive/negative impact classification
- **Pattern detection:** Cross-project analysis identifies recurring patterns with frequency counts and strategic recommendations
- **Mitigation suggestions:** For identified patterns, generates specific mitigation strategies
- Confidence scoring on all outputs
- Evidence-based: observations drawn from actual project data, not generic advice

---

## 6. Task Prioritization

**Service:** `TaskPrioritizationService` (`TaskPrioritizationService.ts`)
**Endpoints:** `GET /api/v1/task-prioritization/:projectId/:scheduleId/prioritize` (the worked-out ranking — no AI, for anyone who can see the plan); `POST /api/v1/task-prioritization/:projectId/:scheduleId/prioritize/ai` (the project's PM presses "Refine with AI": write access, AI plan, 20 per 10 minutes)

Task importance from algorithmic scoring; Claude refines it only on request (since 2026-10-10 — opening the panel used to call the AI every time, for viewers too). The AI sees the top 40 tasks, sent once in compact form, and its answer is reused for 30 minutes.

**Capabilities:**
- Gathers task data, critical path results, and delay detection
- Algorithmic scoring based on: critical path membership, delay severity, dependency count, float/slack
- On request, Claude provides qualitative reasoning for the top 40 tasks (the rest keep the worked-out ranking)
- Priority tiers: urgent (76-100), high (51-75), medium (26-50), low (0-25)
- Output: prioritized task list with scores, factors, and AI explanations
- Validated against `PrioritizationAIResponseSchema`

---

## 7. Predictive Intelligence

**Service:** `predictiveIntelligence.ts`
**Endpoints:** `GET /api/predictions/risks/:projectId`, `GET /api/predictions/weather/:projectId`, `GET /api/predictions/budget/:projectId`, `GET /api/predictions/dashboard`

Multi-factor risk forecasting and health scoring.

**Capabilities:**
- **Risk assessment:** AI-powered risk analysis combining schedule variance, budget utilization, task completion rates, and overdue counts into severity-scored risk items with suggested mitigations
- **Weather impact:** Integrates with pluggable weather data providers to predict outdoor task delays; Claude maps weather conditions to task sensitivity
- **Budget forecasting:** EVM-based (CPI, SPI, EAC, ETC) cost predictions with AI-interpreted narrative explaining trends and corrective actions
- **Dashboard predictions:** Aggregated portfolio-level health predictions across all active projects
- All outputs validated against Zod schemas (`AIRiskAssessmentSchema`, `AIWeatherImpactSchema`, `AIBudgetForecastSchema`, `AIDashboardPredictionsSchema`)

**AI only when asked (audit 2026-10-10):** a kept AI answer carries `aiGeneratedAt` (`cachedAIResult`), and the tab's banner says which source each prediction shows ("Risk: AI answer from 14:32 … Weather: worked out by rules"). The tab opens with `?ai=0` — risk, weather and budget show the AI answer already kept for the project (30 minutes) or else the rules' answer, with no AI call. Its **Ask AI** button (and API / MCP callers, who leave `ai` off) asks the AI. Weather never asks the AI when no outdoor work is left. The Portfolio Intelligence panel re-asks by itself at most once an hour (Refresh still asks, at most every 10 minutes).

**Deterministic helpers (no AI required):**
- `computeEVMMetrics()` -- Pure math EVM calculations
- `computeDeterministicRiskScore()` -- Algorithmic risk scoring as baseline

---

## 8. Anomaly Detection

**Service:** `AnomalyDetectionService` (`anomalyDetectionService.ts`)
**Endpoint:** `GET /api/anomalies`

Identifies unusual patterns in project data and explains their significance.

**Capabilities:**
- Algorithmic detection of anomalies: sudden completion rate drops, unusual budget spending patterns, stalled tasks, projects with no activity
- Computes metrics from project context: completion rate, budget utilization, overdue tasks, days elapsed/remaining
- Claude provides root-cause analysis, enhanced descriptions, prioritized recommendations, and overall health trend assessment (improving/stable/deteriorating)
- Portfolio-wide scanning across all active projects

---

## 9. Cross-Project Intelligence

**Service:** `CrossProjectIntelligenceService` (`crossProjectIntelligenceService.ts`)
**Endpoint:** `GET /api/cross-project-intelligence`

Strategic insights spanning the entire project portfolio.

**Capabilities:**
- Detects resource conflicts across projects
- Identifies budget reallocation candidates (underspent projects that could fund overspent ones)
- Finds similar projects and extracts lessons learned from successful approaches
- Claude generates strategic portfolio-level recommendations
- EVM metrics computed per project for portfolio comparison

---

## 10. What-If Scenarios

**Service:** `WhatIfScenarioService` (`whatIfScenarioService.ts`)
**Endpoint:** `POST /api/scenarios`

Scenario modeling with cascading impact analysis.

**Capabilities:**
- User describes a scenario in natural language (e.g., "What if we add 3 more developers?" or "What if the budget is cut by 20%?")
- Numeric parameters applied deterministically as a baseline
- Claude models cascading effects on schedule, budget, resources, and risk profile
- Impact analysis covers: downstream task dependencies, resource reallocation needs, risk profile changes, external factors
- Confidence scoring (0.5-0.9) on scenario outcomes
- Output validated against `AIScenarioResultSchema`

---

## 11. Proactive Alerts

**Service:** `ProactiveAlertService` (`proactiveAlertService.ts`)
**Endpoint:** `GET /api/proactive-alerts`

Auto-generated warnings based on real-time project data analysis.

**Alert types:**
- `overdue_task` -- Tasks past their due date
- `budget_threshold` -- Budget utilization at 90%+ (warning) or 100%+ (critical)
- `stalled_task` -- In-progress tasks with no activity
- `resource_overload` -- Resources over-allocated
- `approaching_deadline` -- Projects nearing end dates with insufficient progress

**Each alert includes:**
- Severity level (info, warning, critical)
- Descriptive title and explanation with real numbers
- Suggested action with tool name and parameters (actionable by AI chat)

---

## 12. AI Report Synthesis

**Service:** `AIReportService` (`aiReportService.ts`)
**Endpoint:** `POST /api/v1/ai-reports/generate`

AI-generated executive summaries and status reports.

**Report types:**
- `weekly-status` -- Weekly project status summary
- `risk-assessment` -- Risk analysis report
- `budget-forecast` -- Budget projection report
- `resource-utilization` -- Resource allocation report

**Capabilities:**
- Builds full project context via AIContextBuilder
- Claude generates narrative reports tailored to the data
- Reports include AI-generated insights, not just data dumps
- Each report tracked with token count and generation metadata

### 12b. Automated Project Status Reports (RAG Traffic Light)

**Service:** `ProjectStatusReportService` (`ProjectStatusReportService.ts`)
**Renderer:** `statusReportRenderer.ts` — shared HTML rendering with `renderStatusReportHtml()`, `computeTrend()`, types `RAGArea`, `StructuredStatusReport`
**Endpoints:**
- `POST /api/v1/status-reports/generate` -- Generate a status report with optional email delivery
- `POST /api/v1/status-reports/schedule` -- Create recurring schedule (daily/weekly/monthly)
- `GET /api/v1/status-reports/schedules/:projectId` -- List schedules for a project
- `DELETE /api/v1/status-reports/schedule/:id` -- Delete a schedule

Dedicated service for executive RAG (Red/Amber/Green) traffic light status reports. Claude receives project data, configurable RAG thresholds, and the previous report's RAG values, then returns structured JSON with `executiveSummary`, `areas[]` (name/status/comments), and `managementActions[]`. The JSON is parsed, trends computed, and rendered to styled HTML.

**Report structure:**
1. Executive Summary — AI-generated paragraph
2. Traffic Light Dashboard — 6 areas (Schedule, Budget, Resources, Risks, Scope, Quality) × 4 columns (Previous, Current, Trend, Comments)
3. Actions for Management — numbered recommendations

**RAG thresholds** are defined in `DEFAULT_RAG_THRESHOLDS` and passed to the prompt template. Claude uses these to assign Green/Amber/Red per area.

**Trend computation:** `computeTrend(current, previous)` uses ordinal comparison (green=0, amber=1, red=2). Lower = improving (↑), same = stable (→), higher = declining (↓). Previous status retrieved from last stored report in `ai_conversations` where `context_type = 'status-report'`.

**Key features:**
- Structured JSON output from Claude (with code fence stripping as defense-in-depth)
- Styled HTML rendering via `renderStatusReportHtml()` — used in both UI modal and email
- Fallback: all areas set to Amber with generic comments when AI unavailable
- Email delivery to stakeholder lists via `EmailService.sendStatusReportEmail()`
- Recurring schedules via `ReportScheduleService` (uses `templateId = "status-report::<projectId>"` convention)
- Reports stored in `ai_conversations` table with `context_type = 'status-report'`
- MCP tool: `generate-status-report` (PM, scrum_master, pmo, ba, admin roles)
- Feature-gated: requires paid tier

---

## 13. AI Task Breakdown

**Service:** `ClaudeTaskBreakdownService` (`aiTaskBreakdownClaude.ts`)
**Endpoint:** `POST /api/ai/analyze-project`

AI-powered project decomposition into tasks with durations and dependencies.

**Capabilities:**
- PM describes project in natural language
- Claude generates tailored task breakdown specific to the project (not generic templates)
- Estimates durations, suggests dependencies, assigns complexity and risk levels
- Uses project context from AIContextBuilder when available
- Falls back to `FallbackTaskBreakdownService` (keyword-based templates) when AI is unavailable
- Output validated against `AIProjectAnalysisSchema`

---

## 14. AI Project Creation

**Service:** `AIProjectCreatorService` (`aiProjectCreator.ts`)
**Endpoint:** `POST /api/ai/create-project`

Natural language project setup: describe a project, get a fully structured project with schedule and tasks.

**Capabilities:**
- User provides a plain-English project description
- Chains AI task breakdown to generate the full work breakdown structure
- Automatically creates: project record, schedule, all tasks with dependencies and durations
- Derives project name, dates, budget estimates from the AI analysis
- Returns the complete project structure for immediate use

---

## 15. Resource Optimization

**Service:** `ResourceOptimizerService` (`ResourceOptimizerService.ts`)
**Endpoints:** `GET /api/resource-optimizer/bottlenecks/:projectId`, `POST /api/resource-optimizer/rebalance/:projectId`

AI-suggested resource rebalancing and bottleneck prediction.

**Capabilities:**
- **Bottleneck prediction:** Scans resource workloads for upcoming weeks, detects over-allocation periods and burnout risks
- **Capacity forecasting:** Projects weekly capacity vs demand, identifies gaps
- **Skill matching:** Matches available resources to task requirements by skills
- **Rebalancing suggestions:** Claude generates specific reassignment recommendations with effort levels and priorities
- Output validated against `ResourceForecastResultSchema` and `RebalanceSuggestionSchema`

---

## 16. EVM Forecasting

**Service:** `EVMForecastService` (`EVMForecastService.ts`)
**Endpoint:** `GET /api/evm-forecast/:projectId`

AI-enhanced Earned Value Management predictions.

**Capabilities:**
- Computes standard EVM metrics from S-curve data: CPI, SPI, EAC, ETC, VAC, TCPI
- Tracks historical weekly CPI/SPI trends
- Detects early warnings (cost overrun trending, schedule slippage, TCPI exceeding thresholds)
- Traditional forecasting methods (cumulative CPI, composite CPI/SPI, 3-period moving average)
- Claude analyzes all metrics and provides:
  - 4-week CPI/SPI predictions with trend direction
  - AI-adjusted EAC with confidence range
  - Cost overrun probability estimate
  - Corrective action recommendations with effort and priority
  - Narrative summary in plain language
- Output validated against `EVMForecastAIResponseSchema`

**Per-task Actual Cost (AC):** The S-curve AC series now uses per-task `actualCost` data when available. The service sums each task's recorded actual cost and distributes it proportionally to the task's elapsed time within each period. This makes CPI and all cost-derived metrics more accurate than the previous method (linear distribution of project-level `budgetSpent`). The fallback to linear distribution is retained when no tasks have per-task costs recorded.

**Three more screens ask only when a person does (Oct 2026):** the risk/issue form's mitigation ideas (button "Suggest mitigations from past lessons"; was every keystroke), the Time tab's weekly summary (written when the panel is opened, never for a week with no hours; the Friday time pack never asks), and the Team tab's rebalancing ideas (button "Suggest how to rebalance", project PM only, `POST /resource-optimizer/:id/rebalance-suggestions`; the forecast GET never calls the AI). Guard: `__tests__/routes/aiOnlyWhenAsked.test.ts`.

**When the AI is asked (Oct 2026):** only when someone opens the project's **Performance** view — opening a project no longer pre-loads the AI predictions (it used to cost one AI call per project open). The page never retries the request. If the AI can't be reached (no credit, bad key, rate limit, overload, timeout — `isAIUnavailableError` in `claudeService.ts`), `EVMForecastService` remembers it for 10 minutes (Redis `evm:ai:unavailable`), logs one warning, and `/evm-forecast/:id/ai` answers normally with `{ aiPredictions: null, unavailable: true }`; the panel says "AI analysis is unavailable right now". Not a 5xx, so it isn't retried or counted by the server-error alert.

**Verified Facts in AI Narrative (prompt v1.3.0):** The EVM narrative prompt uses pre-computed verified facts instead of asking the AI to derive numbers from raw metrics. Before calling Claude, `EVMForecastService` computes: `percentComplete` (EV/BAC), `percentPlanned` (PV/BAC), `scheduleStatus` (ahead/behind/on schedule), `budgetStatus` (under/over/on budget), `percentBudgetSpent` (AC/BAC), `scheduleOutlook`, and `forecastOutcome`. These are injected into the prompt as "VERIFIED FACTS — use these exact numbers." Claude writes the narrative prose around the pre-computed values without recalculating them, guaranteeing that the percentages and status labels in the AI narrative exactly match the EVM KPI cards displayed on the dashboard.

---

## 17. Monte Carlo Simulation

**Service:** `MonteCarloService` (`MonteCarloService.ts`)
**Endpoint:** `POST /api/monte-carlo/:scheduleId`

Probabilistic schedule simulation for completion date confidence intervals.

**Capabilities:**
- Pure computational service (no AI required)
- Configurable iterations (default: 10,000)
- Supports PERT and triangular distribution models for task duration uncertainty
- Configurable uncertainty factor per task based on status, complexity, and risk
- Forward-pass network simulation respecting task dependencies (via critical path service)
- Outputs: P50/P80/P90 completion dates, histogram bins, sensitivity analysis (which tasks most affect duration), criticality index (how often each task lands on the critical path)

---

## 18. Natural Language Workflow Builder

**Route:** `POST /api/v1/workflows/generate` in `workflows.ts`
**Schema:** `workflowGenerationSchemas.ts`

AI-powered workflow generation from plain English descriptions.

**Capabilities:**
- User provides a natural language description of desired automation (10-500 chars)
- System prompt enumerates all available trigger types, action types, condition operators, and node types from the DAG engine
- `claudeService.completeWithJsonSchema()` generates a structured workflow: `{ name, description, nodes[], edges[] }`
- Output validated with Zod schema (node types, edge index bounds, trigger-first rule)
- Returns workflow definition for preview in the existing visual editor before save
- Supports optional `projectId` scoping
- Budget-enforced via per-user AI token tracking

**Architecture:** No new service — the route directly calls `claudeService` with a static system prompt constant and the generation output schema. The frontend populates the existing form state, so the user reviews and edits before saving through the standard create flow.

---

## AI Scheduling Services

**Service:** `aiSchedulingClaude.ts`
**Endpoints:** `POST /api/ai/dependencies`, `POST /api/ai/optimize-schedule`, `POST /api/ai/insights`

Three AI-powered scheduling capabilities:

- **Dependency Detection:** Claude reads all tasks in a project and identifies logical dependencies (finish-to-start, start-to-start, finish-to-finish) with confidence scores and reasoning
- **Schedule Optimization:** Analyzes current schedule for inefficiencies and suggests task reordering, resource leveling, fast-tracking, and compression opportunities
- **Project Insights:** AI-generated health analysis with trends, risks, strengths, and actionable recommendations

All outputs validated against Zod schemas (`AIDependencyResponseSchema`, `AIScheduleOptimizationSchema`, `AIProjectInsightsSchema`).

---

## AI Learning System

**Service:** `AILearningServiceV2` (`aiLearningService.ts`)

Persistent learning from user feedback on AI suggestions.

**Capabilities:**
- Records user feedback on AI predictions: accepted, modified, or rejected
- Tracks actual vs estimated values (duration, cost, risk) after completion
- Computes accuracy reports with mean variance, bias direction, and sample counts per metric type
- Claude analyzes accuracy reports and suggests calibration improvements
- Database-backed persistence (`ai_feedback`, `ai_accuracy_tracking` tables)

---

## AI Task Estimation

**Service:** `AiTaskEstimationService` (`AiTaskEstimationService.ts`)
**Route:** `POST /api/v1/ai/estimate-task`

Suggests estimated duration (in working days) for new tasks using historical data and Claude reasoning.

**How it works:**
1. Queries up to 200 most recent completed tasks with actual vs estimated days
2. Sends task name, description, and historical context to Claude with a structured JSON schema
3. Claude returns: `estimatedDays` (fractional), `confidence` (0-100), and `reasoning`
4. Falls back to simple average of historical actual days when AI is unavailable

**Frontend integration:**
- Sparkles button next to the "Est. Duration (days)" field in TaskFormModal
- Populates the field with the AI estimate and shows a hint with confidence and reasoning
- Requires a task name and project context to be available

---

## Architecture: Supporting Infrastructure

### Claude Service (`claudeService.ts`)

The core integration layer for all AI features:

- Anthropic SDK (`@anthropic-ai/sdk`) with configurable model, max tokens, and temperature
- **Completion modes:** standard text, JSON schema (structured output with Zod validation), streaming (SSE chunks), and tool-use (agentic loops)
- Versioned prompt templates with `{{variable}}` interpolation
- Rate limiting and retry with exponential backoff
- Request timeout (30s default)
- Token usage tracking with per-model cost calculation (supports Sonnet, Haiku, Opus pricing)
- Per-tier budget enforcement: budget resolution chain (per-user override → tier default → global fallback + top-up tokens). Returns HTTP 429 with `AI_BUDGET_EXCEEDED` code when exhausted.
- Graceful degradation: `isAvailable()` check guards all AI features; budget exhaustion blocks AI but preserves all non-AI functionality

**Before every call (`preflight`, audit 2026-10-10):**
- **Plan gate for every AI call:** `aiBudgetService.checkBudget` first checks the person's plan includes `ai_assistant` (a plan without it answers 403 `UPGRADE_REQUIRED`, which opens the upgrade window). A **viewer** is judged by their company's plan, not the trial plan left on their own record. Calls billed to someone else (an automation's owner, a scheduled report's creator) are checked against that person. Background jobs with no person are covered by the account's monthly cap only.
- **Prompt estimate counts:** the prompt is estimated at ~4 characters per token; the budget check refuses when this month's use plus the estimate would go over (before, only "already over?" was checked). A prompt over `MAX_PROMPT_TOKENS` (150k) is refused with a plain 422 `AI_PROMPT_TOO_LARGE` before anything is paid for.
- **Tool loops check every turn:** `completeToolLoop` reads the plan and the month's usage once, before the first turn (`checkBudget` returns a snapshot), then checks each later turn locally with `assertFits(used at start + this loop's spend, budget, this turn's estimate)` — earlier turns are counted once, and the turn that would not fit is never sent. A tool result longer than `MAX_TOOL_RESULT_CHARS` (40k) is cut with a note. Every turn's failure counts toward the circuit breaker.
- **Fewer paid retries:** the fallback model gets no extra SDK retry; a JSON reply cut off at the output limit is not asked for again (it would be cut off again).

**Refusals answer as what they are:** routes reply through `aiRefusalReply(err)` (AIBudgetService): plan without AI → 403 `UPGRADE_REQUIRED` (`AIPlanRequiredError`, its own name), budget used up → 429, the account's monthly cap → 503 `AI_UNAVAILABLE` with a neutral message (`AIAccountCapError`; Kovarti's spend is logged, never shown).

**Bounded tool results (`aiToolLimits.ts`):** `list_tasks` (Mjuzi and NL query) takes optional `nameContains`, `status` and `assignedTo` filters, applied before the row limit, so any task in a big plan can be found; the cut-off note points to them. Mjuzi's and NL query's list tools return at most 200 rows (`list_tasks`, `get_project_details` across plans with each plan's task count, `get_overdue_tasks` — the most overdue first, project lists) and say "Showing 200 of N". NL query results are compact JSON. A stored chat message keeps only each action's outcome line (`chat_messages.actions` is kept forever), not the tool's data.

**Configuration:**
```
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-4-5-20250929
AI_MAX_TOKENS=4096
AI_TEMPERATURE=0.3
AI_ENABLED=true
```

### AI Context Builder (`aiContextBuilder.ts`)

Assembles rich context for every AI call:

- `buildProjectContext(projectId)` -- Pulls project metadata, schedules, tasks, team, budget into a `ProjectContext` object
- `buildPortfolioContext()` -- Aggregates all projects into a `PortfolioContext` for cross-project features
- `toPromptString(context, maxTasks = 300)` -- Serializes context into a compact string for prompt injection. Over the limit it lists open tasks only, in plan order, and says how many there are (Mjuzi's chat uses 100: its system prompt is resent on every tool-loop turn)
- Keeps token usage efficient by structuring data compactly

### AI Action Executor (`aiActionExecutor.ts`)

Executes AI-recommended mutations safely:

- Supports: `create_task`, `update_task`, `create_project`, `update_project`, and more
- Every action passes through the **policy engine** for role-based authorization
- Every action is recorded in the **audit ledger** for accountability
- Returns structured `ActionResult` with success/failure, summary, and data

### AI Usage Logger (`aiUsageLogger.ts`)

Tracks all AI API usage for cost monitoring:

- Logs: user, feature name, model, input/output tokens, cost estimate, latency, success/failure
- Per-model pricing tables (Sonnet, Haiku, Opus)
- Database-backed (`ai_usage_log` table)

### Agent Scheduler (`AgentSchedulerService.ts`)

Cron-based background AI analysis:

- **Daily scan** on configurable schedule (`AGENT_CRON_SCHEDULE`, default: 2 AM)
  - Kill switch guard at top of scan — aborts if globally disabled
  - Scans all active projects through 5 agents:
    1. **Auto-Reschedule** — delay detection and proposal generation
    2. **Budget Burn-Rate** — CPI/SPI threshold monitoring
    3. **Monte Carlo Confidence** — schedule risk assessment
    4. **Meeting Follow-Up** — overdue action items and unapplied updates
    5. **Scope Creep Detection** — task growth, estimate increases, change requests vs baselines
  - Generates notifications and webhook events for detected issues
  - Logs all agent activity via `AgentActivityLogService`
- **Overdue-task scanner** runs every N minutes (`AGENT_OVERDUE_SCAN_MINUTES`, default: 15)
  - Detects tasks where `end_date < NOW()` and status is not completed/cancelled
  - Fires `date_passed` workflow triggers via `dagWorkflowService.evaluateTaskChange()`
  - Deduplicates to avoid re-triggering for the same task
- Controlled by `AGENT_ENABLED` environment variable and `KillSwitchService` runtime API

### Event-Driven Workflow Integration

Task and project lifecycle events automatically trigger DAG workflows:

- `ScheduleService.createTask()` and `updateTask()` call `dagWorkflowService.evaluateTaskChange()` (fire-and-forget)
- `ProjectService.update()` calls `dagWorkflowService.evaluateProjectChange()` on budget or status changes
- Trigger types: `task_created`, `status_change`, `priority_change`, `assignment_change`, `dependency_change`, `budget_threshold`, `project_status_change`, `date_passed`, `progress_threshold`, `manual`
- Actions include `send_notification` (creates real notifications), `invoke_agent` (calls registered agent capabilities), `update_field`, and `log_activity`

### MCP Server (`mcp-server/`)

Model Context Protocol server for Claude Desktop and Claude Web integration:

**11 tools** were defined in the original prototype `mcp-server/server.ts` (removed 2026-10-08); the live server is `mcp-server/src/index.ts`, which has many more:
| Tool | Description |
|------|-------------|
| `list-projects` | List all projects |
| `get-project` | Get project details by ID |
| `get-schedules` | Get all schedules for a project |
| `get-tasks` | Get all tasks in a schedule |
| `get-project-health` | AI health score for a project |
| `get-project-risks` | AI risk assessment for a project |
| `get-project-budget` | AI budget forecast for a project |
| `get-analytics` | Portfolio-level analytics summary |
| `get-alerts` | Proactive alerts across all projects |
| `search` | Search projects and tasks by keyword |
| `get-portfolio` | Full portfolio overview |

**Authentication:** API key (stdio transport); OAuth 2.1 with PKCE (HTTP transport)
**Transport:** stdio (MCP SDK); HTTP reverse proxy via `/mcp` route with OAuth 2.1 authorization server

---

## Agentic Pipeline (`src/server/services/agents/`)

PM Assistant's agentic system evolves from reactive alerts to autonomous reasoning with human oversight. Agents follow the cycle: **perceive -> reason -> plan -> propose -> approve -> execute -> feedback**.

### Registered Agents (October 2026 — slimmed after the agent review)

The nightly scan (`scheduling/scanOrchestrator.ts`, `AGENT_ENABLED=true`) runs **three checks, no AI**, and only notifies the project's PM — once per unread alert (each alert names its plan or project as `linkId`, so `NotificationService` drops a second unread copy):

| Check | Code | What it does |
|---|---|---|
| Delays | `AutoRescheduleService.detectDelays` | Tasks behind where their **working days** say they should be (≥ `AGENT_DELAY_THRESHOLD_DAYS` working days late, or on the critical path). The alert points the PM to AI Reschedule, which proposes new dates when asked — the scan no longer generates an AI proposal every night. |
| Budget | `registryAgentRunners.runBudgetBurnRateAgent` → `EVMForecastService.generateMetricsOnly` | CPI below `AGENT_BUDGET_CPI_THRESHOLD` or negative VAC, from the real spend (labour + expenses). No AI forecast. |
| Schedule risk | `runMonteCarloConfidenceAgent` → `monte-carlo-v1` | P80 finish later than the plan's end, in working days. |

Registered capabilities (`agentCapabilities.ts`, invocable from workflows): `auto-reschedule-v1`, `monte-carlo-v1` and `rag-context-v1` (knowledge search, limited to the calling project's meeting notes).

**Removed (2026-10-04):** schedule-recovery, scope-creep-detection, budget-intelligence, resource-optimization, cross-project-intelligence, risk-escalation, stakeholder-communication, project-hygiene, dependency-risk, lessons-learned, predictive-alerting and meeting-followup — with `ReasoningEngine` and `agents/reasoning/*`. The review found they duplicated Schedule Review, the Team Planner, EVM, status reports, Lessons and the Morning Briefing; their AI replies failed their schemas (free-text JSON, never `completeWithJsonSchema`); their suggested actions couldn't be executed (no assignee / title, unsupported action types); some read columns or tables that don't exist; and the portfolio ones ignored project permissions. Control-plane migrations 128–129 and tenant T077–T078 remove their `agents` rows (and the unused budget-forecast wrapper and the never-built rag-query entry). The nightly scan runs one scan per company at a time (it was one lock for the whole server, so companies scanned in parallel were skipped). The planned replacement is PM **playbooks** run on working features (`docs/playbooks/`).

### Autonomous Execution (Tier 3) — not offered

History: agents with proven track records could be promoted from Tier 2 (propose-only) to Tier 3 (auto-execute):

- **Promotion criteria:** >= 30 days, >= 20 proposals, >= 80% acceptance, >= 70% effectiveness, zero rollbacks
- **Auto-execute gates:** Tier 3 AND confidence >= threshold (default 80) AND risk <= max level (default `low`)
- **Service:** `AutonomyService` (`src/server/services/agents/AutonomyService.ts`)
- **API:** `GET/PUT /api/v1/agent/autonomy/:agentId` — per project only, by that project's Manager/Owner (Oct 2026; company-wide settings are ignored and the UI no longer offers promotion — autonomy is a long-term goal)
- **Table:** `agent_autonomy_config`

### Proposal Lifecycle

```
Agent detects issue
  -> ReasoningEngine calls Claude with structured prompt
  -> ConfidenceCalculator scores result (data quality + historical accuracy + model certainty)
  -> If confidence >= 40%: ActionProposalService creates proposal (status: pending)
  -> User reviews proposal (approve / reject)
  -> If approved: ActionExecutor runs actions in order with rollback on failure
  -> User submits feedback (effective / ineffective / made worse)
  -> Feedback feeds into historical accuracy for future confidence scores
```

### Governance Controls

- **KillSwitchService:** Global/agent/project kill switches saved in the shared table `agent_kill_switch` (migration 133), so the nightly agent run sees them and they survive restarts; if the state can't be read, agents don't run. Project stops are saved per company. Platform admin only. All changes audit-logged. API: `POST /api/v1/agent/kill-switch`, `PUT /api/v1/agent/kill-switch/agent/:agentId`, `PUT /api/v1/agent/kill-switch/project/:projectId`
- **ProposalRateLimiter:** 4-tier rate limiting prevents alert fatigue. Queries `agent_proposals` table (no new tables needed).
- **DegradationHandler:** Circuit breakers open after 3 consecutive failures, retry after 1h then 24h. DB latency check via `SELECT 1`. Recommended scan scope: full/reduced/critical_only/none based on infrastructure health.
- **ConflictResolver:** Expires pending proposals when humans edit targeted entities. Prevents two agents from targeting the same entity in one scan. Batch staleness sweep.

### Agent Health Endpoint

`GET /api/v1/agent/health` returns combined status:
- Claude API availability
- Database health and latency
- Circuit breaker states per agent
- Kill switch state (global + disabled agents/projects)
- Recommended scan scope
- Daily cost tracking
- Pending proposal count

---

## Non-Functional Requirements

- **Graceful degradation:** All AI features check `claudeService.isAvailable()` before calling the API. When unavailable, fallback logic provides non-AI responses or the feature is skipped.
- **Cost control:** Every AI request is logged with token counts and cost estimates. Per-model pricing is tracked automatically. Per-tier monthly token budgets (Free: 25K, Pro: 500K, Business: 1.5M, Consultant: 3M) are enforced before every AI call. Purchasable token top-ups ($10/500K) extend budgets on demand.
- **Latency:** Interactive features target sub-5-second responses. Background agent tasks run asynchronously on cron schedules.
- **Audit trail:** Every AI interaction is logged (who asked, what context, what was returned). Mutating actions go through the policy engine and audit ledger.
- **Schema validation:** All AI outputs are validated against Zod schemas before being returned to clients, preventing malformed or hallucinated data from reaching the UI.
- **Prompt versioning:** All prompts use the `PromptTemplate` class with semantic version numbers.
- **Feature flags:** AI is globally controlled by `AI_ENABLED`; the agent scheduler by `AGENT_ENABLED`; runtime agent control via `KillSwitchService` API (global/per-agent/per-project). Individual features degrade independently.

## AI spend controls (Oct 2026, from the 2026-10-04 audit)

- **The breaker stops on account problems.** `claudeService` reports every failed call to its circuit breaker (`noteError`). Overload, rate limit and timeouts count towards opening it (5 in a row, 1 minute); **no credit or a bad key (400 "credit balance", 401, 403) opens it at once for 10 minutes**, so pages and jobs stop calling Anthropic while it can't answer. Before, those errors were ignored and every action kept trying.
- **Every entry point checks the per-user budget** — `completeWithTools` (Mjuzi chat with tools) was missing it.
- **Background AI has an owner or no AI.** Automation `ai_generate` steps run on the automation owner's budget and plan (`context._aiBillTo`); a basic plan's zero budget stops them. Weekly coaching tips and the Log-time prefill no longer use AI.
- **Repeat visits reuse the answer.** `utils/aiResultCache.ts` `cachedAIResult` keeps an AI-written answer for 30 minutes, keyed inside the company: AI Predictions tab (risks, weather, budget — per project) and the Scenarios page (anomalies, cross-project — per person). Fallback answers aren't kept.
- **Portfolio Intelligence panel** waits 10 minutes after a failed AI ask instead of retrying every minute.
- Tests: `__tests__/services/aiSpend.test.ts`, `claudeService.test.ts`.
