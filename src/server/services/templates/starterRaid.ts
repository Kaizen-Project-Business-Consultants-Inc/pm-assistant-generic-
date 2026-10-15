import type { TemplateRaidItem } from '../../schemas/templateSchemas';

/**
 * Starter RAID items for the built-in templates (UAT U10, 2026-10-14): what a PM running this kind
 * of project usually has to watch from day one. Applied with the template; the PM reviews them first
 * (all ticked) and can untick any. Written the way a PM would note them: plain words, a reason, and
 * — for risks — a likelihood and impact.
 */
export const STARTER_RAID: Record<string, TemplateRaidItem[]> = {
  'tpl-it-webapp': [
    { type: 'risk', title: 'Requirements change after sign-off', description: 'New asks after the requirements gate land on the critical path. Route them through change requests.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Integrations take longer than planned', description: 'Third-party APIs are often less documented or less stable than promised. Test them early with a spike.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Stakeholders are available for UAT in the planned window', description: 'Book the testers now; UAT that slips moves go-live.' },
    { type: 'dependency', title: 'Hosting and environments ready before the build ends', description: 'Production and test environments come from someone else. Confirm owner and date.' },
    { type: 'risk', title: 'Security or performance problems found late', description: 'Run a basic security scan and a load test before UAT, not after.', probability: 'medium', impact: 'medium' },
    { type: 'action', title: 'Agree the definition of done with the client', description: 'Week one: what "accepted" means for each feature, and who signs.' },
  ],
  'tpl-it-cloud': [
    { type: 'risk', title: 'Hidden dependencies between systems', description: 'Undocumented links (shared databases, file drops, hard-coded IPs) break at cutover. Map them in discovery.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Cloud costs higher than estimated', description: 'Right-size after the first month and set budget alerts from day one.', probability: 'medium', impact: 'medium' },
    { type: 'risk', title: 'Data transfer takes longer than the cutover window', description: 'Measure real transfer speed in a trial migration before fixing the cutover date.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Licences can move to the cloud', description: 'Some software licences are tied to on-premises hardware. Check with each vendor.' },
    { type: 'dependency', title: 'Network connection to the cloud is in place', description: 'VPN or dedicated link, firewall rules and DNS changes are often owned by another team.' },
    { type: 'action', title: 'Write and test the rollback plan', description: 'Before cutover: how to go back, how long it takes, and who decides.' },
  ],
  'tpl-it-erp': [
    { type: 'risk', title: 'Data migration quality is poorer than expected', description: 'Old data is rarely clean. Plan at least two trial loads and agree who fixes the source data.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Too many customisations', description: 'Each change to the standard product adds cost now and at every upgrade. Challenge them against the business case.', probability: 'high', impact: 'medium' },
    { type: 'risk', title: 'Users not ready at go-live', description: 'Training too early is forgotten, too late is rushed. Plan training close to go-live.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Key users are released from their day jobs as agreed', description: 'Design workshops and testing need the people who know the processes. Record the agreed time.' },
    { type: 'dependency', title: 'Interfaces to other systems are specified by their owners', description: 'Payroll, banks and reporting systems are outside the project. Get named owners and dates.' },
    { type: 'action', title: 'Agree the cutover period and the freeze on the old system', description: 'Month-end and year-end are bad times to go live. Fix the date with Finance early.' },
  ],
  'tpl-con-commercial': [
    { type: 'risk', title: 'Permits or approvals delayed', description: 'Planning, building and fire approvals set the start date. Track each with the authority.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Ground conditions differ from the survey', description: 'Unexpected rock, water or contamination changes foundations and cost. Keep a contingency.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Material prices or lead times rise', description: 'Order long-lead items (steel, lifts, switchgear) early and fix prices where possible.', probability: 'high', impact: 'medium' },
    { type: 'risk', title: 'Weather stops outdoor work', description: 'Plan weather-sensitive work (concrete, roofing) outside the wet season where possible.', probability: 'medium', impact: 'medium' },
    { type: 'dependency', title: 'Utility connections (power, water, sewer) by their providers', description: 'Providers work to their own timetable. Apply early and chase monthly.' },
    { type: 'action', title: 'Agree the site safety plan before mobilisation', description: 'Who is responsible for safety on site, inductions and incident reporting.' },
  ],
  'tpl-con-residential': [
    { type: 'risk', title: 'Owner changes the design during the build', description: 'Each change costs more once work has started. Price changes before agreeing them.', probability: 'high', impact: 'medium' },
    { type: 'risk', title: 'Trades not available when needed', description: 'One late trade delays every trade after it. Book key trades early and confirm a week ahead.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Inspection fails and work must be redone', description: 'Check work against the drawings before the inspector visits.', probability: 'medium', impact: 'medium' },
    { type: 'assumption', title: 'Finance is released in stages as planned', description: 'Payments usually follow inspections. A late stage payment can stop the site.' },
    { type: 'dependency', title: 'Building permit approved before work starts', description: 'Starting without it risks a stop order and fines.' },
    { type: 'action', title: 'Agree finishes and fittings with the owner in writing', description: 'Tiles, fixtures and colours: decide early so ordering does not hold up the finish.' },
  ],
  'tpl-infra-utilities': [
    { type: 'risk', title: 'Existing underground services not where the records say', description: 'Strikes on unrecorded pipes or cables are dangerous and costly. Survey and dig trial holes.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Easements or land access refused or delayed', description: 'Every landowner on the route must agree. Start negotiations early.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Service outage for customers during connection', description: 'Plan outages with notice and at quiet times; have a fall-back.', probability: 'medium', impact: 'medium' },
    { type: 'assumption', title: 'Design standards of the utility operator apply as issued', description: 'Confirm the current version with the operator; standards change.' },
    { type: 'dependency', title: 'Operator approval to connect to the live network', description: 'Commissioning needs the operator on site. Book them early.' },
    { type: 'action', title: 'Set up the traffic management and road-opening permits', description: 'Works in the road need the local authority’s permit and a traffic plan.' },
  ],
  'tpl-infra-telecom': [
    { type: 'risk', title: 'Site access or landlord agreements delayed', description: 'Towers and rooftops need signed agreements before work. Track each site.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Equipment delivery late', description: 'Radio and fibre equipment can have long lead times. Order early and track shipments.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Site radio approvals delayed', description: 'Each new antenna or radio site needs the regulator’s approval. Apply as soon as the site design is fixed.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Power is available at each site', description: 'Some sites need new power supplies or generators. Check during the survey.' },
    { type: 'dependency', title: 'Backhaul (fibre or microwave link) ready before site integration', description: 'A site without backhaul cannot go live. Confirm the provider’s date.' },
    { type: 'action', title: 'Agree acceptance tests per site with the operator', description: 'Drive tests and KPIs: what “accepted” means, before the first site is built.' },
  ],
  'tpl-roads-highway': [
    { type: 'risk', title: 'Land acquisition not complete on time', description: 'Work cannot start on land not yet acquired. Track every parcel.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Utility relocations take longer than planned', description: 'Pipes and cables in the path must be moved by their owners first.', probability: 'high', impact: 'high' },
    { type: 'risk', title: 'Weather stops earthworks and paving', description: 'Rain stops earthworks and asphalt. Plan paving for the dry season.', probability: 'medium', impact: 'medium' },
    { type: 'risk', title: 'Traffic management causes complaints or accidents', description: 'Keep diversions clear, lit and signed; review them weekly.', probability: 'medium', impact: 'high' },
    { type: 'dependency', title: 'Environmental approval before clearing', description: 'Clearing or work near water usually needs an environmental permit.' },
    { type: 'action', title: 'Agree the quality testing plan (materials and compaction)', description: 'Which tests, how often, and who signs them off, before earthworks start.' },
  ],
  'tpl-roads-bridge': [
    { type: 'risk', title: 'Foundation conditions differ from the geotechnical report', description: 'Piling deeper or redesigning foundations adds time and cost. Keep a contingency.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'River levels or weather stop work in the water', description: 'Plan in-water work for the low-water season and keep a flood plan.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Precast or steel elements delivered late', description: 'Fabrication slots are booked months ahead. Order early and inspect at the factory.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'Road or river closures are approved as planned', description: 'Lifts often need a closure. Book them with the authority early.' },
    { type: 'dependency', title: 'Independent design check before construction', description: 'Most authorities need a design check certificate before work starts.' },
    { type: 'action', title: 'Plan the heavy lifts with the crane supplier', description: 'Crane size, ground bearing and lift dates — agree them before the elements are made.' },
  ],
  'tpl-generic-pmi': [
    { type: 'risk', title: 'Scope grows without a change decision', description: 'Small additions add up. Log every change and decide it with the sponsor.', probability: 'high', impact: 'medium' },
    { type: 'risk', title: 'Key people leave or are moved to other work', description: 'Note who the project depends on and have a backup for each.', probability: 'medium', impact: 'high' },
    { type: 'assumption', title: 'The budget is approved for the whole project', description: 'Confirm whether funding is released in stages and when.' },
    { type: 'assumption', title: 'Stakeholders make decisions within a week', description: 'Slow decisions stop work. Agree a decision time with the sponsor.' },
    { type: 'dependency', title: 'Inputs from other teams arrive on the agreed dates', description: 'List what you need from others, by whom and by when.' },
    { type: 'action', title: 'Agree how progress is reported and to whom', description: 'Who gets the status report, how often, and what needs their decision.' },
  ],
  'tpl-it-agile': [
    { type: 'risk', title: 'The backlog is not ready for the next sprint', description: 'Stories without acceptance criteria stall the sprint. Refine at least one sprint ahead.', probability: 'medium', impact: 'medium' },
    { type: 'risk', title: 'The product owner is not available', description: 'Questions wait and work is guessed. Agree the product owner’s time each sprint.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Technical debt slows each sprint', description: 'Leave room each sprint for fixing what slows the team down.', probability: 'medium', impact: 'medium' },
    { type: 'assumption', title: 'The team stays together for the release', description: 'Velocity depends on a stable team. Note who is shared with other work.' },
    { type: 'dependency', title: 'Other teams deliver the services this release needs', description: 'Put cross-team items on the board with owner and sprint.' },
    { type: 'action', title: 'Agree the definition of done', description: 'Tested, reviewed, documented — what “done” means before the first sprint.' },
  ],
  'tpl-mktg-campaign': [
    { type: 'risk', title: 'Creative approval takes longer than planned', description: 'Too many reviewers slow approval. Name one approver and a turnaround time.', probability: 'high', impact: 'medium' },
    { type: 'risk', title: 'The campaign misses its audience', description: 'Test messages with a small audience before the full launch.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Media costs higher than planned', description: 'Bids change daily. Set spend caps and review weekly.', probability: 'medium', impact: 'medium' },
    { type: 'assumption', title: 'Tracking is in place before launch', description: 'Without tracking the results cannot be measured. Test links and analytics first.' },
    { type: 'dependency', title: 'Legal or brand approval of claims and imagery', description: 'Offers and claims often need legal sign-off. Allow time for it.' },
    { type: 'action', title: 'Agree how success is measured', description: 'Which numbers, what targets, and when they are reviewed — before launch.' },
  ],
  'tpl-mktg-product': [
    { type: 'risk', title: 'The product is not ready on launch day', description: 'Marketing dates and product dates drift apart. Review readiness weekly together.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Sales and support not trained in time', description: 'Customers ask questions on day one. Train before launch, with an FAQ.', probability: 'medium', impact: 'medium' },
    { type: 'risk', title: 'A competitor launches first', description: 'Watch competitors and have a response ready.', probability: 'low', impact: 'medium' },
    { type: 'assumption', title: 'Pricing is approved before materials are produced', description: 'Changing prices after printing or publishing is costly.' },
    { type: 'dependency', title: 'Distribution channels ready (stores, partners, online)', description: 'Each channel has its own lead time. Confirm dates with each.' },
    { type: 'action', title: 'Agree the go / no-go checklist for launch day', description: 'What must be true to launch, and who decides.' },
  ],
  'tpl-ops-relocation': [
    { type: 'risk', title: 'The new office is not ready on move day', description: 'Fit-out, furniture and IT all have to finish first. Track them weekly.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'IT and phones not working on the first day', description: 'Test network, printers and phones in the new office before the move.', probability: 'medium', impact: 'high' },
    { type: 'risk', title: 'Staff unhappy with the new location or layout', description: 'Share plans early and take questions; it reduces complaints.', probability: 'medium', impact: 'medium' },
    { type: 'assumption', title: 'The old lease ends on the planned date', description: 'Check notice periods and the condition the landlord expects on hand-back.' },
    { type: 'dependency', title: 'Internet line installed by the provider', description: 'Business lines can take weeks. Order as soon as the address is fixed.' },
    { type: 'action', title: 'Plan the move weekend team by team', description: 'Who packs, who moves, who checks — and a list of what each team needs on Monday.' },
  ],
};
