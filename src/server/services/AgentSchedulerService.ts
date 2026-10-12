import { AgentActivityLogService } from './AgentActivityLogService';
import { runScanImpl, ScanStats } from './scheduling/scanOrchestrator';

export class AgentSchedulerService {
  private activityLog = new AgentActivityLogService();

  async runScan(projectId?: string): Promise<ScanStats> {
    return runScanImpl(this.activityLog, projectId);
  }
}

export const agentScheduler = new AgentSchedulerService();
