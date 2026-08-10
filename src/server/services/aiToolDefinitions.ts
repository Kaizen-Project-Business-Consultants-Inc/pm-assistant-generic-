// C:\Users\gerog\Documents\pm-assistant-generic\src\server\services\aiToolDefinitions.ts

import Anthropic from '@anthropic-ai/sdk';

// Claude tool definitions for AI action execution
// These define what the AI can do in the PM system

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task in a project schedule. Use this when the user asks you to add a task, create a to-do, or add work items to a project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scheduleId: { type: 'string', description: 'The schedule ID to add the task to. If unknown, use the first schedule of the project.' },
        name: { type: 'string', description: 'Clear, concise task name' },
        description: { type: 'string', description: 'Detailed task description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Task priority level' },
        assignedTo: { type: 'string', description: 'User ID or username to assign the task to' },
        dueDate: { type: 'string', description: 'Due date in ISO format (YYYY-MM-DD)' },
        estimatedDays: { type: 'number', description: 'Estimated duration in working days' },
        parentTaskId: { type: 'string', description: 'Parent task ID if this is a subtask' },
      },
      required: ['scheduleId', 'name'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task. Use this to change task status, priority, assignee, dates, or progress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to update' },
        name: { type: 'string', description: 'New task name' },
        description: { type: 'string', description: 'New task description' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'New status' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'New priority' },
        assignedTo: { type: 'string', description: 'New assignee (user ID or username)' },
        dueDate: { type: 'string', description: 'New due date in ISO format' },
        progressPercentage: { type: 'number', description: 'Progress percentage (0-100)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task from a schedule. Use this when asked to remove a task. This action cannot be undone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to delete' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project with optional schedule and initial tasks. Use this when the user wants to start a new project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Project description' },
        projectType: { type: 'string', enum: ['it', 'construction', 'infrastructure', 'roads', 'other'], description: 'Type of project' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Project priority' },
        budgetAllocated: { type: 'number', description: 'Budget in USD' },
        startDate: { type: 'string', description: 'Start date in ISO format' },
        endDate: { type: 'string', description: 'End date in ISO format' },
        location: { type: 'string', description: 'Project location' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_project',
    description: 'Update an existing project. Use this to change project status, priority, budget, dates, or description.',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The ID of the project to update' },
        name: { type: 'string', description: 'New project name' },
        description: { type: 'string', description: 'New project description' },
        status: { type: 'string', enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], description: 'New status' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'New priority' },
        budgetAllocated: { type: 'number', description: 'New budget amount' },
        budgetSpent: { type: 'number', description: 'Budget spent amount' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Reschedule a task by changing its start date, end date, or due date. Use when asked to push back, bring forward, or adjust task timing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to reschedule' },
        startDate: { type: 'string', description: 'New start date in ISO format' },
        endDate: { type: 'string', description: 'New end date in ISO format' },
        dueDate: { type: 'string', description: 'New due date in ISO format' },
        reason: { type: 'string', description: 'Reason for rescheduling' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'list_projects',
    description: 'List all projects to get their IDs and current status. Use this to find project IDs when the user refers to projects by name.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_details',
    description: 'Get detailed information about a specific project including its schedules and tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID to get details for' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks in a project schedule. Use this to find task IDs when the user refers to tasks by name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scheduleId: { type: 'string', description: 'The schedule ID to list tasks for' },
      },
      required: ['scheduleId'],
    },
  },
  {
    name: 'cascade_reschedule',
    description: 'Reschedule a task AND automatically shift all downstream dependent tasks by the same delta. Use this instead of reschedule_task when a delay should ripple through the schedule. For example, if Phase 2 slips by 2 weeks, Phase 3 and Phase 4 automatically shift forward by 2 weeks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to reschedule' },
        newStartDate: { type: 'string', description: 'New start date in ISO format (YYYY-MM-DD)' },
        newEndDate: { type: 'string', description: 'New end date in ISO format (YYYY-MM-DD)' },
        reason: { type: 'string', description: 'Reason for rescheduling' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'set_dependency',
    description: 'Set or update the dependency relationship between two tasks. The dependent task (taskId) cannot start until the predecessor (predecessorId) completes (Finish-to-Start by default). Use this when adding a new task to wire it into the schedule, or to adjust the dependency chain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The task that depends on the predecessor' },
        predecessorId: { type: 'string', description: 'The predecessor task that must complete first' },
        dependencyType: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'], description: 'Dependency type: Finish-to-Start (default), Start-to-Start, Finish-to-Finish, Start-to-Finish' },
      },
      required: ['taskId', 'predecessorId'],
    },
  },
  {
    name: 'remove_dependency',
    description: 'Remove a single dependency between two tasks. The dependent task (taskId) will no longer depend on the predecessor (predecessorId).',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The task to remove the dependency from' },
        predecessorId: { type: 'string', description: 'The predecessor task to unlink' },
      },
      required: ['taskId', 'predecessorId'],
    },
  },
  {
    name: 'clear_all_dependencies',
    description: 'Remove ALL dependencies in a schedule. This is a bulk operation — every predecessor-successor link in the schedule will be deleted. Use this when the user wants to start fresh with dependency planning.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scheduleId: { type: 'string', description: 'The schedule to clear all dependencies from' },
      },
      required: ['scheduleId'],
    },
  },
  {
    name: 'get_dependency_chain',
    description: 'Show the full dependency chain for a task — both what it depends on (upstream) and what depends on it (downstream). Use this to understand impact before rescheduling.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The task ID to analyze' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_projects_due_today',
    description: 'Get all projects whose end date is today. Use when asked "what is due today?", "what projects end today?", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_overdue_projects',
    description: 'Get all projects that are past their end date and not yet completed or cancelled. Use for questions like "what projects are overdue?" or "what is behind schedule?"',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_projects_by_status',
    description: 'Get all projects filtered by a specific status. Use when asked to list active, planning, on-hold, completed, or cancelled projects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
          description: 'The project status to filter by',
        },
      },
      required: ['status'],
    },
  },
  {
    name: 'get_overdue_tasks',
    description: 'Get all tasks across all projects that are past their due date and not yet completed. Use for questions like "what tasks are overdue?" or "what is past due?"',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_high_risk_projects',
    description: 'Get projects that are at high risk: overdue, on hold, or near/over budget. Use for questions like "what projects are at risk?", "summarize high-risk projects", or "what needs attention?"',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Get a high-level summary of the entire project portfolio: counts by status, budget totals, overdue counts. Use for broad questions like "how is the portfolio doing?" or "give me an overview."',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// Tool categories for permission checking
export const DESTRUCTIVE_TOOLS = ['delete_task', 'clear_all_dependencies'];
export const MUTATING_TOOLS = ['create_task', 'update_task', 'delete_task', 'create_project', 'update_project', 'reschedule_task', 'cascade_reschedule', 'set_dependency', 'remove_dependency', 'clear_all_dependencies'];
export const READ_ONLY_TOOLS = ['list_projects', 'get_project_details', 'list_tasks', 'get_dependency_chain', 'get_projects_due_today', 'get_overdue_projects', 'get_projects_by_status', 'get_overdue_tasks', 'get_high_risk_projects', 'get_portfolio_summary'];
