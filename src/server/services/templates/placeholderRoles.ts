/**
 * Placeholder roles per template (UAT U13, 2026-10-15). Template tasks name a skill; the skill
 * names the role that does the work. Creating a project from a template adds a generic resource
 * ("Generic Structural Engineer") for each role the company doesn't have yet and points the
 * tasks at it, so the plan's workload shows from day one (and its cost, once the rate card has a rate for the role); the PM swaps in real people later.
 *
 * The six generic roles every company already has (T069) keep their names here — Project
 * Manager, Business Analyst, Designer, Architect, Developer, QA / Tester — so they are reused,
 * not duplicated. builtInTemplatesReview.test.ts fails when a built-in template uses a skill
 * missing from this list (a new template can't leave its tasks unstaffed by accident).
 */
export const SKILL_ROLE: Record<string, string> = {
  // the six every company has
  'project-management': 'Project Manager',
  'business-analysis': 'Business Analyst',
  'analysis': 'Business Analyst',
  'design': 'Designer',
  'ui-design': 'Designer',
  'ux-design': 'Designer',
  'architecture': 'Architect',
  'frontend': 'Developer',
  'fullstack': 'Developer',
  'web-development': 'Developer',
  'integration': 'Developer',
  'testing': 'QA / Tester',
  'quality-control': 'QA / Tester',
  'performance': 'QA / Tester',
  // IT
  'backend': 'Backend Developer',
  'mobile-development': 'Mobile Developer',
  'product-management': 'Product Owner',
  'devops': 'DevOps Engineer',
  'containers': 'DevOps Engineer',
  'monitoring': 'DevOps Engineer',
  'cloud': 'Cloud Engineer',
  'cloud-administration': 'Cloud Engineer',
  'cloud-architecture': 'Cloud Engineer',
  'cloud-security': 'Security Engineer',
  'security': 'Security Engineer',
  'security-architecture': 'Security Engineer',
  'security-engineering': 'Security Engineer',
  'network-security': 'Security Engineer',
  'penetration-testing': 'Security Tester',
  'security-audit': 'Compliance Specialist',
  'security-governance': 'Compliance Specialist',
  'compliance': 'Compliance Specialist',
  'privacy': 'Compliance Specialist',
  'risk-management': 'Compliance Specialist',
  'business-continuity': 'Compliance Specialist',
  'networking': 'Network Engineer',
  'network-architecture': 'Network Engineer',
  'network-engineering': 'Network Engineer',
  'infrastructure': 'Systems Administrator',
  'it-infrastructure': 'Systems Administrator',
  'systems-administration': 'Systems Administrator',
  'endpoint-management': 'Systems Administrator',
  'database': 'Database Administrator',
  'data-migration': 'Data Migration Specialist',
  'data-quality': 'Data Migration Specialist',
  'data-engineering': 'Data Engineer',
  'data-modeling': 'Data Engineer',
  'data-analysis': 'Data / BI Analyst',
  'data-visualization': 'Data / BI Analyst',
  'analytics': 'Data / BI Analyst',
  'ai-engineering': 'AI Engineer',
  'conversation-design': 'AI Engineer',
  'erp-consulting': 'ERP Consultant',
  'erp-config': 'ERP Consultant',
  'configuration': 'ERP Consultant',
  'erp-development': 'ERP Developer',
  'erp-admin': 'ERP Administrator',
  'crm-consulting': 'CRM Administrator',
  'crm-admin': 'CRM Administrator',
  'training': 'Trainer',
  'instructional-design': 'Trainer',
  'e-learning': 'Trainer',
  'technical-writing': 'Trainer',
  'change-management': 'Change Manager',
  'communications': 'Change Manager',
  'support': 'Support / Operations',
  'it-support': 'Support / Operations',
  // marketing and launch
  'marketing': 'Marketing Strategist',
  'marketing-strategy': 'Marketing Strategist',
  'market-research': 'Marketing Strategist',
  'messaging': 'Marketing Strategist',
  'sales-enablement': 'Marketing Strategist',
  'copywriting': 'Copywriter',
  'content': 'Copywriter',
  'content-marketing': 'Copywriter',
  'graphic-design': 'Graphic Designer',
  'digital-marketing': 'Digital Marketer',
  'media-planning': 'Digital Marketer',
  'web-analytics': 'Digital Marketer',
  // construction
  'structural-engineering': 'Structural Engineer',
  'structural-steel': 'Structural Engineer',
  'structural-testing': 'Structural Engineer',
  'surveying': 'Surveyor',
  'concrete': 'Construction Trades',
  'carpentry': 'Construction Trades',
  'roofing': 'Construction Trades',
  'siding': 'Construction Trades',
  'glazing': 'Construction Trades',
  'curtain-wall': 'Construction Trades',
  'finishing': 'Construction Trades',
  'earthwork': 'Construction Trades',
  'pile-driving': 'Construction Trades',
  'marine-construction': 'Construction Trades',
  'heavy-equipment': 'Construction Trades',
  'paving': 'Paving Crew',
  'drainage': 'Civil Engineer',
  'civil-engineering': 'Civil Engineer',
  'utilities': 'Civil Engineer',
  'geotechnical': 'Geotechnical Engineer',
  'environmental': 'Environmental Specialist',
  'traffic-engineering': 'Traffic Engineer',
  'mep': 'Electrician',
  'electrical': 'Electrician',
  'safety': 'Safety Officer',
  'regulatory': 'Permits & Legal Officer',
  'legal': 'Permits & Legal Officer',
  'land-acquisition': 'Permits & Legal Officer',
  'site-acquisition': 'Permits & Legal Officer',
  'real-estate': 'Facilities Manager',
  'interior-design': 'Designer',
  // telecom
  'rf-engineering': 'RF Engineer',
  'rf-testing': 'RF Engineer',
  'fiber-optics': 'Fibre Technician',
  'cabling': 'Fibre Technician',
  'telecom-equipment': 'Telecom Technician',
  'tower-construction': 'Telecom Technician',
  'commissioning': 'Commissioning Engineer',
  // office moves and operations
  'facilities': 'Facilities Manager',
  'procurement': 'Procurement Officer',
  'logistics': 'Logistics Coordinator',
};

/** The role a task needs: from its first skill that names one; none for a task with no skill */
export function roleForSkills(skills: readonly string[] | undefined): string | null {
  for (const s of skills ?? []) {
    const role = SKILL_ROLE[s];
    if (role) return role;
  }
  return null;
}

/** The work tasks that need a person: summaries and milestones hold no work */
interface RoleTask { skills?: readonly string[]; isSummary?: boolean; isMilestone?: boolean }
export const isWorkTask = (t: RoleTask) => !t.isSummary && !t.isMilestone;
