import { ProjectTemplate, TemplateTask, CreateFromTemplate, SaveAsTemplate } from '../schemas/templateSchemas';
import { projectService } from './ProjectService';
import { scheduleService } from './ScheduleService';

// ─── Built-in Templates ──────────────────────────────────────────────────────

const webAppTemplate: ProjectTemplate = {
  id: 'tpl-it-webapp',
  name: 'Web Application Development',
  description: 'Full-stack web application with frontend, backend API, database, testing, and deployment phases.',
  projectType: 'it',
  category: 'web_development',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 90,
  tags: ['web', 'fullstack', 'agile'],
  usageCount: 0,
  defaultMethodology: 'agile',
  tasks: [
    { refId: 'plan', name: 'Planning & Requirements', description: 'Gather requirements and plan architecture', estimatedDays: 10, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: true, mandatory: true },
    { refId: 'plan-req', name: 'Requirements Gathering', description: 'Stakeholder interviews and requirement docs', estimatedDays: 5, priority: 'high', parentRefId: 'plan', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'plan-arch', name: 'Architecture Design', description: 'System architecture and tech stack decisions', estimatedDays: 5, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-req', dependencyType: 'FS', offsetDays: 0, skills: ['architecture'], isSummary: false, mandatory: true },
    { refId: 'dev', name: 'Development', description: 'Core development phase', estimatedDays: 50, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'dev-db', name: 'Database Design & Setup', description: 'Schema design, migrations, seed data', estimatedDays: 8, priority: 'high', parentRefId: 'dev', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['database'], isSummary: false },
    { refId: 'dev-api', name: 'Backend API Development', description: 'REST/GraphQL API endpoints', estimatedDays: 20, priority: 'high', parentRefId: 'dev', dependencyRefId: 'dev-db', dependencyType: 'FS', offsetDays: 0, skills: ['backend'], isSummary: false },
    { refId: 'dev-ui', name: 'Frontend Development', description: 'UI components and pages', estimatedDays: 20, priority: 'high', parentRefId: 'dev', dependencyRefId: 'dev-db', dependencyType: 'SS', offsetDays: 5, skills: ['frontend'], isSummary: false },
    { refId: 'dev-int', name: 'Integration & API Wiring', description: 'Connect frontend to backend', estimatedDays: 7, priority: 'medium', parentRefId: 'dev', dependencyRefId: 'dev-api', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 'test', name: 'Testing & QA', description: 'Testing phase', estimatedDays: 15, priority: 'high', parentRefId: null, dependencyRefId: 'dev', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'test-unit', name: 'Unit & Integration Testing', description: 'Automated test suites', estimatedDays: 7, priority: 'high', parentRefId: 'test', dependencyRefId: 'dev', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false },
    { refId: 'test-uat', name: 'User Acceptance Testing', description: 'UAT with stakeholders', estimatedDays: 5, priority: 'high', parentRefId: 'test', dependencyRefId: 'test-unit', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false },
    { refId: 'test-fix', name: 'Bug Fixes & Polish', description: 'Fix issues found in testing', estimatedDays: 5, priority: 'medium', parentRefId: 'test', dependencyRefId: 'test-uat', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 'deploy', name: 'Deployment & Launch', description: 'Production deployment', estimatedDays: 10, priority: 'urgent', parentRefId: null, dependencyRefId: 'test', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'deploy-infra', name: 'Infrastructure Setup', description: 'Cloud infra, CI/CD pipelines', estimatedDays: 5, priority: 'high', parentRefId: 'deploy', dependencyRefId: 'test', dependencyType: 'FS', offsetDays: 0, skills: ['devops'], isSummary: false },
    { refId: 'deploy-launch', name: 'Go-Live & Monitoring', description: 'Deploy to production and set up monitoring', estimatedDays: 5, priority: 'urgent', parentRefId: 'deploy', dependencyRefId: 'deploy-infra', dependencyType: 'FS', offsetDays: 0, skills: ['devops'], isSummary: false, mandatory: true },
  ],
};

const cloudMigrationTemplate: ProjectTemplate = {
  id: 'tpl-it-cloud',
  name: 'Cloud Migration',
  description: 'Migrate on-premise infrastructure to cloud (AWS/Azure/GCP) with assessment, migration, and optimization phases.',
  projectType: 'it',
  category: 'cloud_migration',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 120,
  tags: ['cloud', 'aws', 'migration', 'infrastructure'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'assess', name: 'Assessment & Planning', description: 'Audit infrastructure and plan migration', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['cloud-architecture'], isSummary: true, mandatory: true },
    { refId: 'assess-audit', name: 'Infrastructure Audit', description: 'Inventory servers, databases, services', estimatedDays: 10, priority: 'high', parentRefId: 'assess', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['infrastructure'], isSummary: false, mandatory: true },
    { refId: 'assess-design', name: 'Cloud Architecture Design', description: 'Design target architecture with VPC, subnets, security', estimatedDays: 10, priority: 'high', parentRefId: 'assess', dependencyRefId: 'assess-audit', dependencyType: 'FS', offsetDays: 0, skills: ['cloud-architecture'], isSummary: false },
    { refId: 'prep', name: 'Environment Preparation', description: 'Set up cloud environments', estimatedDays: 15, priority: 'high', parentRefId: null, dependencyRefId: 'assess', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'prep-accounts', name: 'Cloud Account & IAM Setup', description: 'Create accounts, roles, policies', estimatedDays: 5, priority: 'high', parentRefId: 'prep', dependencyRefId: 'assess', dependencyType: 'FS', offsetDays: 0, skills: ['cloud-security'], isSummary: false },
    { refId: 'prep-network', name: 'Network & VPN Configuration', description: 'Set up VPC, subnets, VPN connectivity', estimatedDays: 10, priority: 'high', parentRefId: 'prep', dependencyRefId: 'prep-accounts', dependencyType: 'FS', offsetDays: 0, skills: ['networking'], isSummary: false },
    { refId: 'migrate', name: 'Migration Execution', description: 'Migrate workloads to cloud', estimatedDays: 50, priority: 'urgent', parentRefId: null, dependencyRefId: 'prep', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'migrate-db', name: 'Database Migration', description: 'Migrate databases to RDS/Aurora', estimatedDays: 20, priority: 'urgent', parentRefId: 'migrate', dependencyRefId: 'prep', dependencyType: 'FS', offsetDays: 0, skills: ['database', 'cloud'], isSummary: false },
    { refId: 'migrate-app', name: 'Application Migration', description: 'Containerize and deploy apps to ECS/EKS', estimatedDays: 25, priority: 'high', parentRefId: 'migrate', dependencyRefId: 'migrate-db', dependencyType: 'SS', offsetDays: 10, skills: ['backend', 'containers'], isSummary: false },
    { refId: 'migrate-storage', name: 'Storage & File Migration', description: 'Migrate files to S3/EFS', estimatedDays: 10, priority: 'medium', parentRefId: 'migrate', dependencyRefId: 'migrate-db', dependencyType: 'SS', offsetDays: 5, skills: ['cloud'], isSummary: false },
    { refId: 'validate', name: 'Testing & Cutover', description: 'Validate and switch over', estimatedDays: 25, priority: 'high', parentRefId: null, dependencyRefId: 'migrate', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'validate-perf', name: 'Performance & Load Testing', description: 'Validate performance meets SLAs', estimatedDays: 10, priority: 'high', parentRefId: 'validate', dependencyRefId: 'migrate', dependencyType: 'FS', offsetDays: 0, skills: ['testing', 'performance'], isSummary: false },
    { refId: 'validate-cutover', name: 'DNS Cutover & Go-Live', description: 'Switch DNS, decommission old infra', estimatedDays: 5, priority: 'urgent', parentRefId: 'validate', dependencyRefId: 'validate-perf', dependencyType: 'FS', offsetDays: 0, skills: ['infrastructure'], isSummary: false, mandatory: true },
    { refId: 'validate-optimize', name: 'Cost Optimization & Monitoring', description: 'Right-size instances, set up monitoring', estimatedDays: 10, priority: 'medium', parentRefId: 'validate', dependencyRefId: 'validate-cutover', dependencyType: 'FS', offsetDays: 0, skills: ['cloud', 'monitoring'], isSummary: false },
  ],
};

