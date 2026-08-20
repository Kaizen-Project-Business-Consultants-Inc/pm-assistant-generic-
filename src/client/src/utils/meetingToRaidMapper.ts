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
  duplicate?: { existingId: string; currentSeverity: string; currentStatus: string };
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
    });
  }

  return candidates;
}
