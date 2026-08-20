import { retrospectiveRepository, RetrospectiveItem } from '../database/RetrospectiveRepository';
import { sprintService } from './SprintService';
import logger from '../utils/logger';

class RetrospectiveService {
  async getBoard(sprintId: string, userId: string): Promise<{ items: RetrospectiveItem[]; userVotes: string[] }> {
    const [items, userVotes] = await Promise.all([
      retrospectiveRepository.findBySprint(sprintId),
      retrospectiveRepository.getUserVotes(sprintId, userId),
    ]);
    return { items, userVotes };
  }

  async addItem(data: {
    sprintId: string;
    projectId: string;
    category: 'went_well' | 'to_improve' | 'action_item';
    content: string;
    createdBy: string;
    aiGenerated?: boolean;
  }): Promise<RetrospectiveItem> {
    const item = await retrospectiveRepository.create(data);
    return item;
  }

  async deleteItem(id: string, userId: string): Promise<void> {
    const item = await retrospectiveRepository.findById(id);
    if (!item) throw new Error('Retrospective item not found');
    if (item.createdBy !== userId) throw new Error('Can only delete your own retro items');

    await retrospectiveRepository.deleteWithVotes(id);
  }

  async vote(itemId: string, userId: string): Promise<void> {
    await retrospectiveRepository.addVote(itemId, userId);
  }

  async unvote(itemId: string, userId: string): Promise<void> {
    await retrospectiveRepository.removeVote(itemId, userId);
  }

  async seedFromAI(sprintId: string, projectId: string, userId: string): Promise<RetrospectiveItem[]> {
    const sprint = await sprintService.getById(sprintId);
    if (!sprint) throw new Error('Sprint not found');

    const board = await sprintService.getSprintBoard(sprintId);
    const burndown = await sprintService.getSprintBurndown(sprintId);
    const velocity = await sprintService.getVelocityHistory(sprint.projectId);

    const tasks = board.tasks || [];
    const completed = tasks.filter((t: any) => t.status === 'completed');
    const incomplete = tasks.filter((t: any) => t.status !== 'completed');
    const totalPoints = tasks.reduce((s: number, t: any) => s + (t.storyPoints || t.story_points || 0), 0);
    const completedPoints = completed.reduce((s: number, t: any) => s + (t.storyPoints || t.story_points || 0), 0);
    const velocities = velocity.sprints?.map((s: any) => s.velocity) || [];
    const avgVelocity = velocities.length > 0 ? Math.round(velocities.reduce((a: number, b: number) => a + b, 0) / velocities.length) : 0;

    const prompt = `Generate structured retrospective items for this completed sprint. Return ONLY a JSON object with three arrays: went_well, to_improve, action_items. Each array contains strings (2-3 items each).

Sprint: ${sprint.name}
Goal: ${sprint.goal || 'No goal set'}
Dates: ${sprint.startDate} to ${sprint.endDate}
Velocity: ${completedPoints}/${totalPoints} pts (${completed.length}/${tasks.length} tasks)
Incomplete Tasks: ${incomplete.map((t: any) => t.name).join(', ') || 'None'}
Historical Avg Velocity: ${avgVelocity} pts/sprint

Return ONLY valid JSON like: {"went_well":["..."],"to_improve":["..."],"action_items":["..."]}`;

    try {
      const { claudeService } = await import('./claudeService');
      const result = await claudeService.complete({
        systemPrompt: 'You are an agile coach. Return ONLY valid JSON, no markdown or explanation.',
        userMessage: prompt,
        temperature: 0.5,
        maxTokens: 800,
      });

      const content = result.content.trim();
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in AI response');

      const parsed = JSON.parse(jsonMatch[0]);
      const items: RetrospectiveItem[] = [];

      for (const text of (parsed.went_well || [])) {
        items.push(await retrospectiveRepository.create({
          sprintId, projectId, category: 'went_well', content: text, createdBy: userId, aiGenerated: true,
        }));
      }
      for (const text of (parsed.to_improve || [])) {
        items.push(await retrospectiveRepository.create({
          sprintId, projectId, category: 'to_improve', content: text, createdBy: userId, aiGenerated: true,
        }));
      }
      for (const text of (parsed.action_items || [])) {
        items.push(await retrospectiveRepository.create({
          sprintId, projectId, category: 'action_item', content: text, createdBy: userId, aiGenerated: true,
        }));
      }

      return items;
    } catch (err: any) {
      logger.warn('AI retro seed failed', { error: err.message });
      throw new Error('Failed to generate AI retrospective items');
    }
  }

  async convertToTask(itemId: string, scheduleId: string, userId: string): Promise<{ taskId: string }> {
    const item = await retrospectiveRepository.findById(itemId);
    if (!item) throw new Error('Retrospective item not found');
    if (item.category !== 'action_item') throw new Error('Only action items can be converted to tasks');
    if (item.convertedTaskId) throw new Error('Item already converted to a task');

    const { scheduleService } = await import('./ScheduleService');
    const task = await scheduleService.createTask({
      scheduleId,
      name: item.content,
      status: 'pending',
      priority: 'medium',
      createdBy: userId,
    });

    await retrospectiveRepository.setConvertedTaskId(itemId, task.id);
    return { taskId: task.id };
  }
}

export const retrospectiveService = new RetrospectiveService();