const erpUpgradeTemplate: ProjectTemplate = {
  id: 'tpl-it-erp',
  name: 'System Upgrade / ERP Implementation',
  description: 'Enterprise system upgrade or ERP rollout covering discovery, configuration, data migration, training, and go-live.',
  projectType: 'it',
  category: 'erp_upgrade',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 150,
  tags: ['erp', 'sap', 'enterprise', 'upgrade'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'disc', name: 'Discovery & Fit-Gap', description: 'Analyze current processes and identify gaps', estimatedDays: 25, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: true, mandatory: true },
    { refId: 'disc-process', name: 'Business Process Mapping', description: 'Document current AS-IS processes', estimatedDays: 15, priority: 'high', parentRefId: 'disc', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'disc-gap', name: 'Fit-Gap Analysis', description: 'Compare requirements to system capabilities', estimatedDays: 10, priority: 'high', parentRefId: 'disc', dependencyRefId: 'disc-process', dependencyType: 'FS', offsetDays: 0, skills: ['erp-consulting'], isSummary: false },
    { refId: 'config', name: 'Configuration & Development', description: 'Configure ERP modules and develop customizations', estimatedDays: 45, priority: 'high', parentRefId: null, dependencyRefId: 'disc', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'config-modules', name: 'Module Configuration', description: 'Configure core ERP modules (Finance, HR, Supply Chain)', estimatedDays: 25, priority: 'high', parentRefId: 'config', dependencyRefId: 'disc', dependencyType: 'FS', offsetDays: 0, skills: ['erp-config'], isSummary: false },
    { refId: 'config-custom', name: 'Custom Development', description: 'Build custom reports, integrations, workflows', estimatedDays: 20, priority: 'medium', parentRefId: 'config', dependencyRefId: 'config-modules', dependencyType: 'SS', offsetDays: 10, skills: ['erp-development'], isSummary: false },
    { refId: 'data', name: 'Data Migration', description: 'Cleanse and migrate data', estimatedDays: 30, priority: 'urgent', parentRefId: null, dependencyRefId: 'config', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'data-cleanse', name: 'Data Cleansing', description: 'Clean and validate legacy data', estimatedDays: 15, priority: 'high', parentRefId: 'data', dependencyRefId: 'config', dependencyType: 'FS', offsetDays: 0, skills: ['data-migration'], isSummary: false },
    { refId: 'data-load', name: 'Data Load & Validation', description: 'Load data into new system and validate', estimatedDays: 15, priority: 'urgent', parentRefId: 'data', dependencyRefId: 'data-cleanse', dependencyType: 'FS', offsetDays: 0, skills: ['data-migration'], isSummary: false },
    { refId: 'train', name: 'Training & Testing', description: 'User training and system testing', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'data', dependencyType: 'SS', offsetDays: 10, skills: [], isSummary: true },
    { refId: 'train-material', name: 'Training Material Development', description: 'Create user guides and training content', estimatedDays: 10, priority: 'medium', parentRefId: 'train', dependencyRefId: 'config', dependencyType: 'FS', offsetDays: 0, skills: ['training'], isSummary: false },
    { refId: 'train-sessions', name: 'User Training Sessions', description: 'Conduct training for all user groups', estimatedDays: 15, priority: 'high', parentRefId: 'train', dependencyRefId: 'train-material', dependencyType: 'FS', offsetDays: 0, skills: ['training'], isSummary: false },
    { refId: 'train-uat', name: 'UAT & Sign-off', description: 'Final user acceptance testing', estimatedDays: 10, priority: 'high', parentRefId: 'train', dependencyRefId: 'train-sessions', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false },
    { refId: 'golive', name: 'Go-Live & Support', description: 'Production go-live and hypercare', estimatedDays: 20, priority: 'urgent', parentRefId: null, dependencyRefId: 'train', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'golive-deploy', name: 'Production Deployment', description: 'Deploy to production environment', estimatedDays: 5, priority: 'urgent', parentRefId: 'golive', dependencyRefId: 'train', dependencyType: 'FS', offsetDays: 0, skills: ['erp-admin'], isSummary: false, mandatory: true },
    { refId: 'golive-hyper', name: 'Hypercare Support', description: '2-week intensive support period', estimatedDays: 15, priority: 'high', parentRefId: 'golive', dependencyRefId: 'golive-deploy', dependencyType: 'FS', offsetDays: 0, skills: ['support'], isSummary: false },
  ],
};

const commercialBuildingTemplate: ProjectTemplate = {
  id: 'tpl-con-commercial',
  name: 'Commercial Building Construction',
  description: 'Multi-story commercial building construction from site prep to final handover.',
  projectType: 'construction',
  category: 'commercial',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 540,
  tags: ['commercial', 'office', 'multi-story'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'precon', name: 'Pre-Construction', description: 'Planning, design, and permits', estimatedDays: 90, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: true, mandatory: true },
    { refId: 'precon-survey', name: 'Site Survey & Geotechnical', description: 'Topographical survey and soil testing', estimatedDays: 30, priority: 'high', parentRefId: 'precon', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['surveying'], isSummary: false },
    { refId: 'precon-design', name: 'Architectural & Structural Design', description: 'Detailed drawings and engineering', estimatedDays: 45, priority: 'high', parentRefId: 'precon', dependencyRefId: 'precon-survey', dependencyType: 'FS', offsetDays: 0, skills: ['architecture', 'structural-engineering'], isSummary: false },
    { refId: 'precon-permit', name: 'Permits & Approvals', description: 'Building permits and regulatory approvals', estimatedDays: 30, priority: 'high', parentRefId: 'precon', dependencyRefId: 'precon-design', dependencyType: 'SS', offsetDays: 15, skills: ['regulatory'], isSummary: false, mandatory: true },
    { refId: 'foundation', name: 'Foundation & Structure', description: 'Foundation and structural framework', estimatedDays: 150, priority: 'urgent', parentRefId: null, dependencyRefId: 'precon', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'foundation-exc', name: 'Excavation & Foundation', description: 'Deep excavation and concrete foundation', estimatedDays: 60, priority: 'urgent', parentRefId: 'foundation', dependencyRefId: 'precon', dependencyType: 'FS', offsetDays: 0, skills: ['heavy-equipment', 'concrete'], isSummary: false },
    { refId: 'foundation-steel', name: 'Steel Framework', description: 'Erect steel columns, beams, and floors', estimatedDays: 90, priority: 'high', parentRefId: 'foundation', dependencyRefId: 'foundation-exc', dependencyType: 'FS', offsetDays: 0, skills: ['structural-steel'], isSummary: false },
    { refId: 'envelope', name: 'Building Envelope', description: 'Exterior walls, roofing, and windows', estimatedDays: 120, priority: 'high', parentRefId: null, dependencyRefId: 'foundation', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'envelope-walls', name: 'Exterior Walls & Curtain Wall', description: 'Install exterior cladding and curtain wall system', estimatedDays: 60, priority: 'high', parentRefId: 'envelope', dependencyRefId: 'foundation', dependencyType: 'FS', offsetDays: 0, skills: ['curtain-wall'], isSummary: false },
    { refId: 'envelope-roof', name: 'Roofing & Waterproofing', description: 'Install roof membrane and waterproofing', estimatedDays: 30, priority: 'high', parentRefId: 'envelope', dependencyRefId: 'envelope-walls', dependencyType: 'SS', offsetDays: 30, skills: ['roofing'], isSummary: false },
    { refId: 'envelope-windows', name: 'Windows & Glazing', description: 'Install all windows and glass elements', estimatedDays: 45, priority: 'medium', parentRefId: 'envelope', dependencyRefId: 'envelope-walls', dependencyType: 'SS', offsetDays: 20, skills: ['glazing'], isSummary: false },
    { refId: 'interior', name: 'Interior Fit-Out', description: 'MEP and interior finishing', estimatedDays: 120, priority: 'high', parentRefId: null, dependencyRefId: 'envelope', dependencyType: 'SS', offsetDays: 30, skills: [], isSummary: true },
    { refId: 'interior-mep', name: 'MEP Installation', description: 'Mechanical, electrical, plumbing rough-in', estimatedDays: 60, priority: 'high', parentRefId: 'interior', dependencyRefId: 'envelope', dependencyType: 'SS', offsetDays: 30, skills: ['mep'], isSummary: false },
    { refId: 'interior-finish', name: 'Interior Finishing', description: 'Drywall, flooring, paint, fixtures', estimatedDays: 60, priority: 'medium', parentRefId: 'interior', dependencyRefId: 'interior-mep', dependencyType: 'FS', offsetDays: 0, skills: ['finishing'], isSummary: false },
    { refId: 'closeout', name: 'Inspection & Handover', description: 'Final inspection and project closeout', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'interior', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'closeout-inspect', name: 'Final Inspections & Punch List', description: 'Code inspections and deficiency corrections', estimatedDays: 20, priority: 'high', parentRefId: 'closeout', dependencyRefId: 'interior', dependencyType: 'FS', offsetDays: 0, skills: ['quality-control'], isSummary: false, mandatory: true },
    { refId: 'closeout-handover', name: 'Owner Handover & Commissioning', description: 'Hand over keys, as-built drawings, warranties', estimatedDays: 10, priority: 'high', parentRefId: 'closeout', dependencyRefId: 'closeout-inspect', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
  ],
};

