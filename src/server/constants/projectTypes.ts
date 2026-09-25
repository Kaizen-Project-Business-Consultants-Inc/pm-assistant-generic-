/**
 * Project types — the single list the server validates against. Must match the
 * `projects.project_type` ENUM (tenant migrations T001 + T055) and the client's
 * src/client/src/constants/projectTypes.ts. mcp-server/src/tools/projects.ts keeps its own
 * copy (separate package) — update it too.
 */
export const PROJECT_TYPES = [
  'it',
  'web_design',
  'web_application',
  'app_development',
  'construction',
  'infrastructure',
  'roads',
  'other',
] as const;

export type ProjectType = typeof PROJECT_TYPES[number];
