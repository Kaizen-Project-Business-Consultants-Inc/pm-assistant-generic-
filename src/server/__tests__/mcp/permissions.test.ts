import { describe, it, expect } from 'vitest';
import { isToolAllowed, getAllowedRoles, mcpRole, type Role } from '../../../../mcp-server/src/permissions';

const ALL_ROLES: Role[] = [
  'admin', 'executive', 'project_manager', 'team_member', 'scrum_master', 'finance_officer',
  'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer',
];

describe('MCP Permission Matrix', () => {
  describe('admin', () => {
    it('can access all tools', () => {
      const tools = [
        'list-projects', 'create-project', 'delete-project',
        'create-task', 'delete-task', 'create-sprint',
        'trigger-agent', 'create-integration',
        'log-time', 'act-on-approval',
      ];
      for (const tool of tools) {
        expect(isToolAllowed(tool, 'admin')).toBe(true);
      }
    });
  });

  describe('team_member', () => {
    it('can read all list/get tools', () => {
      expect(isToolAllowed('list-projects', 'team_member')).toBe(true);
      expect(isToolAllowed('get-project', 'team_member')).toBe(true);
      expect(isToolAllowed('list-tasks', 'team_member')).toBe(true);
      expect(isToolAllowed('get-sprint-board', 'team_member')).toBe(true);
    });

    it('can create/update tasks', () => {
      expect(isToolAllowed('create-task', 'team_member')).toBe(true);
      expect(isToolAllowed('update-task', 'team_member')).toBe(true);
      expect(isToolAllowed('add-task-comment', 'team_member')).toBe(true);
    });

    it('cannot delete tasks', () => {
      expect(isToolAllowed('delete-task', 'team_member')).toBe(false);
    });

    it('cannot manage sprints', () => {
      expect(isToolAllowed('create-sprint', 'team_member')).toBe(false);
      expect(isToolAllowed('start-sprint', 'team_member')).toBe(false);
    });

    it('cannot manage projects', () => {
      expect(isToolAllowed('create-project', 'team_member')).toBe(false);
      expect(isToolAllowed('delete-project', 'team_member')).toBe(false);
    });

    it('can log time', () => {
      expect(isToolAllowed('log-time', 'team_member')).toBe(true);
    });

    it('cannot access risk mitigations or meeting tools', () => {
      expect(isToolAllowed('suggest-risk-mitigations', 'team_member')).toBe(false);
      expect(isToolAllowed('get-meeting-summary', 'team_member')).toBe(false);
    });

    it('cannot access admin tools', () => {
      expect(isToolAllowed('trigger-agent', 'team_member')).toBe(false);
      expect(isToolAllowed('create-integration', 'team_member')).toBe(false);
    });
  });

  describe('scrum_master', () => {
    it('can manage sprints', () => {
      expect(isToolAllowed('create-sprint', 'scrum_master')).toBe(true);
      expect(isToolAllowed('start-sprint', 'scrum_master')).toBe(true);
      expect(isToolAllowed('complete-sprint', 'scrum_master')).toBe(true);
      expect(isToolAllowed('add-task-to-sprint', 'scrum_master')).toBe(true);
    });

    it('can create/update/delete tasks', () => {
      expect(isToolAllowed('create-task', 'scrum_master')).toBe(true);
      expect(isToolAllowed('delete-task', 'scrum_master')).toBe(true);
    });

    it('can analyze meeting transcripts', () => {
      expect(isToolAllowed('get-meeting-summary', 'scrum_master')).toBe(true);
    });

    it('cannot manage projects', () => {
      expect(isToolAllowed('create-project', 'scrum_master')).toBe(false);
      expect(isToolAllowed('delete-project', 'scrum_master')).toBe(false);
    });

    it('cannot access admin tools', () => {
      expect(isToolAllowed('trigger-agent', 'scrum_master')).toBe(false);
    });
  });

  describe('project_manager', () => {
    it('can manage projects', () => {
      expect(isToolAllowed('create-project', 'project_manager')).toBe(true);
      expect(isToolAllowed('update-project', 'project_manager')).toBe(true);
      expect(isToolAllowed('delete-project', 'project_manager')).toBe(true);
    });

    it('can manage sprints and tasks', () => {
      expect(isToolAllowed('create-sprint', 'project_manager')).toBe(true);
      expect(isToolAllowed('create-task', 'project_manager')).toBe(true);
      expect(isToolAllowed('delete-task', 'project_manager')).toBe(true);
    });

    it('can manage schedules', () => {
      expect(isToolAllowed('create-schedule', 'project_manager')).toBe(true);
      expect(isToolAllowed('delete-schedule', 'project_manager')).toBe(true);
    });

    it('can act on approvals', () => {
      expect(isToolAllowed('act-on-approval', 'project_manager')).toBe(true);
      expect(isToolAllowed('accept-proposal', 'project_manager')).toBe(true);
    });

    it('can access budget/financial tools', () => {
      expect(isToolAllowed('get-budget-forecast', 'project_manager')).toBe(true);
      expect(isToolAllowed('get-evm-forecast', 'project_manager')).toBe(true);
      expect(isToolAllowed('get-spend-to-date', 'project_manager')).toBe(true);
      expect(isToolAllowed('get-burn-rate', 'project_manager')).toBe(true);
    });

    it('can access risk and meeting tools', () => {
      expect(isToolAllowed('suggest-risk-mitigations', 'project_manager')).toBe(true);
      expect(isToolAllowed('get-meeting-summary', 'project_manager')).toBe(true);
    });

    it('cannot access admin tools', () => {
      expect(isToolAllowed('trigger-agent', 'project_manager')).toBe(false);
      expect(isToolAllowed('create-integration', 'project_manager')).toBe(false);
    });
  });

  describe('finance_officer', () => {
    it('can read all tools', () => {
      expect(isToolAllowed('list-projects', 'finance_officer')).toBe(true);
      expect(isToolAllowed('list-tasks', 'finance_officer')).toBe(true);
    });

    it('can access budget/financial tools', () => {
      expect(isToolAllowed('get-budget-forecast', 'finance_officer')).toBe(true);
      expect(isToolAllowed('get-evm-forecast', 'finance_officer')).toBe(true);
      expect(isToolAllowed('get-spend-to-date', 'finance_officer')).toBe(true);
      expect(isToolAllowed('get-burn-rate', 'finance_officer')).toBe(true);
    });

    it('cannot write anything', () => {
      expect(isToolAllowed('create-task', 'finance_officer')).toBe(false);
      expect(isToolAllowed('create-project', 'finance_officer')).toBe(false);
      expect(isToolAllowed('log-time', 'finance_officer')).toBe(false);
    });
  });

  describe('executive', () => {
    it('can read all tools', () => {
      expect(isToolAllowed('list-projects', 'executive')).toBe(true);
      expect(isToolAllowed('get-portfolio-overview', 'executive')).toBe(true);
    });

    it('can act on approvals', () => {
      expect(isToolAllowed('act-on-approval', 'executive')).toBe(true);
    });

    it('cannot write tasks or projects', () => {
      expect(isToolAllowed('create-task', 'executive')).toBe(false);
      expect(isToolAllowed('create-project', 'executive')).toBe(false);
    });
  });

  describe('risk_manager', () => {
    it('can read all tools', () => {
      expect(isToolAllowed('list-projects', 'risk_manager')).toBe(true);
      expect(isToolAllowed('get-project-risks', 'risk_manager')).toBe(true);
    });

    it('can create/update tasks and act on approvals', () => {
      expect(isToolAllowed('create-task', 'risk_manager')).toBe(true);
      expect(isToolAllowed('act-on-approval', 'risk_manager')).toBe(true);
    });

    it('can access budget/financial tools', () => {
      expect(isToolAllowed('get-budget-forecast', 'risk_manager')).toBe(true);
      expect(isToolAllowed('get-spend-to-date', 'risk_manager')).toBe(true);
      expect(isToolAllowed('get-burn-rate', 'risk_manager')).toBe(true);
    });

    it('can suggest risk mitigations', () => {
      expect(isToolAllowed('suggest-risk-mitigations', 'risk_manager')).toBe(true);
    });

    it('cannot manage projects or sprints', () => {
      expect(isToolAllowed('create-project', 'risk_manager')).toBe(false);
      expect(isToolAllowed('create-sprint', 'risk_manager')).toBe(false);
    });
  });

  describe('pmo', () => {
    it('has near-PM access', () => {
      expect(isToolAllowed('create-project', 'pmo')).toBe(true);
      expect(isToolAllowed('create-schedule', 'pmo')).toBe(true);
      expect(isToolAllowed('create-sprint', 'pmo')).toBe(true);
      expect(isToolAllowed('delete-task', 'pmo')).toBe(true);
      expect(isToolAllowed('act-on-approval', 'pmo')).toBe(true);
      expect(isToolAllowed('get-budget-forecast', 'pmo')).toBe(true);
      expect(isToolAllowed('suggest-risk-mitigations', 'pmo')).toBe(true);
      expect(isToolAllowed('get-meeting-summary', 'pmo')).toBe(true);
    });

    it('cannot access admin tools', () => {
      expect(isToolAllowed('trigger-agent', 'pmo')).toBe(false);
    });
  });

  describe('ba', () => {
    it('can read and create tasks', () => {
      expect(isToolAllowed('list-projects', 'ba')).toBe(true);
      expect(isToolAllowed('create-task', 'ba')).toBe(true);
      expect(isToolAllowed('log-time', 'ba')).toBe(true);
    });

    it('can manage custom fields', () => {
      expect(isToolAllowed('create-custom-field', 'ba')).toBe(true);
    });

    it('can access risk mitigations and meeting summaries', () => {
      expect(isToolAllowed('suggest-risk-mitigations', 'ba')).toBe(true);
      expect(isToolAllowed('get-meeting-summary', 'ba')).toBe(true);
    });

    it('cannot manage projects or sprints', () => {
      expect(isToolAllowed('create-project', 'ba')).toBe(false);
      expect(isToolAllowed('create-sprint', 'ba')).toBe(false);
    });
  });

  describe('qa and tester', () => {
    it('qa can create tasks and log time', () => {
      expect(isToolAllowed('create-task', 'qa')).toBe(true);
      expect(isToolAllowed('log-time', 'qa')).toBe(true);
    });

    it('tester can create tasks and log time', () => {
      expect(isToolAllowed('create-task', 'tester')).toBe(true);
      expect(isToolAllowed('log-time', 'tester')).toBe(true);
    });

    it('neither can manage projects', () => {
      expect(isToolAllowed('create-project', 'qa')).toBe(false);
      expect(isToolAllowed('create-project', 'tester')).toBe(false);
    });
  });

  describe('devops', () => {
    it('can create tasks and log time', () => {
      expect(isToolAllowed('create-task', 'devops')).toBe(true);
      expect(isToolAllowed('log-time', 'devops')).toBe(true);
    });

    it('cannot manage projects', () => {
      expect(isToolAllowed('create-project', 'devops')).toBe(false);
    });
  });

  describe('claude_sme', () => {
    it('can read all tools and financial tools', () => {
      expect(isToolAllowed('list-projects', 'claude_sme')).toBe(true);
      expect(isToolAllowed('get-budget-forecast', 'claude_sme')).toBe(true);
    });

    it('cannot write anything', () => {
      expect(isToolAllowed('create-task', 'claude_sme')).toBe(false);
      expect(isToolAllowed('create-project', 'claude_sme')).toBe(false);
      expect(isToolAllowed('log-time', 'claude_sme')).toBe(false);
    });
  });

  describe('getAllowedRoles', () => {
    it('returns all roles for read tools', () => {
      const roles = getAllowedRoles('list-projects');
      expect(roles).toEqual(ALL_ROLES);
    });

    it('returns limited roles for admin tools', () => {
      const roles = getAllowedRoles('trigger-agent');
      expect(roles).toEqual(['admin']);
    });
  });

  describe('unknown tools', () => {
    it('denies unknown tools for non-admin', () => {
      expect(isToolAllowed('nonexistent-tool', 'team_member')).toBe(false);
    });

    it('allows unknown tools for admin', () => {
      expect(isToolAllowed('nonexistent-tool', 'admin')).toBe(true);
    });
  });
});

/** 2026-10-09 audit (low): the MCP server used the raw role, so an owner's Claude got fewer tools */
describe('mcpRole: the same role rule as the app', () => {
  it('the company owner works as PMO', () => {
    expect(mcpRole({ role: 'project_manager', is_owner: 1, is_guest: 0 })).toBe('pmo');
  });
  it('a member, a guest owner-flag and the platform admin keep their own role', () => {
    expect(mcpRole({ role: 'team_member', is_owner: 0, is_guest: 0 })).toBe('team_member');
    expect(mcpRole({ role: 'viewer', is_owner: 1, is_guest: 1 })).toBe('viewer');
    expect(mcpRole({ role: 'admin', is_owner: null, is_guest: null })).toBe('admin');
  });
});
