import { interAgentQueryService, AgentInsight } from './InterAgentQueryService';
import { mapWithLimit, DEFAULT_LIMIT } from '../../utils/mapWithLimit';

export interface AssembledInsights {
  projectId: string;
  overallHealth: 'healthy' | 'warning' | 'critical';
  summary: string;
  agentFindings: Array<{
    agent: string;
    finding: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  lastUpdated: string;
}

/**
 * Combines multiple agents' outputs into a unified project health narrative.
 * Used by the narrative endpoint and dashboard.
 */
export class InsightAssemblyService {
  async assembleForProject(projectId: string): Promise<AssembledInsights> {
    const insights = await interAgentQueryService.getInsightsByProject(projectId);

    const findings = insights.map(ins => this.extractFinding(ins)).filter(Boolean) as AssembledInsights['agentFindings'][0][];

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const warningCount = findings.filter(f => f.severity === 'warning').length;

    const overallHealth: AssembledInsights['overallHealth'] =
      criticalCount > 0 ? 'critical' :
      warningCount >= 2 ? 'warning' :
      'healthy';

    const summary = this.buildSummary(findings, overallHealth);
    const lastUpdated = insights.length > 0
      ? insights.reduce((latest, ins) => ins.updatedAt > latest ? ins.updatedAt : latest, insights[0].updatedAt)
      : new Date().toISOString();

    return {
      projectId,
      overallHealth,
      summary,
      agentFindings: findings,
      lastUpdated,
    };
  }

  async assembleForPortfolio(projectIds: string[]): Promise<AssembledInsights[]> {
    // A few at a time: one per project all at once can use up the database connections
    return mapWithLimit(projectIds, DEFAULT_LIMIT, id => this.assembleForProject(id));
  }

  private extractFinding(insight: AgentInsight): AssembledInsights['agentFindings'][0] | null {
    const val = insight.value as any;
    if (!val) return null;

    const agentLabel = this.formatAgentName(insight.agentId);
    const finding = val.summary || val.finding || val.message || JSON.stringify(val).slice(0, 150);
    const severity = this.determineSeverity(val);

    return { agent: agentLabel, finding, severity };
  }

  private determineSeverity(val: any): 'info' | 'warning' | 'critical' {
    if (val.severity === 'critical' || val.alertLevel === 'critical') return 'critical';
    if (val.severity === 'high' || val.alertLevel === 'high' || val.severity === 'warning') return 'warning';
    return 'info';
  }

  private formatAgentName(agentId: string): string {
    return agentId
      .replace(/-v\d+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private buildSummary(findings: AssembledInsights['agentFindings'][0][], health: string): string {
    if (findings.length === 0) return 'No recent agent findings for this project.';

    const criticalFindings = findings.filter(f => f.severity === 'critical');
    const warningFindings = findings.filter(f => f.severity === 'warning');

    if (health === 'critical') {
      return `${criticalFindings.length} critical issue(s) detected: ${criticalFindings.map(f => f.agent).join(', ')}.`;
    }
    if (health === 'warning') {
      return `${warningFindings.length} warning(s) from: ${warningFindings.map(f => f.agent).join(', ')}.`;
    }
    return `Project is healthy. ${findings.length} agent(s) reported no significant issues.`;
  }
}

export const insightAssemblyService = new InsightAssemblyService();