const residentialTemplate: ProjectTemplate = {
  id: 'tpl-con-residential',
  name: 'Residential Construction',
  description: 'Single-family or small multi-family residential construction project.',
  projectType: 'construction',
  category: 'residential',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 180,
  tags: ['residential', 'housing', 'home'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'design', name: 'Design & Permits', description: 'Architectural design and building permits', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['architecture'], isSummary: true, mandatory: true },
    { refId: 'design-arch', name: 'Architectural Design', description: 'Floor plans, elevations, specifications', estimatedDays: 15, priority: 'high', parentRefId: 'design', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['architecture'], isSummary: false },
    { refId: 'design-permit', name: 'Building Permit Application', description: 'Submit and obtain building permits', estimatedDays: 15, priority: 'high', parentRefId: 'design', dependencyRefId: 'design-arch', dependencyType: 'FS', offsetDays: 0, skills: ['regulatory'], isSummary: false, mandatory: true },
    { refId: 'site', name: 'Site Work & Foundation', description: 'Site prep and foundation', estimatedDays: 30, priority: 'urgent', parentRefId: null, dependencyRefId: 'design', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'site-clear', name: 'Site Clearing & Grading', description: 'Clear vegetation and grade lot', estimatedDays: 10, priority: 'high', parentRefId: 'site', dependencyRefId: 'design', dependencyType: 'FS', offsetDays: 0, skills: ['earthwork'], isSummary: false },
    { refId: 'site-foundation', name: 'Foundation & Slab', description: 'Pour foundation and slab', estimatedDays: 20, priority: 'urgent', parentRefId: 'site', dependencyRefId: 'site-clear', dependencyType: 'FS', offsetDays: 0, skills: ['concrete'], isSummary: false },
    { refId: 'frame', name: 'Framing & Rough-In', description: 'Structural framing and rough MEP', estimatedDays: 40, priority: 'high', parentRefId: null, dependencyRefId: 'site', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'frame-struct', name: 'Structural Framing', description: 'Wood framing, trusses, sheathing', estimatedDays: 20, priority: 'high', parentRefId: 'frame', dependencyRefId: 'site', dependencyType: 'FS', offsetDays: 0, skills: ['carpentry'], isSummary: false },
    { refId: 'frame-mep', name: 'Rough MEP', description: 'Rough plumbing, electrical, HVAC', estimatedDays: 20, priority: 'high', parentRefId: 'frame', dependencyRefId: 'frame-struct', dependencyType: 'FS', offsetDays: 0, skills: ['mep'], isSummary: false },
    { refId: 'finish', name: 'Finishing', description: 'Interior and exterior finishing', estimatedDays: 50, priority: 'medium', parentRefId: null, dependencyRefId: 'frame', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'finish-ext', name: 'Exterior Finishing', description: 'Siding, roofing, exterior paint', estimatedDays: 20, priority: 'medium', parentRefId: 'finish', dependencyRefId: 'frame', dependencyType: 'FS', offsetDays: 0, skills: ['roofing', 'siding'], isSummary: false },
    { refId: 'finish-int', name: 'Interior Finishing', description: 'Drywall, flooring, cabinets, paint', estimatedDays: 30, priority: 'medium', parentRefId: 'finish', dependencyRefId: 'frame-mep', dependencyType: 'FS', offsetDays: 0, skills: ['finishing'], isSummary: false },
    { refId: 'final', name: 'Final Inspection & Handover', description: 'Inspections and close out', estimatedDays: 15, priority: 'high', parentRefId: null, dependencyRefId: 'finish', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'final-inspect', name: 'Final Inspections', description: 'Building code inspections', estimatedDays: 7, priority: 'high', parentRefId: 'final', dependencyRefId: 'finish', dependencyType: 'FS', offsetDays: 0, skills: ['quality-control'], isSummary: false, mandatory: true },
    { refId: 'final-handover', name: 'Owner Handover', description: 'Walkthrough and key handover', estimatedDays: 3, priority: 'high', parentRefId: 'final', dependencyRefId: 'final-inspect', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
  ],
};

