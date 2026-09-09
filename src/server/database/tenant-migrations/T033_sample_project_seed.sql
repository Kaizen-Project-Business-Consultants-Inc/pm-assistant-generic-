-- T033_sample_project_seed.sql
-- Seed a comprehensive "Sample Web App Development" project that showcases
-- every feature of the PM Assistant platform. Marked as is_demo = TRUE (read-only).
-- Uses INSERT IGNORE for idempotency.

-- ============================================================================
-- Project
-- ============================================================================

INSERT IGNORE INTO projects (
  id, name, description, category, project_type, methodology, status, priority,
  budget_allocated, budget_spent, currency, location, location_lat, location_lon,
  start_date, end_date, created_by, is_demo
) VALUES (
  'demo-sample-webapp',
  'Sample Web App Development',
  'A comprehensive sample project demonstrating all PM Assistant features. This hybrid IT project covers the full lifecycle of building a modern web application — from discovery through launch — with Gantt scheduling, agile sprints, RAID log, budget tracking, resource management, lessons learned, change requests, meetings, goals, and what-if scenarios.\n\nThis project is read-only and serves as a reference for how to use every feature in the platform.',
  'technology',
  'it',
  'hybrid',
  'active',
  'high',
  250000.00,
  112500.00,
  'USD',
  'Toronto, ON',
  43.6532,
  -79.3832,
  '2026-06-01',
  '2026-11-30',
  'system',
  TRUE
);

-- ============================================================================
-- Schedule
-- ============================================================================

INSERT IGNORE INTO schedules (id, project_id, name, description, start_date, end_date, status, created_by)
VALUES (
  'demo-sch-1',
  'demo-sample-webapp',
  'Master Development Schedule',
  'Primary schedule covering all phases from discovery to launch',
  '2026-06-01',
  '2026-11-30',
  'active',
  'system'
);

-- ============================================================================
-- Tasks — Full WBS with hierarchy, milestones, and dependencies
-- ============================================================================

