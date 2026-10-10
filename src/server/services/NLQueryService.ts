import Anthropic from '@anthropic-ai/sdk';
import { claudeService } from '../services/claudeService';
import { projectService } from '../services/ProjectService';
import { GLOBAL_READ_ROLES } from '../constants/roles';
import { scheduleService } from '../services/ScheduleService';
import { resourceService } from '../services/ResourceService';
import { criticalPathService } from '../services/CriticalPathService';
import { sCurveService } from '../services/SCurveService';
import { config } from '../config';
import { limitRows, limitGrouped, MAX_TOOL_ROWS, filterTasks, TASK_FILTER_HINT, TASK_FILTER_PROPERTIES } from './aiToolLimits';
import {
  NLQueryAIResponseSchema,
  type NLQueryResult,
  type NLQueryAIResponse,
} from '../schemas/nlQuerySchemas';

// ---------------------------------------------------------------------------
// System prompt for the tool-loop phase (data gathering)
// ---------------------------------------------------------------------------

const TOOL_LOOP_SYSTEM_PROMPT = `You are an expert project management analytics assistant embedded in a PM application.
Your job is to answer the user's natural-language questions about their projects, schedules, resources, budgets, and risks.

IMPORTANT INSTRUCTIONS:
1. **Always use the available tools** to gather real, up-to-date data before answering. Never fabricate numbers.
2. Start broad (e.g. list_projects or aggregate_portfolio_stats) then drill into specifics as needed.
3. If the user mentions a specific project, use get_project_details to fetch its data.
4. For budget/EVM questions, use get_evm_metrics. For schedule risk, use get_critical_path.
5. For resource questions, use get_resource_workload.
6. Provide specific numbers, percentages, and dates drawn from tool results.
7. After gathering all necessary data, write a thorough, well-structured answer in markdown.
8. Suggest relevant charts to visualize the data (bar, line, pie, horizontal_bar).
9. Suggest 2-4 follow-up questions the user might want to ask next.

You have access to READ-ONLY tools. You cannot modify any project data.`;

// ---------------------------------------------------------------------------
// System prompt for the structuring phase (JSON output)
// ---------------------------------------------------------------------------

const STRUCTURING_SYSTEM_PROMPT = `You are a data formatting assistant. You will receive a natural-language answer about project management data.
Your job is to re-format it into a structured JSON object with these fields:

- "answer": The full markdown-formatted answer (preserve all detail, numbers, and formatting).
- "charts": An array of chart specifications. Each chart has:
    - "type": one of "bar", "line", "pie", "horizontal_bar"
    - "title": descriptive chart title
    - "data": array of { "label": string, "value": number, "color"?: string, "group"?: string }
    - "xAxisLabel"?: string
    - "yAxisLabel"?: string
  Only include charts when the data naturally lends itself to visualization. Use an empty array if no chart is appropriate.
- "suggestedFollowUps": An array of 2-4 follow-up question strings.

Return ONLY valid JSON. No markdown fences, no explanation.`;

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic.Tool format)
// ---------------------------------------------------------------------------

function buildToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: 'list_projects',
      description:
        'List all projects in the portfolio with their name, status, priority, budget, and dates. Use this to get an overview or when the user asks about multiple projects.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_project_details',
      description:
        'Get detailed information about a specific project including its schedules and all tasks. Use this when the user asks about a particular project.',
      input_schema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'The project ID to look up',
          },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'list_tasks',
      description:
        'List the tasks of a schedule, including status, progress, dates, and dependencies. Returns at most 200 (with the total); narrow a big plan with nameContains, status or assignedTo.',
      input_schema: {
        type: 'object' as const,
        properties: {
          scheduleId: {
            type: 'string',
            description: 'The schedule ID whose tasks to list',
          },
          ...TASK_FILTER_PROPERTIES,
        },
        required: ['scheduleId'],
      },
    },
    {
      name: 'get_resource_workload',
      description:
        'Get resource workload and utilization data for a project, including weekly allocations and over-allocation flags.',
      input_schema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'The project ID to compute workload for',
          },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'get_evm_metrics',
      description:
        'Get Earned Value Management (EVM) metrics for a project: S-curve data points (PV, EV, AC over time) plus computed CPI, SPI, and EAC. Use for budget and schedule performance questions.',
      input_schema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'The project ID to compute EVM metrics for',
          },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'get_critical_path',
      description:
        'Calculate the critical path for a schedule using CPM. Returns critical tasks, float values, and total project duration in days.',
      input_schema: {
        type: 'object' as const,
        properties: {
          scheduleId: {
            type: 'string',
            description: 'The schedule ID to analyse',
          },
        },
        required: ['scheduleId'],
      },
    },
    {
      name: 'aggregate_portfolio_stats',
      description:
        'Aggregate high-level portfolio statistics: total projects, total budget allocated & spent, status breakdown, priority breakdown, and project type breakdown. Use for portfolio-level or dashboard-level questions.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool execution dispatcher
// ---------------------------------------------------------------------------

/** Who is asking: answers only use projects they can open (admin/PMO/executive: all) */
export interface NLQueryUser { userId: string; role: string }

/** The tool runner for one person — every tool is limited to the projects they can read */
function toolsFor(user: NLQueryUser) {
  let accessible: Promise<Set<string> | 'all'> | null = null;
  const allowed = () => (accessible ??= (async () => GLOBAL_READ_ROLES.includes(user.role)
    ? 'all' as const
    : new Set((await projectService.findByUserId(user.userId)).map((p) => p.id)))());
  const canRead = async (projectId?: string | null) => {
    const a = await allowed();
    return !!projectId && (a === 'all' || a.has(projectId));
  };
  const scheduleProject = async (scheduleId?: string) =>
    scheduleId ? (await scheduleService.findById(scheduleId))?.projectId ?? null : null;
  const notFound = (what: string) => JSON.stringify({ error: `${what} not found among the projects you can see` });

  return async (toolName: string, toolInput: Record<string, any>): Promise<string> => {
    if ((await allowed()) === 'all') return executeToolFn(toolName, toolInput, user, allowed);
    if (['get_project_details', 'get_resource_workload', 'get_evm_metrics'].includes(toolName)
      && !(await canRead(toolInput.projectId))) return notFound(`Project ${toolInput.projectId}`);
    if (['list_tasks', 'get_critical_path'].includes(toolName)
      && !(await canRead(await scheduleProject(toolInput.scheduleId)))) return notFound(`Schedule ${toolInput.scheduleId}`);
    return executeToolFn(toolName, toolInput, user, allowed);
  };
}

async function executeToolFn(
  toolName: string,
  toolInput: Record<string, any>,
  user: NLQueryUser,
  allowed: () => Promise<Set<string> | 'all'>,
): Promise<string> {
  switch (toolName) {
    // ----- list_projects -----
    case 'list_projects': {
      const projects = (await allowed()) === 'all' ? await projectService.findAll() : await projectService.findByUserId(user.userId);
      const summary = projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        priority: p.priority,
        projectType: p.projectType,
        budgetAllocated: p.budgetAllocated,
        budgetSpent: p.budgetSpent,
        currency: p.currency,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
      }));
      const limited = limitRows(summary);
      return JSON.stringify({ projects: limited.rows, total: limited.total, note: limited.note });
    }

    // ----- get_project_details -----
    case 'get_project_details': {
      const projectId = toolInput.projectId as string;
      const project = await projectService.findById(projectId);
      if (!project) return JSON.stringify({ error: `Project ${projectId} not found` });

      const schedules = await scheduleService.findByProjectId(projectId);
      const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
      const tasksBySchedule = new Map<string, typeof allTasks>();
      for (const t of allTasks) {
        const list = tasksBySchedule.get(t.scheduleId) ?? [];
        list.push(t);
        tasksBySchedule.set(t.scheduleId, list);
      }
      // At most MAX_TOOL_ROWS tasks across all plans; each plan gives its task count
      const shownPerPlan = limitGrouped(schedules.map((sch) => tasksBySchedule.get(sch.id) ?? []));
      const schedulesWithTasks = schedules.map((sch, i) => {
        const own = tasksBySchedule.get(sch.id) ?? [];
        const shown = shownPerPlan[i];
        return {
          id: sch.id,
          name: sch.name,
          status: sch.status,
          startDate: sch.startDate ?? null,
          endDate: sch.endDate ?? null,
          taskCount: own.length,
          tasks: shown.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            priority: t.priority,
            progressPercentage: t.progressPercentage ?? 0,
            startDate: t.startDate ?? null,
            endDate: t.endDate ?? null,
            dependency: t.dependency ?? null,
            dependencies: t.dependencies.map(d => ({ id: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
            assignedTo: t.assignedTo ?? null,
          })),
        };
      });

      return JSON.stringify(
        {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          priority: project.priority,
          projectType: project.projectType,
          budgetAllocated: project.budgetAllocated,
          budgetSpent: project.budgetSpent,
          currency: project.currency,
          location: project.location,
          startDate: project.startDate ?? null,
          endDate: project.endDate ?? null,
          schedules: schedulesWithTasks,
          note: allTasks.length > MAX_TOOL_ROWS
            ? `Showing ${MAX_TOOL_ROWS} of ${allTasks.length} tasks. Use list_tasks on one plan for its tasks.`
            : undefined,
        });
    }

    // ----- list_tasks -----
    case 'list_tasks': {
      const scheduleId = toolInput.scheduleId as string;
      // Filters first, then the row limit: any task can be reached however big the plan
      const tasks = await filterTasks(await scheduleService.findTasksByScheduleId(scheduleId), toolInput);
      const summary = tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        progressPercentage: t.progressPercentage ?? 0,
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
        dependency: t.dependency ?? null,
        dependencies: t.dependencies.map(d => ({ id: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
        parentTaskId: t.parentTaskId ?? null,
        assignedTo: t.assignedTo ?? null,
      }));
      const limited = limitRows(summary, MAX_TOOL_ROWS, TASK_FILTER_HINT);
      return JSON.stringify({ tasks: limited.rows, total: limited.total, note: limited.note });
    }

    // ----- get_resource_workload -----
    case 'get_resource_workload': {
      const projectId = toolInput.projectId as string;
      const workloads = await resourceService.computeWorkload(projectId);
      return JSON.stringify(workloads);
    }

    // ----- get_evm_metrics -----
    case 'get_evm_metrics': {
      const projectId = toolInput.projectId as string;
      const sCurveData = await sCurveService.computeSCurveData(projectId);

      // Compute CPI, SPI, EAC from the latest data point at or before today
      const now = new Date();
      const currentPoint = [...sCurveData]
        .reverse()
        .find((dp) => new Date(dp.date) <= now) ?? sCurveData[sCurveData.length - 1];

      let cpi: number | null = null;
      let spi: number | null = null;
      let eac: number | null = null;

      if (currentPoint) {
        cpi = currentPoint.ac > 0 ? +(currentPoint.ev / currentPoint.ac).toFixed(3) : null;
        spi = currentPoint.pv > 0 ? +(currentPoint.ev / currentPoint.pv).toFixed(3) : null;

        const project = await projectService.findById(projectId);
        const bac = project?.budgetAllocated ?? 0;
        eac = cpi && cpi > 0 ? Math.round(bac / cpi) : null;
      }

      return JSON.stringify(
        {
          sCurveData,
          currentMetrics: currentPoint
            ? {
                date: currentPoint.date,
                pv: currentPoint.pv,
                ev: currentPoint.ev,
                ac: currentPoint.ac,
                cpi,
                spi,
                eac,
              }
            : null,
        });
    }

    // ----- get_critical_path -----
    case 'get_critical_path': {
      const scheduleId = toolInput.scheduleId as string;
      const result = await criticalPathService.calculateCriticalPath(scheduleId);
      return JSON.stringify(result);
    }

    // ----- aggregate_portfolio_stats -----
    case 'aggregate_portfolio_stats': {
      const listed = (await allowed()) === 'all' ? await projectService.findAll() : await projectService.findByUserId(user.userId);
      // The sample project never counts in portfolio totals (it stays in list_projects)
      const projects = listed.filter((p) => !p.isDemo && !p.archivedAt); // archived projects don't count either
      const sampleIds = listed.filter((p) => p.isDemo).map((p) => p.id);
      const sampleSchedules = new Set(sampleIds.length ? (await scheduleService.findByProjectIds(sampleIds)).map((sch) => sch.id) : []);
      const allTasks = ((await allowed()) === 'all'
        ? await scheduleService.findAllTasks()
        : await scheduleService.findTasksByScheduleIds(
          (await scheduleService.findByProjectIds(projects.map((p) => p.id))).map((sch) => sch.id)))
        .filter((t) => !sampleSchedules.has(t.scheduleId));

      const totalBudgetAllocated = projects.reduce((s, p) => s + (p.budgetAllocated ?? 0), 0);
      const totalBudgetSpent = projects.reduce((s, p) => s + (p.budgetSpent ?? 0), 0);

      const statusBreakdown: Record<string, number> = {};
      const priorityBreakdown: Record<string, number> = {};
      const typeBreakdown: Record<string, number> = {};

      for (const p of projects) {
        statusBreakdown[p.status] = (statusBreakdown[p.status] ?? 0) + 1;
        priorityBreakdown[p.priority] = (priorityBreakdown[p.priority] ?? 0) + 1;
        typeBreakdown[p.projectType] = (typeBreakdown[p.projectType] ?? 0) + 1;
      }

      const taskStatusBreakdown: Record<string, number> = {};
      for (const t of allTasks) {
        taskStatusBreakdown[t.status] = (taskStatusBreakdown[t.status] ?? 0) + 1;
      }

      const totalProgress =
        allTasks.length > 0
          ? Math.round(
              allTasks.reduce((s, t) => s + (t.progressPercentage ?? 0), 0) / allTasks.length,
            )
          : 0;

      return JSON.stringify(
        {
          totalProjects: projects.length,
          totalTasks: allTasks.length,
          totalBudgetAllocated,
          totalBudgetSpent,
          budgetUtilization:
            totalBudgetAllocated > 0
              ? +((totalBudgetSpent / totalBudgetAllocated) * 100).toFixed(1)
              : 0,
          projectStatusBreakdown: statusBreakdown,
          projectPriorityBreakdown: priorityBreakdown,
          projectTypeBreakdown: typeBreakdown,
          taskStatusBreakdown,
          averageTaskProgress: totalProgress,
        });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ---------------------------------------------------------------------------
// NLQueryService
// ---------------------------------------------------------------------------

export class NLQueryService {
  /**
   * Process a natural-language query about project data.
   *
   * 1. Runs a tool loop so the AI can gather real data via read-only tools.
   * 2. Structures the AI's free-text answer into JSON with chart specs.
   * 3. Returns a typed NLQueryResult.
   */
  async processQuery(
    query: string,
    context: { projectId?: string } | undefined,
    user: NLQueryUser,
  ): Promise<NLQueryResult> {
    if (!config.AI_ENABLED) {
      throw new Error(
        'AI features are disabled. Enable AI_ENABLED and set ANTHROPIC_API_KEY to use natural language queries.',
      );
    }

    if (!claudeService.isAvailable()) {
      throw new Error(
        'AI service is unavailable. Ensure ANTHROPIC_API_KEY is configured correctly.',
      );
    }

    // Build contextual user message
    let userMessage = query;
    if (context?.projectId) {
      userMessage += `\n\n[Context: The user is currently viewing project ID "${context.projectId}". Prioritise data from this project.]`;
    }

    const tools = buildToolDefinitions();

    // ------------------------------------------------------------------
    // Phase 1: Tool loop — let the AI call tools to gather data
    // ------------------------------------------------------------------
    const toolLoopResult = await claudeService.completeToolLoop({
      systemPrompt: TOOL_LOOP_SYSTEM_PROMPT,
      userMessage,
      tools,
      executeToolFn: toolsFor(user),
      maxIterations: 6,
      temperature: 0.2,
    });

    // Collect which data sources (tools) were used
    const dataSources = Array.from(
      new Set(toolLoopResult.toolResults.map((tr) => tr.toolName)),
    );

    // ------------------------------------------------------------------
    // Phase 2: Structure the free-text answer into JSON with charts
    // ------------------------------------------------------------------
    const structuredResult = await claudeService.completeWithJsonSchema<NLQueryAIResponse>({
      systemPrompt: STRUCTURING_SYSTEM_PROMPT,
      userMessage: `Here is the raw answer to structure:\n\n${toolLoopResult.finalText}`,
      schema: NLQueryAIResponseSchema,
      maxTokens: 4096,
      temperature: 0.1,
    });

    // Compute a simple confidence heuristic based on tools used
    const confidence = this.computeConfidence(dataSources, toolLoopResult.finalText);

    return {
      answer: structuredResult.data.answer,
      charts: structuredResult.data.charts,
      dataSources,
      confidence,
      suggestedFollowUps: structuredResult.data.suggestedFollowUps,
    };
  }

  /**
   * Heuristic confidence score (0-100) based on how much data was gathered.
   */
  private computeConfidence(dataSources: string[], answerText: string): number {
    let score = 40; // baseline

    // More tools used → higher confidence
    score += Math.min(dataSources.length * 10, 30);

    // Longer, more detailed answers tend to be better grounded
    if (answerText.length > 500) score += 10;
    if (answerText.length > 1500) score += 10;

    // If specific numbers appear in the answer, it's more data-driven
    const numberMatches = answerText.match(/\d+[\d,.]*%?/g);
    if (numberMatches && numberMatches.length >= 3) score += 10;

    return Math.min(score, 100);
  }
}
