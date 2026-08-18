export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export class JiraAdapter {
  async testConnection(config: JiraConfig): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${config.baseUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) return { success: true, message: 'Connected to Jira successfully' };
      return { success: false, message: `Jira returned ${response.status}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to connect' };
    }
  }

  async pullIssues(config: JiraConfig): Promise<{ items: any[]; count: number }> {
    try {
      const response = await fetch(
        `${config.baseUrl}/rest/api/3/search?jql=project=${encodeURIComponent(config.projectKey)}&maxResults=100`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
      const data = await response.json() as any;
      return { items: data.issues || [], count: data.total || 0 };
    } catch (error: any) {
      throw new Error(`Jira pull failed: ${error.message}`);
    }
  }

  async pushTasks(config: JiraConfig, tasks: any[]): Promise<{ count: number }> {
    let count = 0;
    for (const task of tasks) {
      try {
        const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              project: { key: config.projectKey },
              summary: task.name,
              description: {
                type: 'doc',
                version: 1,
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: task.description || '' }],
                }],
              },
              issuetype: { name: 'Task' },
            },
          }),
        });
        if (response.ok) count++;
      } catch { /* skip failed items */ }
    }
    return { count };
  }
}

export const jiraAdapter = new JiraAdapter();