-- Phase 1: Discovery & Planning (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p1', 'demo-sch-1', 'Phase 1: Discovery & Planning', 'Requirements gathering, user research, and technical architecture design', 'completed', 'high', 'task', '2026-06-01', '2026-06-27', 100, 1, 0, NULL, 20, 'system'),
  ('demo-t-1a', 'demo-sch-1', 'Requirements Gathering', 'Stakeholder interviews, business requirements documentation, and feature prioritization', 'completed', 'high', 'story', '2026-06-01', '2026-06-10', 100, 0, 0, 'demo-t-p1', 8, 'system'),
  ('demo-t-1b', 'demo-sch-1', 'User Research & Personas', 'User interviews, journey mapping, and persona development for 4 key user types', 'completed', 'high', 'story', '2026-06-05', '2026-06-16', 100, 0, 0, 'demo-t-p1', 8, 'system'),
  ('demo-t-1c', 'demo-sch-1', 'Technical Architecture Design', 'System architecture, technology stack selection, and infrastructure planning', 'completed', 'high', 'task', '2026-06-12', '2026-06-25', 100, 0, 0, 'demo-t-p1', 10, 'system'),
  ('demo-t-1m', 'demo-sch-1', 'Discovery Complete', 'Milestone: All discovery deliverables approved', 'completed', 'high', 'task', '2026-06-27', '2026-06-27', 100, 0, 1, 'demo-t-p1', 0, 'system');

-- Phase 2: UX/UI Design (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p2', 'demo-sch-1', 'Phase 2: UX/UI Design', 'Wireframing, visual design, and design system creation', 'completed', 'high', 'task', '2026-06-30', '2026-07-25', 100, 1, 0, NULL, 20, 'system'),
  ('demo-t-2a', 'demo-sch-1', 'Wireframes & Prototypes', 'Low and high-fidelity wireframes for all key user flows', 'completed', 'high', 'story', '2026-06-30', '2026-07-11', 100, 0, 0, 'demo-t-p2', 10, 'system'),
  ('demo-t-2b', 'demo-sch-1', 'Visual Design System', 'Color palette, typography, component library, and brand guidelines', 'completed', 'medium', 'story', '2026-07-07', '2026-07-18', 100, 0, 0, 'demo-t-p2', 10, 'system'),
  ('demo-t-2c', 'demo-sch-1', 'Usability Testing', 'Conduct usability tests with 8 target users and iterate on feedback', 'completed', 'high', 'task', '2026-07-14', '2026-07-23', 100, 0, 0, 'demo-t-p2', 8, 'system'),
  ('demo-t-2m', 'demo-sch-1', 'Design Approved', 'Milestone: Final designs signed off by stakeholders', 'completed', 'high', 'task', '2026-07-25', '2026-07-25', 100, 0, 1, 'demo-t-p2', 0, 'system');

-- Phase 3: Backend Development (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p3', 'demo-sch-1', 'Phase 3: Backend Development', 'API development, database design, and server-side logic', 'in_progress', 'urgent', 'task', '2026-07-28', '2026-09-19', 55, 1, 0, NULL, 40, 'system'),
  ('demo-t-3a', 'demo-sch-1', 'API Design & Documentation', 'OpenAPI specification, endpoint design, and developer docs', 'completed', 'high', 'task', '2026-07-28', '2026-08-08', 100, 0, 0, 'demo-t-p3', 10, 'system'),
  ('demo-t-3b', 'demo-sch-1', 'Database Schema & Migrations', 'Schema design, migration scripts, and seed data', 'completed', 'high', 'task', '2026-08-04', '2026-08-15', 100, 0, 0, 'demo-t-p3', 10, 'system'),
  ('demo-t-3c', 'demo-sch-1', 'Core API Endpoints', 'CRUD operations, business logic, and data validation for all entities', 'in_progress', 'urgent', 'story', '2026-08-11', '2026-09-05', 75, 0, 0, 'demo-t-p3', 20, 'system'),
  ('demo-t-3d', 'demo-sch-1', 'Authentication & Authorization', 'JWT auth, role-based access control, and session management', 'in_progress', 'high', 'story', '2026-08-18', '2026-09-05', 60, 0, 0, 'demo-t-p3', 15, 'system'),
  ('demo-t-3e', 'demo-sch-1', 'Third-party Integrations', 'Payment gateway, email service, and analytics integrations', 'pending', 'medium', 'task', '2026-09-01', '2026-09-19', 0, 0, 0, 'demo-t-p3', 15, 'system');

-- Phase 4: Frontend Development (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p4', 'demo-sch-1', 'Phase 4: Frontend Development', 'React component development, state management, and responsive design', 'in_progress', 'high', 'task', '2026-08-11', '2026-09-26', 40, 1, 0, NULL, 35, 'system'),
  ('demo-t-4a', 'demo-sch-1', 'Component Library Setup', 'Shared UI component library with Storybook documentation', 'completed', 'high', 'story', '2026-08-11', '2026-08-22', 100, 0, 0, 'demo-t-p4', 10, 'system'),
  ('demo-t-4b', 'demo-sch-1', 'Core Pages Implementation', 'Dashboard, user profile, settings, and primary navigation', 'in_progress', 'high', 'story', '2026-08-25', '2026-09-12', 50, 0, 0, 'demo-t-p4', 15, 'system'),
  ('demo-t-4c', 'demo-sch-1', 'Responsive Design & Accessibility', 'Mobile-first responsive layouts and WCAG 2.1 AA compliance', 'pending', 'medium', 'task', '2026-09-08', '2026-09-26', 0, 0, 0, 'demo-t-p4', 15, 'system');

-- Phase 5: Testing & QA (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p5', 'demo-sch-1', 'Phase 5: Testing & QA', 'Comprehensive testing including unit, integration, performance, and UAT', 'pending', 'high', 'task', '2026-09-22', '2026-10-30', 0, 1, 0, NULL, 30, 'system'),
  ('demo-t-5a', 'demo-sch-1', 'Unit & Integration Tests', 'Achieve 90%+ code coverage with automated test suites', 'pending', 'high', 'task', '2026-09-22', '2026-10-10', 0, 0, 0, 'demo-t-p5', 15, 'system'),
  ('demo-t-5b', 'demo-sch-1', 'Performance & Load Testing', 'Load testing with k6, API response time benchmarks, and optimization', 'pending', 'medium', 'task', '2026-10-06', '2026-10-17', 0, 0, 0, 'demo-t-p5', 10, 'system'),
  ('demo-t-5c', 'demo-sch-1', 'UAT & Bug Fixes', 'User acceptance testing with stakeholders and bug resolution', 'pending', 'high', 'task', '2026-10-13', '2026-10-30', 0, 0, 0, 'demo-t-p5', 15, 'system');

-- Phase 6: Launch (Summary)
INSERT IGNORE INTO tasks (id, schedule_id, name, description, status, priority, task_type, start_date, end_date, progress_percentage, is_summary, is_milestone, parent_task_id, estimated_days, created_by)
VALUES
  ('demo-t-p6', 'demo-sch-1', 'Phase 6: Launch & Monitoring', 'Staging deployment, production release, and post-launch support', 'pending', 'high', 'task', '2026-11-02', '2026-11-30', 0, 1, 0, NULL, 20, 'system'),
  ('demo-t-6a', 'demo-sch-1', 'Staging Deployment & Smoke Tests', 'Deploy to staging, run smoke tests, and get sign-off', 'pending', 'high', 'task', '2026-11-02', '2026-11-13', 0, 0, 0, 'demo-t-p6', 10, 'system'),
  ('demo-t-6b', 'demo-sch-1', 'Production Deployment', 'Zero-downtime production deployment and DNS cutover', 'pending', 'urgent', 'task', '2026-11-16', '2026-11-20', 0, 0, 0, 'demo-t-p6', 5, 'system'),
  ('demo-t-6m', 'demo-sch-1', 'Go Live', 'Milestone: Application live in production', 'pending', 'urgent', 'task', '2026-11-20', '2026-11-20', 0, 0, 1, 'demo-t-p6', 0, 'system'),
  ('demo-t-6c', 'demo-sch-1', 'Post-Launch Monitoring', 'Monitor performance, errors, and user feedback for 2 weeks', 'pending', 'medium', 'task', '2026-11-20', '2026-11-30', 0, 0, 0, 'demo-t-p6', 8, 'system');

-- ============================================================================
-- Task Dependencies
-- ============================================================================

INSERT IGNORE INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days)
VALUES
  ('demo-dep-1', 'demo-t-p2', 'demo-t-p1', 'FS', 0),
  ('demo-dep-2', 'demo-t-p3', 'demo-t-p2', 'FS', 0),
  ('demo-dep-3', 'demo-t-p4', 'demo-t-3a', 'SS', 5),
  ('demo-dep-4', 'demo-t-p5', 'demo-t-p3', 'FS', 0),
  ('demo-dep-5', 'demo-t-p5', 'demo-t-p4', 'FS', 0),
  ('demo-dep-6', 'demo-t-p6', 'demo-t-p5', 'FS', 0),
  ('demo-dep-7', 'demo-t-1c', 'demo-t-1a', 'SS', 5),
  ('demo-dep-8', 'demo-t-2c', 'demo-t-2a', 'FS', 0),
  ('demo-dep-9', 'demo-t-3b', 'demo-t-3a', 'SS', 3),
  ('demo-dep-10', 'demo-t-3c', 'demo-t-3a', 'FS', 0),
  ('demo-dep-11', 'demo-t-3d', 'demo-t-3b', 'FS', 0),
  ('demo-dep-12', 'demo-t-5b', 'demo-t-5a', 'SS', 5),
  ('demo-dep-13', 'demo-t-6b', 'demo-t-6a', 'FS', 0);

-- ============================================================================
-- Resources
-- ============================================================================

INSERT IGNORE INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, cost_rate_hourly)
VALUES
  ('demo-res-1', 'Sarah Chen', 'Product Manager', 'sarah.chen@example.com', 40, '[{"name":"Product Strategy","level":5},{"name":"Agile","level":4},{"name":"Stakeholder Management","level":5}]', TRUE, 95.00),
  ('demo-res-2', 'James Wilson', 'Lead Full-Stack Developer', 'james.wilson@example.com', 40, '[{"name":"Node.js","level":5},{"name":"React","level":5},{"name":"TypeScript","level":5},{"name":"PostgreSQL","level":4}]', TRUE, 120.00),
  ('demo-res-3', 'Maria Garcia', 'UX/UI Designer', 'maria.garcia@example.com', 40, '[{"name":"Figma","level":5},{"name":"User Research","level":4},{"name":"Design Systems","level":5},{"name":"Accessibility","level":4}]', TRUE, 95.00),
  ('demo-res-4', 'Alex Thompson', 'Backend Developer', 'alex.thompson@example.com', 40, '[{"name":"Node.js","level":4},{"name":"AWS","level":3},{"name":"Docker","level":4},{"name":"REST APIs","level":5}]', TRUE, 105.00),
  ('demo-res-5', 'Priya Patel', 'QA Engineer', 'priya.patel@example.com', 40, '[{"name":"Test Automation","level":5},{"name":"Playwright","level":4},{"name":"Performance Testing","level":3},{"name":"API Testing","level":4}]', TRUE, 90.00);

-- ============================================================================
-- Task Assignments (resource → task)
-- ============================================================================

INSERT IGNORE INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task, hours_planned)
VALUES
  ('demo-ta-1', 'demo-t-1a', 'demo-res-1', 75, 'Product Manager', 48),
  ('demo-ta-2', 'demo-t-1b', 'demo-res-3', 90, 'UX Researcher', 64),
  ('demo-ta-3', 'demo-t-1c', 'demo-res-2', 100, 'Solution Architect', 80),
  ('demo-ta-4', 'demo-t-2a', 'demo-res-3', 100, 'UX Designer', 80),
  ('demo-ta-5', 'demo-t-2b', 'demo-res-3', 90, 'Visual Designer', 72),
  ('demo-ta-6', 'demo-t-3a', 'demo-res-2', 100, 'API Architect', 80),
  ('demo-ta-7', 'demo-t-3b', 'demo-res-4', 100, 'Database Engineer', 80),
  ('demo-ta-8', 'demo-t-3c', 'demo-res-2', 100, 'Lead Developer', 160),
  ('demo-ta-9', 'demo-t-3d', 'demo-res-4', 90, 'Backend Developer', 120),
  ('demo-ta-10', 'demo-t-3e', 'demo-res-4', 100, 'Integration Developer', 120),
  ('demo-ta-11', 'demo-t-4a', 'demo-res-2', 90, 'Frontend Lead', 72),
  ('demo-ta-12', 'demo-t-4b', 'demo-res-2', 100, 'Frontend Developer', 120),
  ('demo-ta-13', 'demo-t-4c', 'demo-res-3', 75, 'A11y Specialist', 90),
  ('demo-ta-14', 'demo-t-5a', 'demo-res-5', 100, 'QA Lead', 120),
  ('demo-ta-15', 'demo-t-5b', 'demo-res-5', 100, 'Performance Tester', 80),
  ('demo-ta-16', 'demo-t-5c', 'demo-res-1', 50, 'UAT Coordinator', 60);

-- ============================================================================
-- Sprints
-- ============================================================================

INSERT IGNORE INTO sprints (id, project_id, schedule_id, name, goal, start_date, end_date, status, velocity_commitment, created_by)
VALUES
  ('demo-spr-1', 'demo-sample-webapp', 'demo-sch-1', 'Sprint 1 — Foundation', 'Complete API design, database schema, and component library setup', '2026-07-28', '2026-08-08', 'completed', 21, 'system'),
  ('demo-spr-2', 'demo-sample-webapp', 'demo-sch-1', 'Sprint 2 — Core Build', 'Build core API endpoints, authentication, and primary UI pages', '2026-08-11', '2026-08-22', 'active', 26, 'system');

-- ============================================================================
-- Sprint Tasks
-- ============================================================================

INSERT IGNORE INTO sprint_tasks (id, sprint_id, task_id, story_points)
VALUES
  ('demo-st-1', 'demo-spr-1', 'demo-t-3a', 8),
  ('demo-st-2', 'demo-spr-1', 'demo-t-3b', 8),
  ('demo-st-3', 'demo-spr-1', 'demo-t-4a', 5),
  ('demo-st-4', 'demo-spr-2', 'demo-t-3c', 13),
  ('demo-st-5', 'demo-spr-2', 'demo-t-3d', 8),
  ('demo-st-6', 'demo-spr-2', 'demo-t-4b', 5);

-- ============================================================================
-- RAID Log — Risks
-- ============================================================================

INSERT IGNORE INTO project_risks (
  id, project_id, type, title, description, category, severity, probability, impact,
  risk_score, status, mitigation_plan, owner_id, sequence_number, record_id, created_by
) VALUES
  ('demo-risk-1', 'demo-sample-webapp', 'risk',
   'Third-party API rate limits may degrade performance',
   'The payment gateway and email service APIs have strict rate limits that could cause timeouts during peak traffic. Current limits are 100 req/min for payment and 300 req/min for email.',
   'technical', 'medium', 3, 4, 12, 'monitoring',
   'Implement request queuing with exponential backoff. Set up monitoring alerts at 70% of rate limit threshold. Consider upgrading to enterprise API tier if needed.',
   NULL, 1, 'R-001', 'system'),
  ('demo-risk-2', 'demo-sample-webapp', 'risk',
   'Key developer unavailability during summer',
   'Lead full-stack developer has planned 2-week vacation in September, which overlaps with critical backend development phase. No backup resource with equivalent skills.',
   'resource', 'high', 4, 3, 12, 'mitigating',
   'Cross-train Alex Thompson on critical path components before vacation. Document all architectural decisions. Front-load critical work to complete before absence.',
   NULL, 2, 'R-002', 'system'),
  ('demo-risk-3', 'demo-sample-webapp', 'risk',
   'Browser compatibility issues with older versions',
   'Target browsers include IE11 and Safari 14 which may not support modern CSS features and JavaScript APIs used in the design system.',
   'technical', 'low', 2, 2, 4, 'open',
   'Add polyfills for critical APIs. Use Browserslist configuration to auto-detect compatibility issues. Test on BrowserStack during QA phase.',
   NULL, 3, 'R-003', 'system');

-- ============================================================================
-- RAID Log — Issues
-- ============================================================================

INSERT IGNORE INTO project_risks (
  id, project_id, type, title, description, category, severity, probability, impact,
  risk_score, status, mitigation_plan, owner_id, sequence_number, record_id, created_by
) VALUES
  ('demo-issue-1', 'demo-sample-webapp', 'issue',
   'Payment gateway sandbox intermittently unavailable',
   'The Stripe sandbox environment has experienced 3 outages in the past 2 weeks, each lasting 2-4 hours. This blocks integration testing and has caused 1.5 days of lost development time.',
   'technical', 'high', 5, 3, 15, 'open',
   'Set up a local mock payment service for development. Only use sandbox for final integration tests. Report reliability issues to Stripe support.',
   NULL, 1, 'I-001', 'system'),
  ('demo-issue-2', 'demo-sample-webapp', 'issue',
   'Design system inconsistency between mobile and desktop',
   'Button sizes, spacing, and typography do not follow the same scale on mobile vs desktop breakpoints. Discovered during sprint 1 review with 12 components affected.',
   'technical', 'medium', 4, 2, 8, 'resolved',
   'Rebuilt spacing scale with consistent rem-based values. Updated all affected components to use design tokens. Added visual regression tests.',
   NULL, 2, 'I-002', 'system');

-- ============================================================================
-- RAID Log — Actions
-- ============================================================================

INSERT IGNORE INTO project_risks (
  id, project_id, type, title, description, category, severity, probability, impact,
  risk_score, status, due_date, action_type, owner_id, sequence_number, record_id, created_by
) VALUES
  ('demo-action-1', 'demo-sample-webapp', 'action',
   'Set up automated performance regression tests',
   'Create a CI pipeline step that runs Lighthouse and k6 performance tests on every PR to catch performance regressions before they reach production.',
   'technical', 'medium', 3, 3, 9, 'in_progress', '2026-09-15', 'preventive',
   NULL, 1, 'A-001', 'system'),
  ('demo-action-2', 'demo-sample-webapp', 'action',
   'Create API rate limit monitoring dashboard',
   'Build a Grafana dashboard showing real-time API rate limit consumption for all third-party integrations, with alerts at 70% and 90% thresholds.',
   'technical', 'low', 2, 3, 6, 'completed', '2026-08-30', 'corrective',
   NULL, 2, 'A-002', 'system');

-- ============================================================================
-- RAID Log — Decisions
-- ============================================================================

INSERT IGNORE INTO project_risks (
  id, project_id, type, title, description, category, severity, probability, impact,
  risk_score, status, rationale, decided_by, decision_date, alternatives_considered,
  sequence_number, record_id, created_by
) VALUES
  ('demo-decision-1', 'demo-sample-webapp', 'decision',
   'Use React + TypeScript for frontend stack',
   'Selected React 18 with TypeScript as the primary frontend framework over Vue.js and Angular. Paired with Tailwind CSS for styling and Tanstack Query for server state.',
   'technical', 'high', 5, 4, 20, 'decided',
   'React has the largest ecosystem, best TypeScript support, and aligns with team expertise. Vue.js was considered but lacked mature TypeScript tooling. Angular was rejected due to steep learning curve and team preference.',
   'James Wilson', '2026-06-20',
   'Vue.js 3 with Composition API — good DX but smaller ecosystem\nAngular 17 — full-featured but heavyweight\nSvelte 4 — innovative but limited enterprise adoption',
   1, 'D-001', 'system');

-- ============================================================================
-- Budget / Expenses
-- ============================================================================

INSERT IGNORE INTO project_expenses (id, project_id, date, amount, category, vendor, description, created_by)
VALUES
  ('demo-exp-1', 'demo-sample-webapp', '2026-06-15', 15000.00, 'software', 'Amazon Web Services', 'AWS infrastructure (EC2, RDS, S3, CloudFront) — 6-month prepaid', 'system'),
  ('demo-exp-2', 'demo-sample-webapp', '2026-06-05', 2400.00, 'software', 'Figma', 'Figma Organization plan — annual license for design team', 'system'),
  ('demo-exp-3', 'demo-sample-webapp', '2026-07-01', 45000.00, 'contractors', 'TechBridge Consulting', 'API integration specialist — 3-month contract for payment and analytics', 'system'),
  ('demo-exp-4', 'demo-sample-webapp', '2026-06-10', 12000.00, 'hardware', 'Apple Inc.', 'MacBook Pro M3 workstations for 2 new developers', 'system'),
  ('demo-exp-5', 'demo-sample-webapp', '2026-06-20', 3500.00, 'training', 'React Advanced Workshop', 'Team training on React Server Components and performance optimization', 'system'),
  ('demo-exp-6', 'demo-sample-webapp', '2026-07-15', 8600.00, 'software', 'Vercel', 'Vercel Pro hosting plan with edge functions — annual', 'system'),
  ('demo-exp-7', 'demo-sample-webapp', '2026-08-05', 4200.00, 'travel', 'Various', 'Client meetings in Vancouver (flights, hotel, meals) — 2 trips', 'system'),
  ('demo-exp-8', 'demo-sample-webapp', '2026-08-20', 1800.00, 'software', 'GitHub', 'GitHub Enterprise — annual team license', 'system'),
  ('demo-exp-9', 'demo-sample-webapp', '2026-07-10', 5000.00, 'consulting', 'SecurityFirst Inc.', 'Security audit and penetration testing — initial assessment', 'system'),
  ('demo-exp-10', 'demo-sample-webapp', '2026-08-01', 15000.00, 'labor', 'Internal', 'Overtime hours for sprint 1 deadline push — 4 team members', 'system');

-- ============================================================================
-- Lessons Learned
-- ============================================================================

INSERT IGNORE INTO lessons_learned (
  id, project_id, project_name, project_type, category, title, description,
  impact, recommendation, root_cause, severity, confidence, status, source_type,
  recurrence_score, is_elevated, created_by
) VALUES
  ('demo-ll-1', 'demo-sample-webapp', 'Sample Web App Development', 'it', 'schedule',
   'Early user research prevented 3 weeks of rework',
   'Conducting user research in the first sprint identified 4 critical usability issues with the original navigation design. Fixing these before development started saved an estimated 3 weeks of rework and $18,000 in development costs.',
   'positive', 'Always allocate at least 1 week for user research before design begins. Create testable prototypes early and validate with real users.',
   'Initial designs were based on assumptions rather than user data', 'medium', 90, 'approved', 'manual', 0, 0, 'system'),
  ('demo-ll-2', 'demo-sample-webapp', 'Sample Web App Development', 'it', 'technical',
   'Underestimated third-party API integration complexity',
   'Payment gateway integration took 2.5x longer than estimated due to undocumented edge cases, sandbox environment instability, and complex error handling requirements. The original 2-week estimate became 5 weeks.',
   'negative', 'Add a 100% buffer to all third-party integration estimates. Conduct a spike/proof-of-concept for each integration before committing to a timeline.',
   'Estimates were based on API documentation quality which did not reflect real-world complexity', 'high', 85, 'approved', 'manual', 25, 0, 'system'),
  ('demo-ll-3', 'demo-sample-webapp', 'Sample Web App Development', 'it', 'communication',
   'Daily standups improved cross-team coordination',
   'Introducing 15-minute daily standups between frontend and backend teams eliminated 80% of blocked tasks. Previously, developers would wait hours or days for answers that took 2 minutes in person.',
   'positive', 'Maintain daily standups even when teams are small. Use async standup tools for distributed team members.',
   NULL, 'low', 75, 'approved', 'manual', 0, 0, 'system'),
  ('demo-ll-4', 'demo-sample-webapp', 'Sample Web App Development', 'it', 'quality',
   'Component library reduced UI bugs by 60%',
   'Building a shared component library with Storybook documentation before feature development reduced UI-related bugs by 60% compared to previous projects. Consistent styling and behavior across all pages.',
   'positive', 'Invest in a design system and component library before building features. Include visual regression testing in CI.',
   NULL, NULL, 80, 'approved', 'manual', 50, 1, 'system');

-- ============================================================================
-- Change Requests
-- ============================================================================

INSERT IGNORE INTO change_requests (
  id, project_id, title, description, category, priority, impact_summary, status,
  requested_by, created_at
) VALUES
  ('demo-cr-1', 'demo-sample-webapp',
   'Add dark mode support',
   'Users and stakeholders have requested dark mode support for the application. This requires extending the design system with dark color tokens, updating all components to support theme switching, and adding a user preference toggle.',
   'scope', 'medium',
   'Schedule: +5 days to frontend development phase\nBudget: +$8,500 (design + implementation)\nResources: Maria Garcia (2 days design) + James Wilson (3 days implementation)',
   'approved', 'system', '2026-08-10 10:30:00'),
  ('demo-cr-2', 'demo-sample-webapp',
   'Expand OAuth providers beyond Google',
   'Add support for GitHub, Microsoft, and Apple sign-in in addition to Google OAuth. Marketing team believes this will increase sign-up conversion by 15-20%.',
   'scope', 'low',
   'Schedule: +3 days to auth development\nBudget: +$4,200 (development + testing)\nResources: Alex Thompson (3 days)',
   'submitted', 'system', '2026-08-25 14:15:00');

-- ============================================================================
-- Meetings
-- ============================================================================

INSERT IGNORE INTO meetings (
  id, project_id, title, meeting_type, scheduled_date, duration_minutes, location,
  attendees, agenda_items, notes, status, created_by
) VALUES
  ('demo-mtg-1', 'demo-sample-webapp',
   'Project Kickoff',
   'kickoff', '2026-06-02 09:00:00', 90, 'Main Boardroom / Zoom',
   '[{"name":"Sarah Chen","role":"Product Manager"},{"name":"James Wilson","role":"Lead Developer"},{"name":"Maria Garcia","role":"UX Designer"},{"name":"Alex Thompson","role":"Backend Dev"},{"name":"Priya Patel","role":"QA Engineer"},{"name":"David Park","role":"VP Engineering"}]',
   '[{"title":"Project overview and objectives","duration":15,"presenter":"Sarah Chen"},{"title":"Technical architecture walkthrough","duration":20,"presenter":"James Wilson"},{"title":"Design approach and timeline","duration":15,"presenter":"Maria Garcia"},{"title":"Risk assessment and mitigation","duration":15,"presenter":"Sarah Chen"},{"title":"Q&A and next steps","duration":25}]',
   'Kickoff meeting completed successfully. All team members aligned on project goals and timeline. Key decisions: hybrid methodology, 2-week sprints, daily standups at 9:30 AM. VP Engineering approved budget allocation.',
   'completed', 'system'),
  ('demo-mtg-2', 'demo-sample-webapp',
   'Sprint 1 Review & Retrospective',
   'sprint_review', '2026-08-08 14:00:00', 60, 'Team Room B / Zoom',
   '[{"name":"Sarah Chen","role":"Product Manager"},{"name":"James Wilson","role":"Lead Developer"},{"name":"Maria Garcia","role":"UX Designer"},{"name":"Alex Thompson","role":"Backend Dev"}]',
   '[{"title":"Sprint 1 demo — API docs and database schema","duration":20,"presenter":"James Wilson"},{"title":"Component library walkthrough","duration":15,"presenter":"Maria Garcia"},{"title":"Sprint metrics review","duration":10,"presenter":"Sarah Chen"},{"title":"Retrospective","duration":15}]',
   'Sprint 1 velocity: 21 points completed. All committed stories delivered. Retrospective highlights: API documentation approach worked well, database migration process needs improvement, component library exceeded expectations.',
   'completed', 'system'),
  ('demo-mtg-3', 'demo-sample-webapp',
   'Architecture Decision — State Management',
   'ad_hoc', '2026-08-15 11:00:00', 45, 'Zoom',
   '[{"name":"James Wilson","role":"Lead Developer"},{"name":"Alex Thompson","role":"Backend Dev"}]',
   '[{"title":"Evaluate state management options","duration":15,"presenter":"James Wilson"},{"title":"Performance benchmarks","duration":15,"presenter":"Alex Thompson"},{"title":"Decision and rationale","duration":15}]',
   'Decided to use Zustand for client state and TanStack Query for server state. Redux was considered but deemed too verbose for the project scope. Jotai was a close second but Zustand had better DevTools support.',
   'completed', 'system');

-- ============================================================================
-- Meeting Action Items
-- ============================================================================

INSERT IGNORE INTO meeting_action_items (
  id, meeting_id, project_id, description, assignee_name, due_date, priority,
  status, created_by
) VALUES
  ('demo-mai-1', 'demo-mtg-1', 'demo-sample-webapp',
   'Finalize API documentation standards and set up Swagger/OpenAPI tooling',
   'James Wilson', '2026-06-10', 'high', 'completed', 'system'),
  ('demo-mai-2', 'demo-mtg-1', 'demo-sample-webapp',
   'Research OAuth provider options and prepare comparison matrix',
   'Alex Thompson', '2026-06-15', 'medium', 'completed', 'system'),
  ('demo-mai-3', 'demo-mtg-1', 'demo-sample-webapp',
   'Schedule security audit with external firm for September',
   'Sarah Chen', '2026-06-20', 'medium', 'completed', 'system'),
  ('demo-mai-4', 'demo-mtg-2', 'demo-sample-webapp',
   'Improve database migration rollback procedures',
   'Alex Thompson', '2026-08-15', 'high', 'in_progress', 'system'),
  ('demo-mai-5', 'demo-mtg-2', 'demo-sample-webapp',
   'Create component library contribution guidelines',
   'Maria Garcia', '2026-08-20', 'low', 'open', 'system'),
  ('demo-mai-6', 'demo-mtg-3', 'demo-sample-webapp',
   'Set up Zustand DevTools and create state management documentation',
   'James Wilson', '2026-08-22', 'medium', 'open', 'system');

-- ============================================================================
-- Goals / OKRs
-- ============================================================================

INSERT IGNORE INTO goals (
  id, name, description, owner_id, parent_id, goal_type, status, progress,
  target_value, current_value, unit, start_date, due_date, project_id
) VALUES
  ('demo-goal-obj',
   'Launch MVP by November 30, 2026',
   'Launch a fully functional minimum viable product with all core user flows, meeting performance and quality standards',
   'system', NULL, 'objective', 'on_track', 45,
   NULL, NULL, NULL, '2026-06-01', '2026-11-30', 'demo-sample-webapp'),
  ('demo-goal-kr1',
   'Complete all 5 core user flows',
   'Implement and test registration, onboarding, dashboard, content management, and settings flows end-to-end',
   'system', 'demo-goal-obj', 'key_result', 'on_track', 60,
   5, 3, 'flows', '2026-06-01', '2026-10-30', 'demo-sample-webapp'),
  ('demo-goal-kr2',
   'Achieve 90%+ automated test coverage',
   'Unit, integration, and E2E test coverage across all critical paths',
   'system', 'demo-goal-obj', 'key_result', 'at_risk', 35,
   90, 31.5, 'percent', '2026-06-01', '2026-10-30', 'demo-sample-webapp'),
  ('demo-goal-kr3',
   'API response time under 200ms (p95)',
   'All API endpoints respond within 200ms at the 95th percentile under load',
   'system', 'demo-goal-obj', 'key_result', 'on_track', 80,
   200, 160, 'ms', '2026-06-01', '2026-10-30', 'demo-sample-webapp');

-- ============================================================================
-- Standup Entries
-- ============================================================================

INSERT IGNORE INTO standup_entries (
  id, sprint_id, project_id, user_id, entry_date, yesterday, today, blockers
) VALUES
  ('demo-su-1', 'demo-spr-2', 'demo-sample-webapp', 'system', '2026-08-18',
   'Completed authentication JWT flow and password reset endpoint',
   'Working on role-based access control middleware and permission checks',
   '["Waiting on final RBAC matrix from Sarah — needed to define permission levels"]'),
  ('demo-su-2', 'demo-spr-2', 'demo-sample-webapp', 'system', '2026-08-18',
   'Finished core pages layout and navigation components',
   'Implementing dashboard data fetching and chart components',
   '[]'),
  ('demo-su-3', 'demo-spr-2', 'demo-sample-webapp', 'system', '2026-08-19',
   'Completed RBAC middleware — all 5 role levels working',
   'Starting session management and token refresh logic',
   '[]');

-- ============================================================================
-- Retrospective Items
-- ============================================================================

INSERT IGNORE INTO retrospective_items (
  id, sprint_id, project_id, category, content, created_by, vote_count
) VALUES
  ('demo-retro-1', 'demo-spr-1', 'demo-sample-webapp', 'went_well',
   'API documentation-first approach caught 8 design issues before any code was written', 'system', 4),
  ('demo-retro-2', 'demo-spr-1', 'demo-sample-webapp', 'went_well',
   'Component library with Storybook made frontend development 30% faster', 'system', 3),
  ('demo-retro-3', 'demo-spr-1', 'demo-sample-webapp', 'to_improve',
   'Database migration rollback process is manual and error-prone — need automated rollback scripts', 'system', 5),
  ('demo-retro-4', 'demo-spr-1', 'demo-sample-webapp', 'to_improve',
   'Code review turnaround time averaged 2 days — target should be under 4 hours', 'system', 2),
  ('demo-retro-5', 'demo-spr-1', 'demo-sample-webapp', 'action_item',
   'Set up automated PR size alerts — flag PRs over 400 lines for splitting', 'system', 3);

-- ============================================================================
-- Time Entries
-- ============================================================================

INSERT IGNORE INTO time_entries (id, task_id, schedule_id, project_id, user_id, date, hours, description, billable)
VALUES
  ('demo-te-1',  'demo-t-1a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-02', 6.0, 'Stakeholder interview preparation and scheduling', TRUE),
  ('demo-te-2',  'demo-t-1a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-03', 8.0, 'Conducted 4 stakeholder interviews', TRUE),
  ('demo-te-3',  'demo-t-1a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-04', 7.5, 'Requirements documentation and prioritization', TRUE),
  ('demo-te-4',  'demo-t-1b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-05', 8.0, 'User research planning and participant recruitment', TRUE),
  ('demo-te-5',  'demo-t-1b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-09', 7.0, 'Conducted 5 user interviews', TRUE),
  ('demo-te-6',  'demo-t-1b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-10', 6.5, 'Persona development and journey mapping', TRUE),
  ('demo-te-7',  'demo-t-1c', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-12', 8.0, 'Architecture research and technology evaluation', TRUE),
  ('demo-te-8',  'demo-t-1c', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-06-16', 7.5, 'Architecture document drafting', TRUE),
  ('demo-te-9',  'demo-t-2a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-01', 8.0, 'Low-fidelity wireframes for dashboard and onboarding', TRUE),
  ('demo-te-10', 'demo-t-2a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-03', 7.5, 'High-fidelity prototypes in Figma', TRUE),
  ('demo-te-11', 'demo-t-2b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-08', 8.0, 'Design token definition and color system', TRUE),
  ('demo-te-12', 'demo-t-2b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-10', 6.0, 'Typography scale and component specifications', TRUE),
  ('demo-te-13', 'demo-t-3a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-28', 8.0, 'OpenAPI 3.1 specification — auth and user endpoints', TRUE),
  ('demo-te-14', 'demo-t-3a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-07-30', 7.5, 'OpenAPI specification — content and settings endpoints', TRUE),
  ('demo-te-15', 'demo-t-3b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-04', 8.0, 'Database schema design and ERD', TRUE),
  ('demo-te-16', 'demo-t-3b', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-06', 7.0, 'Migration scripts and seed data', TRUE),
  ('demo-te-17', 'demo-t-3c', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-11', 8.0, 'User CRUD endpoints and validation', TRUE),
  ('demo-te-18', 'demo-t-3c', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-14', 7.5, 'Content management API and file upload', TRUE),
  ('demo-te-19', 'demo-t-4a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-12', 8.0, 'Storybook setup and Button/Input components', TRUE),
  ('demo-te-20', 'demo-t-4a', 'demo-sch-1', 'demo-sample-webapp', 'system', '2026-08-15', 7.0, 'Modal, Table, and Form components', TRUE);

-- ============================================================================
-- What-If Scenario Analyses
-- ============================================================================

INSERT IGNORE INTO scenario_analyses (
  id, project_id, user_id, scenario_text, parameters, result, ai_powered, confidence
) VALUES
  ('demo-scenario-1', 'demo-sample-webapp', 0,
   'What if we add a mobile app to the MVP scope?',
   '{"additionalTasks":8,"additionalDays":45,"additionalBudget":85000,"additionalResources":["React Native Developer"]}',
   '{"impactSummary":"Adding a mobile app would extend the project by 45 days and increase budget by $85,000. The launch date would shift from November 30 to mid-January 2027. Recommended approach: launch web MVP first, then build mobile in Phase 2.","scheduleImpact":"High — 45 additional days","budgetImpact":"$85,000 increase (34% over original budget)","riskImpact":"Medium — adds React Native expertise dependency","recommendation":"Defer to Phase 2 after web MVP launch"}',
   TRUE, 0.78),
  ('demo-scenario-2', 'demo-sample-webapp', 0,
   'What if the lead developer leaves the project?',
   '{"removedResource":"James Wilson","replacementTimeDays":21,"knowledgeTransferDays":10,"productivityLoss":0.3}',
   '{"impactSummary":"Losing the lead developer would delay the project by 4-6 weeks. The 3-week hiring process plus 2-week knowledge transfer would create a critical gap during backend development. Budget impact: $35,000 in recruitment and ramp-up costs.","scheduleImpact":"High — 4-6 week delay","budgetImpact":"$35,000 recruitment and ramp-up","riskImpact":"Critical — single point of failure for architecture decisions","recommendation":"Immediate cross-training of Alex Thompson on critical components. Document all architectural decisions. Consider hiring a second senior developer as backup."}',
   TRUE, 0.72);

-- ============================================================================
-- Schedule Baseline
-- ============================================================================

INSERT IGNORE INTO schedule_baselines (id, schedule_id, name, created_by)
VALUES ('demo-bl-1', 'demo-sch-1', 'Original Plan Baseline', 'system');

INSERT IGNORE INTO baseline_tasks (id, baseline_id, task_id, name, start_date, end_date, estimated_days, progress_percentage, status)
VALUES
  ('demo-blt-1',  'demo-bl-1', 'demo-t-p1', 'Phase 1: Discovery & Planning', '2026-06-01', '2026-06-27', 20, 0, 'pending'),
  ('demo-blt-2',  'demo-bl-1', 'demo-t-p2', 'Phase 2: UX/UI Design',         '2026-06-30', '2026-07-25', 20, 0, 'pending'),
  ('demo-blt-3',  'demo-bl-1', 'demo-t-p3', 'Phase 3: Backend Development',   '2026-07-28', '2026-09-12', 35, 0, 'pending'),
  ('demo-blt-4',  'demo-bl-1', 'demo-t-p4', 'Phase 4: Frontend Development',  '2026-08-11', '2026-09-19', 30, 0, 'pending'),
  ('demo-blt-5',  'demo-bl-1', 'demo-t-p5', 'Phase 5: Testing & QA',          '2026-09-22', '2026-10-24', 25, 0, 'pending'),
  ('demo-blt-6',  'demo-bl-1', 'demo-t-p6', 'Phase 6: Launch & Monitoring',   '2026-10-27', '2026-11-21', 18, 0, 'pending');

-- ============================================================================
-- Custom Fields
-- ============================================================================

INSERT IGNORE INTO custom_fields (id, project_id, entity_type, field_name, field_label, field_type, options, is_required, sort_order, created_by)
VALUES
  ('demo-cf-1', 'demo-sample-webapp', 'task', 'client_priority', 'Client Priority', 'select', '["Must Have","Should Have","Nice to Have","Will Not Have"]', FALSE, 1, 'system'),
  ('demo-cf-2', 'demo-sample-webapp', 'task', 'story_category', 'Story Category', 'select', '["Feature","Enhancement","Tech Debt","Infrastructure"]', FALSE, 2, 'system');

-- ============================================================================
-- Custom Field Values
-- ============================================================================

INSERT IGNORE INTO custom_field_values (id, field_id, entity_id, value_text)
VALUES
  ('demo-cfv-1', 'demo-cf-1', 'demo-t-3c', 'Must Have'),
  ('demo-cfv-2', 'demo-cf-1', 'demo-t-3d', 'Must Have'),
  ('demo-cfv-3', 'demo-cf-1', 'demo-t-4b', 'Should Have'),
  ('demo-cfv-4', 'demo-cf-1', 'demo-t-4c', 'Nice to Have'),
  ('demo-cfv-5', 'demo-cf-2', 'demo-t-3c', 'Feature'),
  ('demo-cfv-6', 'demo-cf-2', 'demo-t-3d', 'Infrastructure'),
  ('demo-cfv-7', 'demo-cf-2', 'demo-t-4a', 'Tech Debt');

-- ============================================================================
-- Resource Availability (vacation/unavailability)
-- ============================================================================

INSERT IGNORE INTO resource_availability (id, resource_id, date_from, date_to, type, hours_available, note)
VALUES
  ('demo-ra-1', 'demo-res-2', '2026-09-08', '2026-09-19', 'vacation', 0, 'Summer vacation — 2 weeks'),
  ('demo-ra-2', 'demo-res-3', '2026-09-01', '2026-09-01', 'holiday', 0, 'Labour Day'),
  ('demo-ra-3', 'demo-res-5', '2026-10-20', '2026-10-23', 'reduced', 4, 'Conference attendance — half days');
