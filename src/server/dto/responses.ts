/**
 * API Response DTOs
 *
 * These types define the public API contract. Service interfaces may have
 * additional fields (createdBy, internal IDs, etc.) that should not leak
 * to clients. Use `toProjectDTO()` etc. to shape responses.
 *
 * The preSerialization hook converts snake_case DB fields to camelCase,
 * so all fields here use camelCase.
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ProjectDTO {
  id: string;
  name: string;
  description?: string;
  category?: string;
  projectType: string;
  methodology: string;
  status: string;
  priority: string;
  budgetAllocated?: number;
  budgetSpent: number;
  currency: string;
  location?: string;
  locationLat?: number;
  locationLon?: number;
  startDate?: string;
  endDate?: string;
  projectManagerId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  isDemo?: boolean;
}

export function toProjectDTO(row: Record<string, any>): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    projectType: row.projectType ?? row.project_type,
    methodology: row.methodology ?? 'waterfall',
    status: row.status,
    priority: row.priority,
    budgetAllocated: row.budgetAllocated ?? row.budget_allocated ?? undefined,
    budgetSpent: row.budgetSpent ?? row.budget_spent ?? 0,
    currency: row.currency ?? 'USD',
    location: row.location ?? undefined,
    locationLat: row.locationLat ?? row.location_lat ?? undefined,
    locationLon: row.locationLon ?? row.location_lon ?? undefined,
    startDate: row.startDate ?? row.start_date ?? undefined,
    endDate: row.endDate ?? row.end_date ?? undefined,
    projectManagerId: row.projectManagerId ?? row.project_manager_id ?? undefined,
    createdBy: row.createdBy ?? row.created_by,
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at),
    archivedAt: row.archivedAt ?? row.archived_at ?? undefined,
    isDemo: row.isDemo ?? row.is_demo ?? false,
  };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface ScheduleDTO {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function toScheduleDTO(row: Record<string, any>): ScheduleDTO {
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    startDate: String(row.startDate ?? row.start_date),
    endDate: String(row.endDate ?? row.end_date),
    status: row.status,
    createdBy: row.createdBy ?? row.created_by,
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface TaskDTO {
  id: string;
  scheduleId: string;
  name: string;
  description?: string;
  status: string;
  priority: string;
  assignedTo?: string;
  dueDate?: string;
  startDate?: string;
  endDate?: string;
  estimatedDays?: number;
  estimatedDurationHours?: number;
  actualDurationHours?: number;
  progressPercentage?: number;
  dependency?: string;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export function toTaskDTO(row: Record<string, any>): TaskDTO {
  return {
    id: row.id,
    scheduleId: row.scheduleId ?? row.schedule_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assignedTo ?? row.assigned_to ?? undefined,
    dueDate: row.dueDate ?? row.due_date ?? undefined,
    startDate: row.startDate ?? row.start_date ?? undefined,
    endDate: row.endDate ?? row.end_date ?? undefined,
    estimatedDays: row.estimatedDays ?? row.estimated_days ?? undefined,
    estimatedDurationHours: row.estimatedDurationHours ?? row.estimated_duration_hours ?? undefined,
    actualDurationHours: row.actualDurationHours ?? row.actual_duration_hours ?? undefined,
    progressPercentage: row.progressPercentage ?? row.progress_percentage ?? undefined,
    dependency: row.dependency ?? undefined,
    parentTaskId: row.parentTaskId ?? row.parent_task_id ?? undefined,
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Resource
// ---------------------------------------------------------------------------

export interface ResourceDTO {
  id: string;
  name: string;
  role: string;
  email: string;
  capacityHoursPerWeek: number;
  skills: string[];
  isActive: boolean;
}

export function toResourceDTO(row: Record<string, any>): ResourceDTO {
  let skills = row.skills ?? [];
  if (typeof skills === 'string') {
    try { skills = JSON.parse(skills); } catch { skills = []; }
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    capacityHoursPerWeek: row.capacityHoursPerWeek ?? row.capacity_hours_per_week ?? 40,
    skills,
    isActive: row.isActive ?? row.is_active ?? true,
  };
}

// ---------------------------------------------------------------------------
// User (public-safe, no password hash)
// ---------------------------------------------------------------------------

export interface UserDTO {
  id: string;
  username: string;
  email: string;
  role: string;
  subscriptionTier: string;
  emailVerified: boolean;
  createdAt: string;
}

export function toUserDTO(row: Record<string, any>): UserDTO {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    subscriptionTier: row.subscriptionTier ?? row.subscription_tier ?? 'trial',
    emailVerified: row.emailVerified ?? row.email_verified ?? false,
    createdAt: String(row.createdAt ?? row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Paginated wrapper
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(data: T[], total: number, page: number, pageSize: number): PaginatedResponse<T> {
  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
