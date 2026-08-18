export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

const GITHUB_API = 'https://api.github.com';

export class GitHubAdapter {
  private headers(config: GitHubConfig): Record<string, string> {
    return {
      'Authorization': `Bearer ${config.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async testConnection(config: GitHubConfig): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(
        `${GITHUB_API}/repos/${config.owner}/${config.repo}`,
        { headers: this.headers(config) },
      );
      if (response.ok) {
        const data = await response.json() as any;
        return { success: true, message: `Connected to ${data.full_name} successfully` };
      }
      if (response.status === 404) {
        return { success: false, message: 'Repository not found or no access' };
      }
      return { success: false, message: `GitHub returned ${response.status}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to connect' };
    }
  }

  async pullIssues(config: GitHubConfig): Promise<{ items: any[]; count: number }> {
    try {
      const response = await fetch(
        `${GITHUB_API}/repos/${config.owner}/${config.repo}/issues?state=open&per_page=100`,
        { headers: this.headers(config) },
      );
      if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
      const issues = await response.json();
      // Filter out pull requests (GitHub includes them in the issues endpoint)
      const realIssues = Array.isArray(issues)
        ? issues.filter((i: any) => !i.pull_request)
        : [];
      return { items: realIssues, count: realIssues.length };
    } catch (error: any) {
      throw new Error(`GitHub pull failed: ${error.message}`);
    }
  }

  async pushTasks(config: GitHubConfig, tasks: any[]): Promise<{ count: number }> {
    let count = 0;
    for (const task of tasks) {
      try {
        const response = await fetch(
          `${GITHUB_API}/repos/${config.owner}/${config.repo}/issues`,
          {
            method: 'POST',
            headers: this.headers(config),
            body: JSON.stringify({
              title: task.name,
              body: task.description || '',
              labels: task.labels || [],
            }),
          },
        );
        if (response.ok || response.status === 201) count++;
      } catch { /* skip failed items */ }
    }
    return { count };
  }
}

export const githubAdapter = new GitHubAdapter();
