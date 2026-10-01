/**
 * Maps meeting analysis items (risks, issues, action items, decisions, dependencies)
 * into RAID log candidate items for the review modal.
 */

export interface RaidCandidate {
  type: 'risk' | 'issue' | 'action' | 'decision';
  sourceType: 'risk' | 'issue' | 'action' | 'decision' | 'dependency';
  title: string;
  description?: string;
  category?: string;
  severity?: string;
  probability?: number;
  impact?: number;
  mitigationPlan?: string;
  dueDate?: string;
  rationale?: string;
  decidedBy?: string;
  actionType?: 'preventive' | 'corrective' | 'improvement';
  impactAssessment?: string;
  /** Meeting Coach: the owner the meeting named (a project member) or just their name */
  ownerId?: string;
  ownerName?: string;
  /** someone said it out loud in the meeting ("that's a risk") rather than the AI inferring it */
  calledOut?: boolean;
  /** two or more project members fit the spoken name — the PM picks */
  ownerChoices?: { userId: string; name: string }[];
  quote?: string;
  saidBy?: string;
  at?: string;
  duplicate?: { existingId: string; currentSeverity: string; currentStatus: string };
}

/** What the server's send-to-RAID accepts — one place, for the RAID modal and Meeting Coach */
export function toSendToRaidPayload(c: RaidCandidate): Record<string, unknown> {
  return {
    type: c.type, title: c.title, description: c.description, category: c.category,
    severity: c.severity, probability: c.probability, impact: c.impact, mitigationPlan: c.mitigationPlan,
    dueDate: c.dueDate, rationale: c.rationale, decidedBy: c.decidedBy, actionType: c.actionType,
    impactAssessment: c.impactAssessment, ownerId: c.ownerId, ownerName: c.ownerName,
  };
}

/** Owner + coach fields every candidate carries over from its meeting item */
function coachFields(x: any): Partial<RaidCandidate> {
  return {
    ownerId: x.ownerUserId || undefined,
    ownerName: x.ownerName || undefined,
    ownerChoices: x.ownerChoices?.length ? x.ownerChoices : undefined,
    calledOut: !!x.calledOut,
    quote: x.quote,
    saidBy: x.saidBy ?? x.madeBy,
    at: x.at,
  };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function priorityToSeverity(priority: string): string {
  switch (priority) {
    case 'urgent': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'medium';
  }
}

function severityToProbImpact(severity: string): { probability: number; impact: number } {
  switch (severity) {
    case 'critical': return { probability: 4, impact: 5 };
    case 'high': return { probability: 3, impact: 4 };
    case 'medium': return { probability: 3, impact: 3 };
    case 'low': return { probability: 2, impact: 2 };
    default: return { probability: 3, impact: 3 };
  }
}

export function mapAnalysisToRaidCandidates(analysis: {
  risks?: any[];
  issues?: any[];
  actionItems?: any[];
  decisions?: any[];
  dependencies?: any[];
}): RaidCandidate[] {
  const candidates: RaidCandidate[] = [];

  // Risks → type 'risk'
  for (const r of analysis.risks || []) {
    const pi = severityToProbImpact(r.severity);
    candidates.push({
      type: 'risk',
      sourceType: 'risk',
      title: truncate(r.description, 255),
      description: r.description,
      severity: r.severity || 'medium',
      probability: pi.probability,
      impact: pi.impact,
      mitigationPlan: r.mitigation,
      ...coachFields(r),
    });
  }

  // Issues → type 'issue'
  for (const i of analysis.issues || []) {
    candidates.push({
      type: 'issue',
      sourceType: 'issue',
      title: truncate(i.description, 255),
      description: i.description,
      severity: i.severity || 'medium',
      impactAssessment: i.impact,
      ...coachFields(i),
    });
  }

  // Action Items → type 'action'
  for (const a of analysis.actionItems || []) {
    candidates.push({
      type: 'action',
      sourceType: 'action',
      title: truncate(a.description, 255),
      description: `${a.description}${a.assignee ? ` (Assignee: ${a.assignee})` : ''}`,
      severity: priorityToSeverity(a.priority),
      dueDate: a.dueDate,
      actionType: 'corrective',
      ...coachFields(a),
    });
  }

  // Decisions → type 'decision'
  for (const d of analysis.decisions || []) {
    candidates.push({
      type: 'decision',
      sourceType: 'decision',
      title: truncate(d.decision, 255),
      description: d.decision,
      rationale: d.rationale,
      decidedBy: d.madeBy,
      ...coachFields(d),
      ownerId: undefined, ownerName: undefined, ownerChoices: undefined, // a decision has no owner
    });
  }

  // Dependencies → type 'risk' with category 'dependency'
  for (const dep of analysis.dependencies || []) {
    const parts = [dep.description];
    if (dep.dependsOn) parts.push(`Depends on: ${dep.dependsOn}`);
    if (dep.blockedItem) parts.push(`Blocked: ${dep.blockedItem}`);

    candidates.push({
      type: 'risk',
      sourceType: 'dependency',
      title: truncate(dep.description, 255),
      description: parts.join('\n'),
      category: 'dependency',
      severity: 'medium',
      probability: 3,
      impact: 3,
      ...coachFields(dep),
    });
  }

  return candidates;
}