const utilitiesTemplate: ProjectTemplate = {
  id: 'tpl-infra-utilities',
  name: 'Utilities Infrastructure',
  description: 'Water, sewer, or power utility installation covering planning, trenching, installation, and commissioning.',
  projectType: 'infrastructure',
  category: 'utilities',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 240,
  tags: ['utilities', 'water', 'sewer', 'power'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'plan', name: 'Planning & Engineering', description: 'Engineering design and permits', estimatedDays: 45, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['civil-engineering'], isSummary: true, mandatory: true },
    { refId: 'plan-survey', name: 'Route Survey & Geotechnical', description: 'Survey proposed route and test soil conditions', estimatedDays: 15, priority: 'high', parentRefId: 'plan', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['surveying'], isSummary: false },
    { refId: 'plan-design', name: 'Engineering Design', description: 'Detailed pipe/cable routing and sizing', estimatedDays: 20, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-survey', dependencyType: 'FS', offsetDays: 0, skills: ['civil-engineering'], isSummary: false },
    { refId: 'plan-permit', name: 'Permits & Right-of-Way', description: 'Obtain construction permits and easements', estimatedDays: 20, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-design', dependencyType: 'SS', offsetDays: 10, skills: ['regulatory'], isSummary: false, mandatory: true },
    { refId: 'procure', name: 'Procurement', description: 'Material procurement and staging', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'procure-material', name: 'Material Procurement', description: 'Order pipes, fittings, cables', estimatedDays: 20, priority: 'high', parentRefId: 'procure', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['procurement'], isSummary: false },
    { refId: 'procure-stage', name: 'Staging & Logistics', description: 'Set up staging areas and delivery schedule', estimatedDays: 10, priority: 'medium', parentRefId: 'procure', dependencyRefId: 'procure-material', dependencyType: 'SS', offsetDays: 10, skills: ['logistics'], isSummary: false },
    { refId: 'install', name: 'Installation', description: 'Trenching and utility installation', estimatedDays: 120, priority: 'urgent', parentRefId: null, dependencyRefId: 'procure', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'install-trench', name: 'Trenching & Excavation', description: 'Excavate trenches along route', estimatedDays: 45, priority: 'high', parentRefId: 'install', dependencyRefId: 'procure', dependencyType: 'FS', offsetDays: 0, skills: ['heavy-equipment'], isSummary: false },
    { refId: 'install-pipe', name: 'Pipe/Cable Installation', description: 'Lay pipes or cables in trenches', estimatedDays: 50, priority: 'urgent', parentRefId: 'install', dependencyRefId: 'install-trench', dependencyType: 'SS', offsetDays: 15, skills: ['utilities'], isSummary: false },
    { refId: 'install-backfill', name: 'Backfill & Restoration', description: 'Backfill trenches and restore surfaces', estimatedDays: 30, priority: 'medium', parentRefId: 'install', dependencyRefId: 'install-pipe', dependencyType: 'SS', offsetDays: 20, skills: ['earthwork'], isSummary: false },
    { refId: 'commission', name: 'Testing & Commissioning', description: 'Test and commission the system', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'install', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'commission-test', name: 'Pressure/Load Testing', description: 'Test system integrity under pressure/load', estimatedDays: 15, priority: 'high', parentRefId: 'commission', dependencyRefId: 'install', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false, mandatory: true },
    { refId: 'commission-live', name: 'Commissioning & Handover', description: 'Bring system online and hand over to operator', estimatedDays: 15, priority: 'high', parentRefId: 'commission', dependencyRefId: 'commission-test', dependencyType: 'FS', offsetDays: 0, skills: ['commissioning'], isSummary: false },
  ],
};

const telecomTemplate: ProjectTemplate = {
  id: 'tpl-infra-telecom',
  name: 'Telecom Network Deployment',
  description: 'Deploy a telecom network with tower siting, fiber installation, equipment setup, and testing.',
  projectType: 'infrastructure',
  category: 'telecom',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 180,
  tags: ['telecom', '5g', 'fiber', 'network'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'plan', name: 'Network Planning', description: 'RF design and site acquisition', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['rf-engineering'], isSummary: true, mandatory: true },
    { refId: 'plan-rf', name: 'RF Design & Coverage Planning', description: 'Radio frequency design and coverage maps', estimatedDays: 15, priority: 'high', parentRefId: 'plan', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['rf-engineering'], isSummary: false },
    { refId: 'plan-site', name: 'Site Acquisition & Permits', description: 'Lease agreements and construction permits', estimatedDays: 20, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-rf', dependencyType: 'SS', offsetDays: 5, skills: ['site-acquisition'], isSummary: false, mandatory: true },
    { refId: 'fiber', name: 'Fiber & Backhaul', description: 'Fiber optic installation', estimatedDays: 50, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'fiber-trench', name: 'Fiber Trenching & Duct', description: 'Trench and install fiber ducts', estimatedDays: 30, priority: 'high', parentRefId: 'fiber', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['fiber-optics'], isSummary: false },
    { refId: 'fiber-pull', name: 'Fiber Pull & Splicing', description: 'Pull fiber cables and splice connections', estimatedDays: 20, priority: 'high', parentRefId: 'fiber', dependencyRefId: 'fiber-trench', dependencyType: 'FS', offsetDays: 0, skills: ['fiber-optics'], isSummary: false },
    { refId: 'tower', name: 'Tower & Equipment', description: 'Tower construction and equipment installation', estimatedDays: 60, priority: 'urgent', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'tower-build', name: 'Tower Construction', description: 'Build tower/monopole structures', estimatedDays: 30, priority: 'urgent', parentRefId: 'tower', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['tower-construction'], isSummary: false },
    { refId: 'tower-equip', name: 'Equipment Installation', description: 'Install antennas, radios, power systems', estimatedDays: 20, priority: 'high', parentRefId: 'tower', dependencyRefId: 'tower-build', dependencyType: 'FS', offsetDays: 0, skills: ['telecom-equipment'], isSummary: false },
    { refId: 'tower-power', name: 'Power & Grounding', description: 'Electrical connections and grounding', estimatedDays: 10, priority: 'high', parentRefId: 'tower', dependencyRefId: 'tower-equip', dependencyType: 'SS', offsetDays: 5, skills: ['electrical'], isSummary: false },
    { refId: 'integrate', name: 'Integration & Testing', description: 'Network integration and acceptance testing', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'fiber', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'integrate-config', name: 'Network Configuration', description: 'Configure switches, routers, and management', estimatedDays: 10, priority: 'high', parentRefId: 'integrate', dependencyRefId: 'fiber', dependencyType: 'FS', offsetDays: 0, skills: ['network-engineering'], isSummary: false },
    { refId: 'integrate-test', name: 'Acceptance Testing', description: 'Drive testing and coverage verification', estimatedDays: 15, priority: 'high', parentRefId: 'integrate', dependencyRefId: 'integrate-config', dependencyType: 'FS', offsetDays: 0, skills: ['rf-testing'], isSummary: false },
    { refId: 'integrate-launch', name: 'Network Launch', description: 'Go live and hand over to operations', estimatedDays: 5, priority: 'urgent', parentRefId: 'integrate', dependencyRefId: 'integrate-test', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
  ],
};

const highwayTemplate: ProjectTemplate = {
  id: 'tpl-roads-highway',
  name: 'Highway Construction',
  description: 'Major highway construction or expansion project with environmental, earthwork, paving, and traffic management phases.',
  projectType: 'roads',
  category: 'highway',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 540,
  tags: ['highway', 'road', 'transportation', 'dot'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'env', name: 'Environmental & Permits', description: 'Environmental studies and permit acquisition', estimatedDays: 90, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['environmental'], isSummary: true, mandatory: true },
    { refId: 'env-eis', name: 'Environmental Impact Study', description: 'Complete EIS per federal requirements', estimatedDays: 60, priority: 'high', parentRefId: 'env', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['environmental'], isSummary: false, mandatory: true },
    { refId: 'env-row', name: 'Right-of-Way Acquisition', description: 'Acquire land parcels for road expansion', estimatedDays: 60, priority: 'high', parentRefId: 'env', dependencyRefId: 'env-eis', dependencyType: 'SS', offsetDays: 30, skills: ['land-acquisition'], isSummary: false },
    { refId: 'env-permit', name: 'Construction Permits', description: 'Obtain federal, state, and local permits', estimatedDays: 30, priority: 'high', parentRefId: 'env', dependencyRefId: 'env-eis', dependencyType: 'FS', offsetDays: 0, skills: ['regulatory'], isSummary: false, mandatory: true },
    { refId: 'util', name: 'Utility Relocation', description: 'Relocate underground and overhead utilities', estimatedDays: 90, priority: 'medium', parentRefId: null, dependencyRefId: 'env', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'util-survey', name: 'Utility Survey & Coordination', description: 'Identify all utilities in corridor', estimatedDays: 20, priority: 'high', parentRefId: 'util', dependencyRefId: 'env', dependencyType: 'FS', offsetDays: 0, skills: ['surveying'], isSummary: false },
    { refId: 'util-relocate', name: 'Utility Relocation Work', description: 'Physically relocate utilities', estimatedDays: 70, priority: 'medium', parentRefId: 'util', dependencyRefId: 'util-survey', dependencyType: 'FS', offsetDays: 0, skills: ['utilities'], isSummary: false },
    { refId: 'earth', name: 'Earthwork & Drainage', description: 'Grading, drainage, and subbase', estimatedDays: 120, priority: 'high', parentRefId: null, dependencyRefId: 'util', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'earth-grade', name: 'Mass Grading', description: 'Cut and fill operations', estimatedDays: 60, priority: 'high', parentRefId: 'earth', dependencyRefId: 'util', dependencyType: 'FS', offsetDays: 0, skills: ['heavy-equipment'], isSummary: false },
    { refId: 'earth-drain', name: 'Drainage & Culverts', description: 'Install drainage systems and culverts', estimatedDays: 45, priority: 'high', parentRefId: 'earth', dependencyRefId: 'earth-grade', dependencyType: 'SS', offsetDays: 20, skills: ['drainage'], isSummary: false },
    { refId: 'earth-sub', name: 'Subbase & Base Course', description: 'Prepare road subbase layers', estimatedDays: 40, priority: 'high', parentRefId: 'earth', dependencyRefId: 'earth-grade', dependencyType: 'FS', offsetDays: 0, skills: ['paving'], isSummary: false },
    { refId: 'pave', name: 'Paving & Finishing', description: 'Asphalt/concrete paving and road finishing', estimatedDays: 150, priority: 'urgent', parentRefId: null, dependencyRefId: 'earth', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'pave-asphalt', name: 'Asphalt Paving', description: 'Multiple lifts of asphalt paving', estimatedDays: 90, priority: 'urgent', parentRefId: 'pave', dependencyRefId: 'earth', dependencyType: 'FS', offsetDays: 0, skills: ['paving'], isSummary: false },
    { refId: 'pave-mark', name: 'Lane Markings & Signage', description: 'Road markings, signs, and signals', estimatedDays: 30, priority: 'high', parentRefId: 'pave', dependencyRefId: 'pave-asphalt', dependencyType: 'FS', offsetDays: 0, skills: ['traffic-engineering'], isSummary: false },
    { refId: 'pave-barrier', name: 'Barriers & Guardrails', description: 'Install safety barriers and guardrails', estimatedDays: 30, priority: 'high', parentRefId: 'pave', dependencyRefId: 'pave-asphalt', dependencyType: 'SS', offsetDays: 10, skills: ['safety'], isSummary: false },
    { refId: 'close', name: 'Final Inspection & Opening', description: 'Inspection and open to traffic', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'pave', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'close-inspect', name: 'Final Quality Inspection', description: 'DOT inspection and punch list', estimatedDays: 15, priority: 'high', parentRefId: 'close', dependencyRefId: 'pave', dependencyType: 'FS', offsetDays: 0, skills: ['quality-control'], isSummary: false, mandatory: true },
    { refId: 'close-open', name: 'Road Opening Ceremony', description: 'Open road to traffic', estimatedDays: 5, priority: 'medium', parentRefId: 'close', dependencyRefId: 'close-inspect', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
  ],
};

const bridgeTemplate: ProjectTemplate = {
  id: 'tpl-roads-bridge',
  name: 'Bridge Construction',
  description: 'New bridge or major bridge rehabilitation including substructure, superstructure, and deck work.',
  projectType: 'roads',
  category: 'bridge',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 720,
  tags: ['bridge', 'structure', 'transportation'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'design', name: 'Design & Engineering', description: 'Detailed bridge design and engineering', estimatedDays: 120, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['structural-engineering'], isSummary: true, mandatory: true },
    { refId: 'design-geo', name: 'Geotechnical Investigation', description: 'Soil borings and foundation design', estimatedDays: 30, priority: 'high', parentRefId: 'design', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['geotechnical'], isSummary: false, mandatory: true },
    { refId: 'design-struct', name: 'Structural Design', description: 'Bridge structural design and analysis', estimatedDays: 60, priority: 'high', parentRefId: 'design', dependencyRefId: 'design-geo', dependencyType: 'FS', offsetDays: 0, skills: ['structural-engineering'], isSummary: false },
    { refId: 'design-permit', name: 'Environmental & Permits', description: 'Environmental clearances and permits', estimatedDays: 45, priority: 'high', parentRefId: 'design', dependencyRefId: 'design-struct', dependencyType: 'SS', offsetDays: 20, skills: ['environmental'], isSummary: false },
    { refId: 'sub', name: 'Substructure', description: 'Foundations and piers', estimatedDays: 180, priority: 'urgent', parentRefId: null, dependencyRefId: 'design', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'sub-cofferdam', name: 'Cofferdam & Dewatering', description: 'Install cofferdams for underwater work', estimatedDays: 45, priority: 'urgent', parentRefId: 'sub', dependencyRefId: 'design', dependencyType: 'FS', offsetDays: 0, skills: ['marine-construction'], isSummary: false },
    { refId: 'sub-pile', name: 'Pile Driving', description: 'Drive foundation piles', estimatedDays: 60, priority: 'urgent', parentRefId: 'sub', dependencyRefId: 'sub-cofferdam', dependencyType: 'FS', offsetDays: 0, skills: ['pile-driving'], isSummary: false },
    { refId: 'sub-pier', name: 'Pier Construction', description: 'Build concrete piers and abutments', estimatedDays: 75, priority: 'high', parentRefId: 'sub', dependencyRefId: 'sub-pile', dependencyType: 'FS', offsetDays: 0, skills: ['concrete'], isSummary: false },
    { refId: 'super', name: 'Superstructure', description: 'Girders, deck, and bearings', estimatedDays: 180, priority: 'high', parentRefId: null, dependencyRefId: 'sub', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'super-girder', name: 'Girder Fabrication & Erection', description: 'Fabricate and place steel/precast girders', estimatedDays: 90, priority: 'high', parentRefId: 'super', dependencyRefId: 'sub', dependencyType: 'FS', offsetDays: 0, skills: ['structural-steel'], isSummary: false },
    { refId: 'super-deck', name: 'Deck Forming & Pour', description: 'Form and pour concrete deck', estimatedDays: 60, priority: 'high', parentRefId: 'super', dependencyRefId: 'super-girder', dependencyType: 'FS', offsetDays: 0, skills: ['concrete'], isSummary: false },
    { refId: 'super-barrier', name: 'Barriers & Railings', description: 'Install bridge barriers and railings', estimatedDays: 30, priority: 'medium', parentRefId: 'super', dependencyRefId: 'super-deck', dependencyType: 'FS', offsetDays: 0, skills: ['safety'], isSummary: false },
    { refId: 'finish', name: 'Finishing & Approaches', description: 'Road approaches and finishing work', estimatedDays: 120, priority: 'high', parentRefId: null, dependencyRefId: 'super', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'finish-approach', name: 'Road Approaches', description: 'Build road approaches to bridge', estimatedDays: 45, priority: 'high', parentRefId: 'finish', dependencyRefId: 'super', dependencyType: 'FS', offsetDays: 0, skills: ['paving'], isSummary: false },
    { refId: 'finish-surface', name: 'Deck Surfacing & Joints', description: 'Overlay deck surface and install expansion joints', estimatedDays: 30, priority: 'high', parentRefId: 'finish', dependencyRefId: 'finish-approach', dependencyType: 'SS', offsetDays: 10, skills: ['paving'], isSummary: false },
    { refId: 'finish-inspect', name: 'Load Testing & Inspection', description: 'Structural load testing and final inspection', estimatedDays: 20, priority: 'urgent', parentRefId: 'finish', dependencyRefId: 'finish-surface', dependencyType: 'FS', offsetDays: 0, skills: ['structural-testing'], isSummary: false, mandatory: true },
    { refId: 'finish-open', name: 'Bridge Opening', description: 'Open bridge to traffic', estimatedDays: 5, priority: 'high', parentRefId: 'finish', dependencyRefId: 'finish-inspect', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
  ],
};

const genericTemplate: ProjectTemplate = {
  id: 'tpl-generic-pmi',
  name: 'Generic PMI Project',
  description: 'Standard PMI project lifecycle: Initiation, Planning, Execution, Monitoring & Control, Closing.',
  projectType: 'other',
  category: 'generic',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 60,
  tags: ['pmi', 'generic', 'standard'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'init', name: 'Initiation', description: 'Project charter and stakeholder identification', estimatedDays: 5, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: true, mandatory: true },
    { refId: 'init-charter', name: 'Project Charter', description: 'Define objectives, scope, and constraints', estimatedDays: 3, priority: 'high', parentRefId: 'init', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'init-stake', name: 'Stakeholder Identification', description: 'Identify and analyze stakeholders', estimatedDays: 2, priority: 'high', parentRefId: 'init', dependencyRefId: 'init-charter', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'plan', name: 'Planning', description: 'Detailed project planning', estimatedDays: 10, priority: 'high', parentRefId: null, dependencyRefId: 'init', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'plan-scope', name: 'Scope & WBS', description: 'Define scope and create Work Breakdown Structure', estimatedDays: 3, priority: 'high', parentRefId: 'plan', dependencyRefId: 'init', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'plan-schedule', name: 'Schedule & Budget', description: 'Create schedule and cost estimates', estimatedDays: 4, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-scope', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'plan-risk', name: 'Risk Planning', description: 'Identify risks and plan responses', estimatedDays: 3, priority: 'medium', parentRefId: 'plan', dependencyRefId: 'plan-scope', dependencyType: 'SS', offsetDays: 2, skills: ['risk-management'], isSummary: false },
    { refId: 'exec', name: 'Execution', description: 'Project work execution', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'exec-work', name: 'Direct & Manage Project Work', description: 'Execute project deliverables', estimatedDays: 25, priority: 'high', parentRefId: 'exec', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false },
    { refId: 'exec-qa', name: 'Quality Assurance', description: 'Ensure quality standards are met', estimatedDays: 15, priority: 'medium', parentRefId: 'exec', dependencyRefId: 'exec-work', dependencyType: 'SS', offsetDays: 10, skills: ['quality-control'], isSummary: false },
    { refId: 'close', name: 'Closing', description: 'Project closing activities', estimatedDays: 10, priority: 'high', parentRefId: null, dependencyRefId: 'exec', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'close-deliver', name: 'Final Deliverables & Acceptance', description: 'Deliver final outputs and get sign-off', estimatedDays: 5, priority: 'high', parentRefId: 'close', dependencyRefId: 'exec', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'close-lessons', name: 'Lessons Learned & Archive', description: 'Document lessons and archive project files', estimatedDays: 5, priority: 'medium', parentRefId: 'close', dependencyRefId: 'close-deliver', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
  ],
};

// ─── Agile/Scrum Sprint Template ────────────────────────────────────────────

const agileScrumTemplate: ProjectTemplate = {
  id: 'tpl-it-agile',
  name: 'Agile/Scrum Sprint Project',
  description: 'Agile project with 4 sprints, ceremonies, product backlog grooming, and retrospectives.',
  projectType: 'it',
  category: 'agile',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 90,
  tags: ['agile', 'scrum', 'sprint', 'software'],
  usageCount: 0,
  defaultMethodology: 'agile',
  tasks: [
    { refId: 'setup', name: 'Project Setup', description: 'Initial project setup and team onboarding', estimatedDays: 5, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: true, mandatory: true },
    { refId: 'setup-vision', name: 'Product Vision & Roadmap', description: 'Define product vision, goals, and release roadmap', estimatedDays: 2, priority: 'high', parentRefId: 'setup', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['product-management'], isSummary: false, mandatory: true },
    { refId: 'setup-backlog', name: 'Initial Backlog Creation', description: 'Create and prioritize initial product backlog', estimatedDays: 3, priority: 'high', parentRefId: 'setup', dependencyRefId: 'setup-vision', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false },
    { refId: 's1', name: 'Sprint 1', description: 'First sprint — foundation and core features', estimatedDays: 14, priority: 'high', parentRefId: null, dependencyRefId: 'setup', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 's1-plan', name: 'Sprint 1 Planning', description: 'Sprint planning ceremony', estimatedDays: 1, priority: 'high', parentRefId: 's1', dependencyRefId: 'setup', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's1-dev', name: 'Sprint 1 Development', description: 'Execute sprint backlog items', estimatedDays: 10, priority: 'high', parentRefId: 's1', dependencyRefId: 's1-plan', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 's1-review', name: 'Sprint 1 Review & Retro', description: 'Demo and retrospective', estimatedDays: 1, priority: 'medium', parentRefId: 's1', dependencyRefId: 's1-dev', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's2', name: 'Sprint 2', description: 'Second sprint — feature expansion', estimatedDays: 14, priority: 'high', parentRefId: null, dependencyRefId: 's1', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 's2-plan', name: 'Sprint 2 Planning', description: 'Sprint planning ceremony', estimatedDays: 1, priority: 'high', parentRefId: 's2', dependencyRefId: 's1', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's2-dev', name: 'Sprint 2 Development', description: 'Execute sprint backlog items', estimatedDays: 10, priority: 'high', parentRefId: 's2', dependencyRefId: 's2-plan', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 's2-review', name: 'Sprint 2 Review & Retro', description: 'Demo and retrospective', estimatedDays: 1, priority: 'medium', parentRefId: 's2', dependencyRefId: 's2-dev', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's3', name: 'Sprint 3', description: 'Third sprint — refinement and integration', estimatedDays: 14, priority: 'high', parentRefId: null, dependencyRefId: 's2', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 's3-plan', name: 'Sprint 3 Planning', description: 'Sprint planning ceremony', estimatedDays: 1, priority: 'high', parentRefId: 's3', dependencyRefId: 's2', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's3-dev', name: 'Sprint 3 Development', description: 'Execute sprint backlog items', estimatedDays: 10, priority: 'high', parentRefId: 's3', dependencyRefId: 's3-plan', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 's3-review', name: 'Sprint 3 Review & Retro', description: 'Demo and retrospective', estimatedDays: 1, priority: 'medium', parentRefId: 's3', dependencyRefId: 's3-dev', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's4', name: 'Sprint 4', description: 'Fourth sprint — polish and release prep', estimatedDays: 14, priority: 'urgent', parentRefId: null, dependencyRefId: 's3', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 's4-plan', name: 'Sprint 4 Planning', description: 'Sprint planning ceremony', estimatedDays: 1, priority: 'high', parentRefId: 's4', dependencyRefId: 's3', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 's4-dev', name: 'Sprint 4 Development', description: 'Final features and bug fixes', estimatedDays: 10, priority: 'high', parentRefId: 's4', dependencyRefId: 's4-plan', dependencyType: 'FS', offsetDays: 0, skills: ['fullstack'], isSummary: false },
    { refId: 's4-review', name: 'Sprint 4 Review & Retro', description: 'Final demo and retrospective', estimatedDays: 1, priority: 'medium', parentRefId: 's4', dependencyRefId: 's4-dev', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'release', name: 'Release', description: 'Production release and handover', estimatedDays: 5, priority: 'urgent', parentRefId: null, dependencyRefId: 's4', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'release-prep', name: 'Release Preparation', description: 'Final testing and deployment prep', estimatedDays: 3, priority: 'urgent', parentRefId: 'release', dependencyRefId: 's4', dependencyType: 'FS', offsetDays: 0, skills: ['devops'], isSummary: false, mandatory: true },
    { refId: 'release-deploy', name: 'Go-Live', description: 'Deploy to production', estimatedDays: 2, priority: 'urgent', parentRefId: 'release', dependencyRefId: 'release-prep', dependencyType: 'FS', offsetDays: 0, skills: ['devops'], isSummary: false },
  ],
};

// ─── Marketing Campaign Template ────────────────────────────────────────────

const marketingCampaignTemplate: ProjectTemplate = {
  id: 'tpl-mktg-campaign',
  name: 'Marketing Campaign',
  description: 'End-to-end marketing campaign with planning, creative development, launch execution, and performance measurement.',
  projectType: 'other',
  category: 'marketing',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 60,
  tags: ['marketing', 'campaign', 'digital', 'launch'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'plan', name: 'Campaign Planning', description: 'Strategy, audience, and channel planning', estimatedDays: 10, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: true, mandatory: true },
    { refId: 'plan-brief', name: 'Campaign Brief', description: 'Define objectives, KPIs, target audience, and messaging', estimatedDays: 3, priority: 'high', parentRefId: 'plan', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false, mandatory: true },
    { refId: 'plan-channels', name: 'Channel Strategy', description: 'Select channels, allocate budget, define timeline', estimatedDays: 3, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-brief', dependencyType: 'FS', offsetDays: 0, skills: ['media-planning'], isSummary: false },
    { refId: 'plan-budget', name: 'Budget & Resource Plan', description: 'Finalize budget allocation and resource assignments', estimatedDays: 2, priority: 'medium', parentRefId: 'plan', dependencyRefId: 'plan-channels', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'creative', name: 'Creative Development', description: 'Design and produce campaign assets', estimatedDays: 15, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'creative-copy', name: 'Copywriting', description: 'Write ad copy, email content, landing page text', estimatedDays: 7, priority: 'high', parentRefId: 'creative', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['copywriting'], isSummary: false },
    { refId: 'creative-design', name: 'Visual Design', description: 'Design graphics, banners, video assets', estimatedDays: 10, priority: 'high', parentRefId: 'creative', dependencyRefId: 'plan', dependencyType: 'SS', offsetDays: 3, skills: ['graphic-design'], isSummary: false },
    { refId: 'creative-review', name: 'Creative Review & Approval', description: 'Stakeholder review and approval of assets', estimatedDays: 3, priority: 'medium', parentRefId: 'creative', dependencyRefId: 'creative-design', dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false },
    { refId: 'launch', name: 'Campaign Launch', description: 'Set up and launch campaign across channels', estimatedDays: 10, priority: 'urgent', parentRefId: null, dependencyRefId: 'creative', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'launch-setup', name: 'Platform Setup', description: 'Configure ad platforms, email tools, landing pages', estimatedDays: 5, priority: 'high', parentRefId: 'launch', dependencyRefId: 'creative', dependencyType: 'FS', offsetDays: 0, skills: ['digital-marketing'], isSummary: false },
    { refId: 'launch-go', name: 'Go Live', description: 'Launch all campaign channels', estimatedDays: 2, priority: 'urgent', parentRefId: 'launch', dependencyRefId: 'launch-setup', dependencyType: 'FS', offsetDays: 0, skills: ['digital-marketing'], isSummary: false },
    { refId: 'launch-monitor', name: 'Initial Monitoring', description: 'Monitor performance and make quick adjustments', estimatedDays: 5, priority: 'high', parentRefId: 'launch', dependencyRefId: 'launch-go', dependencyType: 'FS', offsetDays: 0, skills: ['analytics'], isSummary: false },
    { refId: 'measure', name: 'Measurement & Reporting', description: 'Analyze results and create reports', estimatedDays: 10, priority: 'high', parentRefId: null, dependencyRefId: 'launch', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'measure-data', name: 'Data Collection & Analysis', description: 'Gather campaign data and analyze performance vs KPIs', estimatedDays: 5, priority: 'high', parentRefId: 'measure', dependencyRefId: 'launch', dependencyType: 'FS', offsetDays: 0, skills: ['analytics'], isSummary: false },
    { refId: 'measure-report', name: 'Final Report & Learnings', description: 'Create campaign report with ROI analysis and learnings', estimatedDays: 5, priority: 'high', parentRefId: 'measure', dependencyRefId: 'measure-data', dependencyType: 'FS', offsetDays: 0, skills: ['analytics'], isSummary: false, mandatory: true },
  ],
};

// ─── Product Launch Template ────────────────────────────────────────────────

const productLaunchTemplate: ProjectTemplate = {
  id: 'tpl-mktg-product',
  name: 'Product Launch',
  description: 'Full product launch from market research through development coordination, go-to-market strategy, and launch execution.',
  projectType: 'other',
  category: 'marketing',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 120,
  tags: ['product', 'launch', 'gtm', 'go-to-market'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'research', name: 'Market Research', description: 'Market analysis and competitive research', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['market-research'], isSummary: true, mandatory: true },
    { refId: 'research-market', name: 'Market Analysis', description: 'Analyze market size, trends, and opportunity', estimatedDays: 10, priority: 'high', parentRefId: 'research', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['market-research'], isSummary: false, mandatory: true },
    { refId: 'research-compete', name: 'Competitive Analysis', description: 'Analyze competitors, pricing, positioning', estimatedDays: 7, priority: 'high', parentRefId: 'research', dependencyRefId: 'research-market', dependencyType: 'SS', offsetDays: 5, skills: ['market-research'], isSummary: false },
    { refId: 'research-persona', name: 'Buyer Personas', description: 'Create detailed buyer personas', estimatedDays: 5, priority: 'medium', parentRefId: 'research', dependencyRefId: 'research-market', dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false },
    { refId: 'dev', name: 'Product Development Coordination', description: 'Coordinate with product/engineering teams', estimatedDays: 40, priority: 'high', parentRefId: null, dependencyRefId: 'research', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'dev-reqs', name: 'Product Requirements', description: 'Finalize product requirements and features', estimatedDays: 10, priority: 'high', parentRefId: 'dev', dependencyRefId: 'research', dependencyType: 'FS', offsetDays: 0, skills: ['product-management'], isSummary: false },
    { refId: 'dev-beta', name: 'Beta Program', description: 'Run beta testing with early adopters', estimatedDays: 20, priority: 'high', parentRefId: 'dev', dependencyRefId: 'dev-reqs', dependencyType: 'FS', offsetDays: 0, skills: ['product-management'], isSummary: false },
    { refId: 'dev-feedback', name: 'Feedback Integration', description: 'Incorporate beta feedback into final product', estimatedDays: 10, priority: 'medium', parentRefId: 'dev', dependencyRefId: 'dev-beta', dependencyType: 'FS', offsetDays: 0, skills: ['product-management'], isSummary: false },
    { refId: 'gtm', name: 'Go-to-Market Strategy', description: 'GTM planning and execution', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'research', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'gtm-position', name: 'Positioning & Messaging', description: 'Define product positioning, value props, and key messages', estimatedDays: 7, priority: 'high', parentRefId: 'gtm', dependencyRefId: 'research', dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false },
    { refId: 'gtm-pricing', name: 'Pricing Strategy', description: 'Set pricing tiers and packaging', estimatedDays: 5, priority: 'high', parentRefId: 'gtm', dependencyRefId: 'gtm-position', dependencyType: 'FS', offsetDays: 0, skills: ['product-management'], isSummary: false },
    { refId: 'gtm-content', name: 'Launch Content Creation', description: 'Website, collateral, press releases, demo videos', estimatedDays: 15, priority: 'high', parentRefId: 'gtm', dependencyRefId: 'gtm-position', dependencyType: 'SS', offsetDays: 3, skills: ['content-marketing'], isSummary: false },
    { refId: 'gtm-sales', name: 'Sales Enablement', description: 'Sales training, battle cards, demo scripts', estimatedDays: 10, priority: 'medium', parentRefId: 'gtm', dependencyRefId: 'gtm-position', dependencyType: 'SS', offsetDays: 5, skills: ['sales-enablement'], isSummary: false },
    { refId: 'launch', name: 'Launch Execution', description: 'Execute product launch', estimatedDays: 20, priority: 'urgent', parentRefId: null, dependencyRefId: 'dev', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'launch-prep', name: 'Launch Preparation', description: 'Final checks, comms alignment, press outreach', estimatedDays: 5, priority: 'urgent', parentRefId: 'launch', dependencyRefId: 'gtm', dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false },
    { refId: 'launch-day', name: 'Launch Day', description: 'Execute launch plan across all channels', estimatedDays: 1, priority: 'urgent', parentRefId: 'launch', dependencyRefId: 'launch-prep', dependencyType: 'FS', offsetDays: 0, skills: ['marketing-strategy'], isSummary: false, mandatory: true },
    { refId: 'launch-post', name: 'Post-Launch Monitoring', description: 'Monitor adoption, press coverage, and customer feedback', estimatedDays: 14, priority: 'high', parentRefId: 'launch', dependencyRefId: 'launch-day', dependencyType: 'FS', offsetDays: 0, skills: ['analytics'], isSummary: false },
  ],
};

// ─── Office Relocation Template ─────────────────────────────────────────────

const officeRelocationTemplate: ProjectTemplate = {
  id: 'tpl-ops-relocation',
  name: 'Office Relocation',
  description: 'Complete office relocation project covering planning, logistics, physical move, and post-move settling.',
  projectType: 'other',
  category: 'operations',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 90,
  tags: ['office', 'relocation', 'move', 'facilities'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'plan', name: 'Planning & Assessment', description: 'Assess needs and plan the relocation', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: true, mandatory: true },
    { refId: 'plan-needs', name: 'Needs Assessment', description: 'Survey departments, determine space requirements', estimatedDays: 5, priority: 'high', parentRefId: 'plan', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['facilities'], isSummary: false, mandatory: true },
    { refId: 'plan-site', name: 'Site Selection & Lease', description: 'Evaluate locations, negotiate lease, sign contract', estimatedDays: 10, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-needs', dependencyType: 'FS', offsetDays: 0, skills: ['real-estate'], isSummary: false },
    { refId: 'plan-budget', name: 'Budget & Timeline', description: 'Create detailed budget and move timeline', estimatedDays: 3, priority: 'high', parentRefId: 'plan', dependencyRefId: 'plan-site', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false },
    { refId: 'logistics', name: 'Logistics & Preparation', description: 'Prepare new space and coordinate vendors', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'logistics-design', name: 'Space Design & Fit-Out', description: 'Design office layout, furniture, and infrastructure', estimatedDays: 15, priority: 'high', parentRefId: 'logistics', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['interior-design'], isSummary: false },
    { refId: 'logistics-it', name: 'IT Infrastructure Setup', description: 'Network, phones, servers, AV in new space', estimatedDays: 10, priority: 'high', parentRefId: 'logistics', dependencyRefId: 'logistics-design', dependencyType: 'SS', offsetDays: 5, skills: ['it-infrastructure'], isSummary: false },
    { refId: 'logistics-vendor', name: 'Moving Company & Vendors', description: 'Select and contract moving company and vendors', estimatedDays: 5, priority: 'medium', parentRefId: 'logistics', dependencyRefId: 'plan', dependencyType: 'FS', offsetDays: 0, skills: ['procurement'], isSummary: false },
    { refId: 'logistics-comms', name: 'Employee Communications', description: 'Communicate move details, packing guidelines', estimatedDays: 5, priority: 'medium', parentRefId: 'logistics', dependencyRefId: 'logistics-design', dependencyType: 'FS', offsetDays: 0, skills: ['communications'], isSummary: false },
    { refId: 'move', name: 'Physical Move', description: 'Execute the physical relocation', estimatedDays: 10, priority: 'urgent', parentRefId: null, dependencyRefId: 'logistics', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true },
    { refId: 'move-pack', name: 'Packing & Labeling', description: 'Pack departments, label boxes, disconnect equipment', estimatedDays: 3, priority: 'high', parentRefId: 'move', dependencyRefId: 'logistics', dependencyType: 'FS', offsetDays: 0, skills: ['logistics'], isSummary: false },
    { refId: 'move-transport', name: 'Transportation', description: 'Transport furniture, equipment, and boxes', estimatedDays: 2, priority: 'urgent', parentRefId: 'move', dependencyRefId: 'move-pack', dependencyType: 'FS', offsetDays: 0, skills: ['logistics'], isSummary: false },
    { refId: 'move-setup', name: 'Unpacking & Setup', description: 'Unpack, set up workstations, connect IT', estimatedDays: 5, priority: 'high', parentRefId: 'move', dependencyRefId: 'move-transport', dependencyType: 'FS', offsetDays: 0, skills: ['facilities'], isSummary: false },
    { refId: 'settle', name: 'Post-Move Settling', description: 'Settle in and resolve issues', estimatedDays: 15, priority: 'medium', parentRefId: null, dependencyRefId: 'move', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'settle-verify', name: 'Systems Verification', description: 'Verify all IT systems, phones, and services work', estimatedDays: 3, priority: 'high', parentRefId: 'settle', dependencyRefId: 'move', dependencyType: 'FS', offsetDays: 0, skills: ['it-infrastructure'], isSummary: false, mandatory: true },
    { refId: 'settle-issues', name: 'Issue Resolution', description: 'Address any problems from the move', estimatedDays: 7, priority: 'medium', parentRefId: 'settle', dependencyRefId: 'settle-verify', dependencyType: 'FS', offsetDays: 0, skills: ['facilities'], isSummary: false },
    { refId: 'settle-decommission', name: 'Old Office Decommission', description: 'Clean, return keys, end old lease', estimatedDays: 5, priority: 'medium', parentRefId: 'settle', dependencyRefId: 'move', dependencyType: 'SS', offsetDays: 3, skills: ['facilities'], isSummary: false },
  ],
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class TemplateService {
  private static templates: ProjectTemplate[] = [
    webAppTemplate,
    cloudMigrationTemplate,
    erpUpgradeTemplate,
    commercialBuildingTemplate,
    residentialTemplate,
    utilitiesTemplate,
    telecomTemplate,
    highwayTemplate,
    bridgeTemplate,
    genericTemplate,
    agileScrumTemplate,
    marketingCampaignTemplate,
    productLaunchTemplate,
    officeRelocationTemplate,
  ];

  private get templates() { return TemplateService.templates; }

  async findAll(projectType?: string, category?: string): Promise<ProjectTemplate[]> {
    let result = [...this.templates];
    if (projectType) {
      result = result.filter(t => t.projectType === projectType);
    }
    if (category) {
      result = result.filter(t => t.category === category);
    }
    return result;
  }

  async findAllPaginated(limit: number, offset: number, projectType?: string, category?: string): Promise<{ rows: ProjectTemplate[]; total: number }> {
    const all = await this.findAll(projectType, category);
    return { rows: all.slice(offset, offset + limit), total: all.length };
  }

  async findById(id: string): Promise<ProjectTemplate | null> {
    return this.templates.find(t => t.id === id) || null;
  }

  async create(data: Omit<ProjectTemplate, 'id' | 'usageCount'>): Promise<ProjectTemplate> {
    const template: ProjectTemplate = {
      ...data,
      id: `tpl-${Math.random().toString(36).substr(2, 9)}`,
      usageCount: 0,
    };
    TemplateService.templates.push(template);
    return template;
  }

  async update(id: string, data: Partial<Omit<ProjectTemplate, 'id' | 'isBuiltIn'>>): Promise<ProjectTemplate | null> {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) return null;
    if (this.templates[index].isBuiltIn) return null; // Cannot edit built-in templates
    TemplateService.templates[index] = { ...this.templates[index], ...data };
    return TemplateService.templates[index];
  }

  async delete(id: string): Promise<boolean> {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) return false;
    if (this.templates[index].isBuiltIn) return false; // Cannot delete built-in templates
    TemplateService.templates.splice(index, 1);
    return true;
  }

  async applyTemplate(input: {
    templateId: string;
    projectName: string;
    startDate: string;
    budget?: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    methodology?: 'waterfall' | 'agile' | 'hybrid';
    location?: string;
    selectedTaskRefIds?: string[];
    userId: string;
  }): Promise<{ project: any; schedule: any; tasks: any[] }> {
    const template = await this.findById(input.templateId);
    if (!template) throw new Error('Template not found');

    // Increment usage count
    const idx = this.templates.findIndex(t => t.id === input.templateId);
    if (idx !== -1) TemplateService.templates[idx].usageCount++;

    const startDate = new Date(input.startDate);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + template.estimatedDurationDays);

    // 1. Create Project
    const project = await projectService.create({
      name: input.projectName,
      description: template.description,
      projectType: template.projectType,
      category: template.category,
      status: 'planning',
      priority: input.priority,
      methodology: input.methodology,
      budgetAllocated: input.budget,
      location: input.location,
      startDate,
      endDate,
      userId: input.userId,
    });

    // 2. Create Schedule
    const schedule = await scheduleService.create({
      projectId: project.id,
      name: `${input.projectName} Schedule`,
      description: `Auto-generated from template: ${template.name}`,
      startDate,
      endDate,
      createdBy: input.userId,
    });

    // 3. Filter tasks if selectedTaskRefIds provided
    let tasksToCreate = template.tasks;
    if (input.selectedTaskRefIds) {
      const selectedSet = new Set(input.selectedTaskRefIds);

      // Validate all mandatory tasks are included
      const missingMandatory = template.tasks.filter(
        t => t.mandatory && !selectedSet.has(t.refId)
      );
      if (missingMandatory.length > 0) {
        throw new Error(
          `Mandatory tasks cannot be excluded: ${missingMandatory.map(t => t.name).join(', ')}`
        );
      }

      // Auto-include parent summary tasks of any selected child
      for (const t of template.tasks) {
        if (selectedSet.has(t.refId) && t.parentRefId) {
          selectedSet.add(t.parentRefId);
        }
      }

      tasksToCreate = template.tasks.filter(t => selectedSet.has(t.refId));
    }

    // 4. Topological sort tasks (parents first, then by dependency order)
    const sorted = this.topologicalSort(tasksToCreate);

    // 4. Create tasks with dependency resolution
    const refIdToTaskId = new Map<string, string>();
    const createdTasks: any[] = [];

    for (const tt of sorted) {
      const taskStart = new Date(startDate);
      taskStart.setDate(taskStart.getDate() + tt.offsetDays);

      // If this task depends on another, calculate start from dependency end
      if (tt.dependencyRefId && refIdToTaskId.has(tt.dependencyRefId)) {
        const depTask = createdTasks.find(t => t.id === refIdToTaskId.get(tt.dependencyRefId!));
        if (depTask && depTask.endDate) {
          const depEnd = new Date(depTask.endDate);
          if (tt.dependencyType === 'FS') {
            taskStart.setTime(depEnd.getTime());
            taskStart.setDate(taskStart.getDate() + 1);
          } else if (tt.dependencyType === 'SS') {
            const depStart = new Date(depTask.startDate);
            taskStart.setTime(depStart.getTime());
          }
        }
      }

      // If this task has a parent, ensure it starts no earlier than parent
      if (tt.parentRefId && refIdToTaskId.has(tt.parentRefId)) {
        const parentTask = createdTasks.find(t => t.id === refIdToTaskId.get(tt.parentRefId!));
        if (parentTask && parentTask.startDate) {
          const parentStart = new Date(parentTask.startDate);
          if (taskStart < parentStart) {
            taskStart.setTime(parentStart.getTime());
          }
        }
      }

      const taskEnd = new Date(taskStart);
      taskEnd.setDate(taskEnd.getDate() + tt.estimatedDays);

      const depId = tt.dependencyRefId ? refIdToTaskId.get(tt.dependencyRefId) : undefined;
      const task = await scheduleService.createTask({
        scheduleId: schedule.id,
        name: tt.name,
        description: tt.description,
        status: 'pending',
        priority: tt.priority,
        estimatedDays: tt.estimatedDays,
        startDate: taskStart,
        endDate: taskEnd,
        parentTaskId: tt.parentRefId ? refIdToTaskId.get(tt.parentRefId) : undefined,
        dependencies: depId ? [{ dependencyId: depId, dependencyType: (tt.dependencyType as 'FS' | 'FF' | 'SS' | 'SF') || 'FS', lagDays: 0 }] : [],
        createdBy: input.userId,
      });

      refIdToTaskId.set(tt.refId, task.id);
      createdTasks.push(task);
    }

    return { project, schedule, tasks: createdTasks };
  }

  async saveFromProject(input: {
    projectId: string;
    templateName: string;
    description: string;
    tags: string[];
    userId: string;
  }): Promise<ProjectTemplate> {
    const project = await projectService.findById(input.projectId);
    if (!project) throw new Error('Project not found');

    const schedules = await scheduleService.findByProjectId(input.projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const tasksBySchedule = new Map<string, typeof allTasks>();
    for (const t of allTasks) {
      const list = tasksBySchedule.get(t.scheduleId) ?? [];
      list.push(t);
      tasksBySchedule.set(t.scheduleId, list);
    }
    const templateTasks: TemplateTask[] = [];

    for (const schedule of schedules) {
      const tasks = tasksBySchedule.get(schedule.id) ?? [];
      const taskIdToRefId = new Map<string, string>();

      // Build refId map
      for (let i = 0; i < tasks.length; i++) {
        const refId = `saved-${i}`;
        taskIdToRefId.set(tasks[i].id, refId);
      }

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const refId = taskIdToRefId.get(t.id)!;
        const parentRefId = t.parentTaskId ? taskIdToRefId.get(t.parentTaskId) || null : null;
        const firstDep = t.dependencies?.[0];
        const depRefId = firstDep ? taskIdToRefId.get(firstDep.dependencyId) || null : null;

        // Calculate offset from schedule start
        const offsetDays = t.startDate && schedule.startDate
          ? Math.max(0, Math.round((new Date(t.startDate).getTime() - new Date(schedule.startDate).getTime()) / (1000 * 60 * 60 * 24)))
          : 0;

        const estimatedDays = t.estimatedDays || (t.startDate && t.endDate
          ? Math.max(1, Math.round((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / (1000 * 60 * 60 * 24)))
          : 1);

        const hasChildren = tasks.some(child => child.parentTaskId === t.id);

        templateTasks.push({
          refId,
          name: t.name,
          description: t.description || '',
          estimatedDays,
          priority: t.priority || 'medium',
          parentRefId,
          dependencyRefId: depRefId,
          dependencyType: firstDep?.dependencyType || t.dependencyType || 'FS',
          offsetDays,
          skills: [],
          isSummary: hasChildren,
        });
      }
    }

    // Calculate total duration from tasks
    let maxDays = 0;
    for (const tt of templateTasks) {
      const end = tt.offsetDays + tt.estimatedDays;
      if (end > maxDays) maxDays = end;
    }

    return this.create({
      name: input.templateName,
      description: input.description || `Template created from project: ${project.name}`,
      projectType: project.projectType,
      category: project.category || 'custom',
      isBuiltIn: false,
      createdBy: input.userId,
      estimatedDurationDays: maxDays || 30,
      tasks: templateTasks,
      tags: input.tags,
    });
  }

  private topologicalSort(tasks: TemplateTask[]): TemplateTask[] {
    const taskMap = new Map<string, TemplateTask>();
    for (const t of tasks) taskMap.set(t.refId, t);

    const visited = new Set<string>();
    const result: TemplateTask[] = [];

    const visit = (refId: string) => {
      if (visited.has(refId)) return;
      visited.add(refId);

      const task = taskMap.get(refId);
      if (!task) return;

      // Visit parent first
      if (task.parentRefId) visit(task.parentRefId);
      // Visit dependency first
      if (task.dependencyRefId) visit(task.dependencyRefId);

      result.push(task);
    };

    for (const t of tasks) visit(t.refId);
    return result;
  }
}

export const templateService = new TemplateService();
