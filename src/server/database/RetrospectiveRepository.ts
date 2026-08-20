import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';
import type { ResultSetHeader } from 'mysql2';

export interface RetrospectiveItem {
  id: string;
  sprintId: string;
  projectId: string;
  category: 'went_well' | 'to_improve' | 'action_item';
  content: string;
  createdBy: string;
  voteCount: number;
  convertedTaskId: string | null;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

const rowMapper = (row: any): RetrospectiveItem => ({
  id: row.id,
  sprintId: row.sprint_id,
  projectId: row.project_id,
  category: row.category,
  content: row.content,
  createdBy: row.created_by,
  voteCount: Number(row.vote_count),
  convertedTaskId: row.converted_task_id ?? null,
  aiGenerated: !!row.ai_generated,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

class RetrospectiveRepository extends BaseRepository<RetrospectiveItem> {
  constructor() {
    super('retrospective_items', rowMapper);
  }

  async create(data: {
    sprintId: string;
    projectId: string;
    category: 'went_well' | 'to_improve' | 'action_item';
    content: string;
    createdBy: string;
    aiGenerated?: boolean;
  }): Promise<RetrospectiveItem> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO retrospective_items (id, sprint_id, project_id, category, content, created_by, ai_generated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.sprintId, data.projectId, data.category, data.content, data.createdBy, data.aiGenerated ? 1 : 0],
    );
    return (await this.findById(id))!;
  }

  async findBySprint(sprintId: string): Promise<RetrospectiveItem[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM retrospective_items WHERE sprint_id = ? ORDER BY vote_count DESC, created_at ASC`,
      [sprintId],
    );
    return rows.map(rowMapper);
  }

  async addVote(itemId: string, userId: string): Promise<boolean> {
    const voteId = uuidv4();
    try {
      await this.queryRaw(
        `INSERT IGNORE INTO retrospective_votes (id, item_id, user_id) VALUES (?, ?, ?)`,
        [voteId, itemId, userId],
      );
      const result = await this.queryRaw(
        `UPDATE retrospective_items SET vote_count = vote_count + 1 WHERE id = ? AND vote_count = (SELECT cnt FROM (SELECT COUNT(*) AS cnt FROM retrospective_votes WHERE item_id = ?) sub) - 1`,
        [itemId, itemId],
      );
      // Simpler: just sync the count
      await this.queryRaw(
        `UPDATE retrospective_items SET vote_count = (SELECT COUNT(*) FROM retrospective_votes WHERE item_id = ?) WHERE id = ?`,
        [itemId, itemId],
      );
      return true;
    } catch {
      return false;
    }
  }

  async removeVote(itemId: string, userId: string): Promise<boolean> {
    await this.queryRaw(
      `DELETE FROM retrospective_votes WHERE item_id = ? AND user_id = ?`,
      [itemId, userId],
    );
    await this.queryRaw(
      `UPDATE retrospective_items SET vote_count = (SELECT COUNT(*) FROM retrospective_votes WHERE item_id = ?) WHERE id = ?`,
      [itemId, itemId],
    );
    return true;
  }

  async getUserVotes(sprintId: string, userId: string): Promise<string[]> {
    const rows = await this.queryRaw(
      `SELECT rv.item_id FROM retrospective_votes rv
       JOIN retrospective_items ri ON ri.id = rv.item_id
       WHERE ri.sprint_id = ? AND rv.user_id = ?`,
      [sprintId, userId],
    );
    return rows.map((r: any) => r.item_id);
  }

  async setConvertedTaskId(itemId: string, taskId: string): Promise<void> {
    await this.queryRaw(
      `UPDATE retrospective_items SET converted_task_id = ? WHERE id = ?`,
      [taskId, itemId],
    );
  }

  async deleteWithVotes(id: string): Promise<boolean> {
    await this.queryRaw(`DELETE FROM retrospective_votes WHERE item_id = ?`, [id]);
    return this.deleteById(id);
  }
}

export const retrospectiveRepository = new RetrospectiveRepository();
