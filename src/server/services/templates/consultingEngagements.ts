import { ProjectTemplate } from '../../schemas/templateSchemas';

/**
 * Engagement scaffolds for a PM consultant.
 *
 * These replace the generic starters a new account used to receive — Software
 * Development, Marketing Campaign, Event Planning and so on. Those describe internal
 * projects at an ordinary company, which is not who this product is for. A consultant
 * does not run a marketing campaign; they run an engagement for a client, against a
 * contract, reporting to a steering committee.
 *
 * Each one produces the whole scaffold rather than a task list: phases and gates, the
 * risks and assumptions a consultant would raise on day one, and the report cadence the
 * client will expect. The point is that applying one leaves you ready to run the
 * engagement, not staring at a list of tasks with the governance still to remember.
 *
 * The shapes follow how these engagements actually run — a gate at the end of each
 * stage, payment and acceptance tied to deliverables, and a hypercare period after
 * go-live rather than a cliff edge at handover.
 */

/**
 * The most common shape: a consultant implementing a vendor system for a client, with
 * staged acceptance. Modelled on a real engagement — study, design sign-off, build,
 * integration testing, client acceptance testing, go-live, hypercare — with a gate at
 * each acceptance point because that is usually where payment sits.
 */
const systemsImplementation: ProjectTemplate = {
  id: 'tpl-eng-implementation',
  name: 'System Implementation Engagement',
  description:
    'Implementing a vendor system for a client with staged acceptance: discovery and gap analysis, design sign-off, configuration, integration and user acceptance testing, go-live and hypercare. Gates at each acceptance point.',
  projectType: 'it',
  category: 'engagement',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 300,
  tags: ['engagement', 'implementation', 'client-delivery'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    // ── Inception ──
    { refId: 'inc', name: 'Inception', description: 'Mobilise, agree governance, baseline the plan', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'inc-kickoff', name: 'Kick-off and governance setup', description: 'Steering committee, RACI, reporting cadence, escalation route', estimatedDays: 5, priority: 'high', parentRefId: 'inc', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'inc-review', name: 'Desk review of existing documentation', description: 'Contract, requirements, any prior work', estimatedDays: 5, priority: 'medium', parentRefId: 'inc', dependencyRefId: 'inc-kickoff', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false },
    { refId: 'inc-plan', name: 'Inception report and baselined plan', description: 'The deliverable the first gate accepts', estimatedDays: 10, priority: 'high', parentRefId: 'inc', dependencyRefId: 'inc-review', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'gate1', name: 'Gate 1 — Inception accepted', description: 'Client signs off the plan and approach. Usually a payment milestone.', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'inc-plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },

    // ── Study and design ──
    { refId: 'des', name: 'Study and design', description: 'Understand the current state, specify the target', estimatedDays: 60, priority: 'high', parentRefId: null, dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'des-study', name: 'Detailed system study and gap analysis', description: 'Current process against system capability', estimatedDays: 25, priority: 'high', parentRefId: 'des', dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'des-spec', name: 'Solution design specification', description: 'Configuration, integrations, data model, reports', estimatedDays: 25, priority: 'high', parentRefId: 'des', dependencyRefId: 'des-study', dependencyType: 'FS', offsetDays: 0, skills: ['architecture'], isSummary: false, mandatory: true },
    { refId: 'des-signoff', name: 'Design walkthrough with the client', description: 'Walk the client through it before building anything. The acceptance itself is Gate 2.', estimatedDays: 10, priority: 'high', parentRefId: 'des', dependencyRefId: 'des-spec', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false },
    { refId: 'gate2', name: 'Gate 2 — Design accepted', description: 'Design signed off. Changes after this point are change requests.', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'des-signoff', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },

    // ── Build ──
    { refId: 'bld', name: 'Configuration and build', description: 'Configure the system, build integrations, prepare data', estimatedDays: 90, priority: 'high', parentRefId: null, dependencyRefId: 'gate2', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'bld-env', name: 'Environment setup', description: 'Development, test and production environments', estimatedDays: 10, priority: 'high', parentRefId: 'bld', dependencyRefId: 'gate2', dependencyType: 'FS', offsetDays: 0, skills: ['infrastructure'], isSummary: false },
    { refId: 'bld-config', name: 'Core configuration', description: 'Modules, workflows, permissions, reference data', estimatedDays: 40, priority: 'high', parentRefId: 'bld', dependencyRefId: 'bld-env', dependencyType: 'FS', offsetDays: 0, skills: ['configuration'], isSummary: false, mandatory: true },
    { refId: 'bld-integ', name: 'Integrations', description: 'Interfaces to the client\'s other systems', estimatedDays: 30, priority: 'high', parentRefId: 'bld', dependencyRefId: 'bld-config', dependencyType: 'SS', offsetDays: 15, skills: ['integration'], isSummary: false },
    { refId: 'bld-data', name: 'Data migration preparation and trial run', description: 'Extract, cleanse, map, then a rehearsal load', estimatedDays: 25, priority: 'high', parentRefId: 'bld', dependencyRefId: 'bld-config', dependencyType: 'SS', offsetDays: 20, skills: ['data-migration'], isSummary: false, mandatory: true },

    // ── Testing ──
    { refId: 'tst', name: 'Testing', description: 'Prove it works, then prove it to the client', estimatedDays: 60, priority: 'high', parentRefId: null, dependencyRefId: 'bld', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'tst-plan', name: 'Test plan and scripts agreed', description: 'Agree what "working" means before testing starts', estimatedDays: 10, priority: 'high', parentRefId: 'tst', dependencyRefId: 'bld-config', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false, mandatory: true },
    { refId: 'tst-sit', name: 'System integration testing', description: 'End to end across the integrated systems', estimatedDays: 20, priority: 'high', parentRefId: 'tst', dependencyRefId: 'tst-plan', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false, mandatory: true },
    { refId: 'tst-fix', name: 'Defect remediation and regression', description: 'Fix what testing found, then retest around it', estimatedDays: 15, priority: 'high', parentRefId: 'tst', dependencyRefId: 'tst-sit', dependencyType: 'FS', offsetDays: 0, skills: ['configuration'], isSummary: false },
    { refId: 'tst-uat', name: 'Client user acceptance testing', description: 'The client tests it against their own scripts, using migrated data', estimatedDays: 20, priority: 'urgent', parentRefId: 'tst', dependencyRefId: 'tst-fix', dependencyType: 'FS', offsetDays: 0, skills: ['testing'], isSummary: false, mandatory: true },
    { refId: 'tst-data-ready', name: 'Migrated data verified in the test environment', description: 'Acceptance testing is meaningless against dummy data. Ties the migration work into testing.', estimatedDays: 5, priority: 'high', parentRefId: 'tst', dependencyRefId: 'bld-data', dependencyType: 'FS', offsetDays: 0, skills: ['data-migration'], isSummary: false, mandatory: true },
    { refId: 'gate3', name: 'Gate 3 — Acceptance testing signed off', description: 'Client accepts the system as fit for go-live', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'tst-uat', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },

    // ── Go-live ──
    { refId: 'glv', name: 'Go-live and transition', description: 'Cut over, then support the client through settling in', estimatedDays: 45, priority: 'urgent', parentRefId: null, dependencyRefId: 'gate3', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'glv-train', name: 'Training and user manuals', description: 'Train the users, hand over the documentation', estimatedDays: 15, priority: 'high', parentRefId: 'glv', dependencyRefId: 'gate3', dependencyType: 'SS', offsetDays: 0, skills: ['training'], isSummary: false, mandatory: true },
    { refId: 'glv-cut', name: 'Production cutover', description: 'Final data load and switch over. Users must be trained first.', estimatedDays: 5, priority: 'urgent', parentRefId: 'glv', dependencyRefId: 'glv-train', dependencyType: 'FS', offsetDays: 0, skills: ['configuration'], isSummary: false, mandatory: true },
    { refId: 'glv-hyper', name: 'Hypercare', description: 'Elevated support while the client settles in. Do not skip this.', estimatedDays: 20, priority: 'high', parentRefId: 'glv', dependencyRefId: 'glv-cut', dependencyType: 'FS', offsetDays: 0, skills: ['support'], isSummary: false, mandatory: true },
    { refId: 'glv-close', name: 'Knowledge transfer and formal closure', description: 'Handover, lessons learned, final acceptance', estimatedDays: 10, priority: 'high', parentRefId: 'glv', dependencyRefId: 'glv-hyper', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'gate4', name: 'Gate 4 — Engagement closed', description: 'Final acceptance and final invoice', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'glv-close', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
  ],
  raidItems: [
    { type: 'assumption', title: 'Client subject matter experts are available as agreed', description: 'The single most common cause of slippage on this kind of engagement. Record the agreed availability and raise it the moment it slips.' },
    { type: 'assumption', title: 'Source data is of usable quality', description: 'Migration estimates assume the data can be cleansed within the planned effort. Confirm after the trial load, not before.' },
    { type: 'risk', title: 'Scope creep after design sign-off', description: 'Changes requested after Gate 2 land on the critical path. Route them through change control rather than absorbing them.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Acceptance testing finds defects late', description: 'The client tests last and their findings are hardest to absorb. Keep contingency between acceptance testing and go-live.', probability: 'medium', impact: 'high' },
    { type: 'dependency', title: 'Third-party system owners must provide interface specifications', description: 'Integration work cannot start without them, and they are outside your control.' },
    { type: 'action', title: 'Confirm the invoicing milestones match the gates', description: 'Do this in week one. Gates that do not line up with payment terms cause arguments later.' },
  ],
  reportCadence: {
    frequency: 'weekly',
    dayOfWeek: 5,
    description: 'Weekly status report to the client, issued Friday: progress against plan, what is coming, risks and issues needing their decision.',
  },
};

/**
 * A short, fixed-price piece of work producing a recommendation. Deliberately small:
 * the risk on these is scope, not schedule.
 */
const discoveryAssessment: ProjectTemplate = {
  id: 'tpl-eng-discovery',
  name: 'Discovery and Assessment Engagement',
  description:
    'A short diagnostic engagement producing findings and a recommendation: mobilise, gather evidence, analyse, report and present. Fixed scope, fixed price.',
  projectType: 'other',
  category: 'engagement',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 45,
  tags: ['engagement', 'discovery', 'assessment', 'advisory'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'mob', name: 'Mobilisation', description: 'Agree scope, access and who we need to speak to', estimatedDays: 5, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'ev', name: 'Evidence gathering', description: 'Interviews, documents, data', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: 'mob', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'ev-int', name: 'Stakeholder interviews', description: 'Structured interviews across the affected areas', estimatedDays: 12, priority: 'high', parentRefId: 'ev', dependencyRefId: 'mob', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'ev-doc', name: 'Document and data review', description: 'What the organisation already has written down', estimatedDays: 8, priority: 'medium', parentRefId: 'ev', dependencyRefId: 'mob', dependencyType: 'SS', offsetDays: 3, skills: ['business-analysis'], isSummary: false },
    { refId: 'an', name: 'Analysis and options', description: 'Findings, options, a recommendation', estimatedDays: 12, priority: 'high', parentRefId: null, dependencyRefId: 'ev', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'rep', name: 'Draft report and client review', description: 'Share the draft before the final. No surprises at the presentation.', estimatedDays: 8, priority: 'high', parentRefId: null, dependencyRefId: 'an', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, mandatory: true },
    { refId: 'pres', name: 'Final report and presentation', description: 'Present findings and the recommendation to the decision makers', estimatedDays: 5, priority: 'urgent', parentRefId: null, dependencyRefId: 'rep', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, mandatory: true },
    { refId: 'gate1', name: 'Gate — Report accepted', description: 'Deliverable accepted and invoiced', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'pres', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
  ],
  raidItems: [
    { type: 'assumption', title: 'Interviewees can be scheduled within the engagement window', description: 'A short engagement has no slack. Diary availability is the usual cause of overrun.' },
    { type: 'risk', title: 'Findings are unwelcome', description: 'A diagnostic often concludes something the sponsor did not want to hear. Share the draft early rather than at the presentation.', probability: 'medium', impact: 'medium' },
    { type: 'risk', title: 'Scope widens during interviews', description: 'Each conversation suggests another area to look at. Hold the agreed scope and log the rest as further work.', probability: 'high', impact: 'medium' },
    { type: 'action', title: 'Agree in writing who receives the report', description: 'Distribution disputes after the fact are avoidable.' },
  ],
  reportCadence: {
    frequency: 'weekly',
    dayOfWeek: 5,
    description: 'Short weekly note: who we have spoken to, what is emerging, anything blocking access.',
  },
};

/**
 * Improving how a client works rather than delivering a system. The distinctive risk is
 * that the change does not stick once the consultant leaves, so measurement and
 * embedding are explicit phases rather than afterthoughts.
 */
const processImprovement: ProjectTemplate = {
  id: 'tpl-eng-process',
  name: 'Process Improvement Engagement',
  description:
    'Improving how a client works: baseline the current process, design the improved one, pilot it, then embed it. Includes measurement so the benefit can be evidenced.',
  projectType: 'other',
  category: 'engagement',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 120,
  tags: ['engagement', 'process', 'change', 'advisory'],
  usageCount: 0,
  defaultMethodology: 'hybrid',
  tasks: [
    { refId: 'mob', name: 'Mobilisation and scope confirmation', description: 'Which processes, whose, and what success looks like', estimatedDays: 5, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'base', name: 'Baseline the current process', description: 'Map it as it actually runs, and measure it', estimatedDays: 25, priority: 'high', parentRefId: null, dependencyRefId: 'mob', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'base-map', name: 'Process mapping with the people who do the work', description: 'As-is, not as documented', estimatedDays: 15, priority: 'high', parentRefId: 'base', dependencyRefId: 'mob', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'base-meas', name: 'Baseline measurement', description: 'Cycle time, effort, error rate. Without this there is no evidence of benefit.', estimatedDays: 10, priority: 'high', parentRefId: 'base', dependencyRefId: 'base-map', dependencyType: 'FS', offsetDays: 0, skills: ['analysis'], isSummary: false, mandatory: true },
    { refId: 'gate1', name: 'Gate — Baseline agreed', description: 'Client agrees the current state and the measures', estimatedDays: 1, priority: 'high', parentRefId: null, dependencyRefId: 'base-meas', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
    { refId: 'des', name: 'Design the improved process', description: 'Target process, controls, roles', estimatedDays: 25, priority: 'high', parentRefId: null, dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 0, skills: ['business-analysis'], isSummary: false, mandatory: true },
    { refId: 'pilot', name: 'Pilot', description: 'Run it for real in one area before rolling it out', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'des', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'pilot-run', name: 'Run the pilot', description: 'One team, one area, real work', estimatedDays: 20, priority: 'high', parentRefId: 'pilot', dependencyRefId: 'des', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, mandatory: true },
    { refId: 'pilot-meas', name: 'Measure the pilot against the baseline', description: 'The evidence the benefit is real', estimatedDays: 10, priority: 'high', parentRefId: 'pilot', dependencyRefId: 'pilot-run', dependencyType: 'FS', offsetDays: 0, skills: ['analysis'], isSummary: false, mandatory: true },
    { refId: 'gate2', name: 'Gate — Pilot accepted, roll-out approved', description: 'Decision point on whether to roll out', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'pilot-meas', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
    { refId: 'emb', name: 'Roll out and embed', description: 'Train, document, hand over ownership', estimatedDays: 30, priority: 'high', parentRefId: null, dependencyRefId: 'gate2', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'emb-train', name: 'Train and document', description: 'Procedures the client owns afterwards', estimatedDays: 15, priority: 'high', parentRefId: 'emb', dependencyRefId: 'gate2', dependencyType: 'FS', offsetDays: 0, skills: ['training'], isSummary: false, mandatory: true },
    { refId: 'emb-own', name: 'Transfer ownership', description: 'A named owner inside the client, not the consultant', estimatedDays: 10, priority: 'high', parentRefId: 'emb', dependencyRefId: 'emb-train', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, mandatory: true },
    { refId: 'gate3', name: 'Gate — Engagement closed', description: 'Benefit evidenced, ownership transferred', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'emb-own', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
  ],
  raidItems: [
    { type: 'risk', title: 'The change does not stick after we leave', description: 'The defining risk of this kind of work. Ownership must sit with a named person inside the client before closure.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Staff resist a process that changes their role', description: 'Involve the people who do the work in the design rather than presenting it to them.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Baseline data can be measured', description: 'If the current process is not measured, the benefit cannot be evidenced. Confirm measurability in week one.' },
    { type: 'dependency', title: 'The pilot area is released from other change initiatives', description: 'Competing change in the same team makes the measurement meaningless.' },
  ],
  reportCadence: {
    frequency: 'biweekly',
    dayOfWeek: 5,
    description: 'Fortnightly progress note against the baseline measures, plus anything needing a sponsor decision.',
  },
};

/**
 * The consultant is the PM on someone else's delivery. There are no build tasks — the
 * work is governance, reporting and control — so the plan is a cadence rather than a
 * sequence.
 */
const pmoSupport: ProjectTemplate = {
  id: 'tpl-eng-pmo',
  name: 'PMO / Project Management Support Engagement',
  description:
    'Providing project management to a client delivery: establish governance and controls, then run the reporting, risk and change cadence for the duration. For when you are the PM rather than the builder.',
  projectType: 'other',
  category: 'engagement',
  isBuiltIn: true,
  createdBy: null,
  estimatedDurationDays: 180,
  tags: ['engagement', 'pmo', 'governance', 'interim'],
  usageCount: 0,
  defaultMethodology: 'waterfall',
  tasks: [
    { refId: 'est', name: 'Establish controls', description: 'Put the governance in place before trying to report on anything', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'est-gov', name: 'Governance and reporting structure', description: 'Steering committee, decision rights, escalation, cadence', estimatedDays: 8, priority: 'high', parentRefId: 'est', dependencyRefId: null, dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'est-plan', name: 'Integrated plan and baseline', description: 'One plan across the workstreams, baselined', estimatedDays: 12, priority: 'high', parentRefId: 'est', dependencyRefId: 'est-gov', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'est-raid', name: 'Risk and issue process stood up', description: 'A live RAID log with owners, not a spreadsheet nobody opens', estimatedDays: 5, priority: 'high', parentRefId: 'est', dependencyRefId: 'est-gov', dependencyType: 'SS', offsetDays: 3, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'gate1', name: 'Gate — Controls established, plan baselined', description: 'Client accepts the plan and the governance', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'est-plan', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
    { refId: 'run', name: 'Run the delivery cadence', description: 'The engagement itself: report, control, escalate, decide', estimatedDays: 140, priority: 'high', parentRefId: null, dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: true, mandatory: true },
    { refId: 'run-rep', name: 'Reporting and steering committee cycle', description: 'Weekly report, monthly steering committee', estimatedDays: 140, priority: 'high', parentRefId: 'run', dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'run-risk', name: 'Risk, issue and change control', description: 'Keep the RAID log and the change log honest', estimatedDays: 140, priority: 'high', parentRefId: 'run', dependencyRefId: 'gate1', dependencyType: 'SS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'run-mid', name: 'Mid-point health check and re-baseline if needed', description: 'An honest look at whether the plan still reflects reality', estimatedDays: 10, priority: 'high', parentRefId: 'run', dependencyRefId: 'gate1', dependencyType: 'FS', offsetDays: 70, skills: ['project-management'], isSummary: false },
    { refId: 'close', name: 'Closure and handover', description: 'Hand the controls to the client, capture lessons', estimatedDays: 20, priority: 'high', parentRefId: null, dependencyRefId: 'run', dependencyType: 'FS', offsetDays: 0, skills: ['project-management'], isSummary: false, mandatory: true },
    { refId: 'gate2', name: 'Gate — Engagement closed', description: 'Controls handed over, final report issued', estimatedDays: 1, priority: 'urgent', parentRefId: null, dependencyRefId: 'close', dependencyType: 'FS', offsetDays: 0, skills: [], isSummary: false, isMilestone: true, mandatory: true },
  ],
  raidItems: [
    { type: 'risk', title: 'Accountability without authority', description: 'You are asked to be responsible for delivery while the decisions sit elsewhere. Establish decision rights at the outset and escalate the first time they are bypassed.', probability: 'high', impact: 'high' },
    { type: 'assumption', title: 'Workstream leads will report accurately and on time', description: 'Your report is only as good as what you are given. Agree the inputs and the deadline in writing.' },
    { type: 'risk', title: 'The plan you inherit is not realistic', description: 'Re-baseline early rather than reporting against a plan you do not believe. It is easier in week two than in month four.', probability: 'medium', impact: 'high' },
    { type: 'dependency', title: 'Access to the client\'s own systems and data', description: 'Reporting depends on it, and it is often slower to arrange than expected.' },
    { type: 'action', title: 'Agree what happens at the end of the engagement', description: 'Who owns the controls afterwards. Decide this at the start, not the end.' },
  ],
  reportCadence: {
    frequency: 'weekly',
    dayOfWeek: 5,
    description: 'Weekly status report to the sponsor and a monthly pack for the steering committee.',
  },
};

export const consultingEngagementTemplates: ProjectTemplate[] = [
  systemsImplementation,
  discoveryAssessment,
  processImprovement,
  pmoSupport,
];
