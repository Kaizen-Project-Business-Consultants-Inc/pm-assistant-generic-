export interface TrelloConfig {
  apiKey: string;
  token: string;
  boardId: string;
}

const TRELLO_API = 'https://api.trello.com/1';

export class TrelloAdapter {
  private authParams(config: TrelloConfig): string {
    return `key=${config.apiKey}&token=${config.token}`;
  }

  async testConnection(config: TrelloConfig): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(
        `${TRELLO_API}/boards/${config.boardId}?${this.authParams(config)}`,
        { headers: { 'Accept': 'application/json' } },
      );
      if (response.ok) {
        const data = await response.json() as any;
        return { success: true, message: `Connected to Trello board "${data.name}" successfully` };
      }
      if (response.status === 401) {
        return { success: false, message: 'Invalid API key or token' };
      }
      if (response.status === 404) {
        return { success: false, message: 'Board not found or no access' };
      }
      return { success: false, message: `Trello returned ${response.status}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to connect' };
    }
  }

  async pullCards(config: TrelloConfig): Promise<{ items: any[]; count: number }> {
    try {
      const response = await fetch(
        `${TRELLO_API}/boards/${config.boardId}/cards?${this.authParams(config)}&fields=name,desc,idList,due,labels`,
        { headers: { 'Accept': 'application/json' } },
      );
      if (!response.ok) throw new Error(`Trello API error: ${response.status}`);
      const cards = await response.json();
      const items = Array.isArray(cards) ? cards : [];
      return { items, count: items.length };
    } catch (error: any) {
      throw new Error(`Trello pull failed: ${error.message}`);
    }
  }

  async pushTasks(config: TrelloConfig, tasks: any[]): Promise<{ count: number }> {
    // Get the first list on the board to use as the target list
    let targetListId: string | null = null;
    try {
      const listsResponse = await fetch(
        `${TRELLO_API}/boards/${config.boardId}/lists?${this.authParams(config)}&fields=id,name`,
        { headers: { 'Accept': 'application/json' } },
      );
      if (listsResponse.ok) {
        const lists = await listsResponse.json();
        if (Array.isArray(lists) && lists.length > 0) {
          targetListId = lists[0].id;
        }
      }
    } catch { /* fall through */ }

    if (!targetListId) {
      throw new Error('Could not find a list on the Trello board');
    }

    let count = 0;
    for (const task of tasks) {
      try {
        const response = await fetch(
          `${TRELLO_API}/cards?${this.authParams(config)}`,
          {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              idList: targetListId,
              name: task.name,
              desc: task.description || '',
              due: task.dueDate || null,
            }),
          },
        );
        if (response.ok || response.status === 200) count++;
      } catch { /* skip failed items */ }
    }
    return { count };
  }

  async getLists(config: TrelloConfig): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await fetch(
        `${TRELLO_API}/boards/${config.boardId}/lists?${this.authParams(config)}&fields=id,name`,
        { headers: { 'Accept': 'application/json' } },
      );
      if (!response.ok) throw new Error(`Trello API error: ${response.status}`);
      return await response.json() as Array<{ id: string; name: string }>;
    } catch (error: any) {
      throw new Error(`Failed to get Trello lists: ${error.message}`);
    }
  }
}

export const trelloAdapter = new TrelloAdapter();
