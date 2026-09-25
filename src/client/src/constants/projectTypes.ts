/**
 * Project types shown in forms and tables. Must match src/server/constants/projectTypes.ts
 * (and the projects.project_type database ENUM).
 */
export const PROJECT_TYPE_OPTIONS = [
  { value: 'it', label: 'IT / Software' },
  { value: 'web_design', label: 'Web Design' },
  { value: 'web_application', label: 'Web Application' },
  { value: 'app_development', label: 'App Development' },
  { value: 'construction', label: 'Construction' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'roads', label: 'Roads' },
  { value: 'other', label: 'Other' },
] as const;

export const PROJECT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_TYPE_OPTIONS.map(o => [o.value, o.label]),
);
