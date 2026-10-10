import type { FastifyRequest } from 'fastify';
import { databaseService } from '../database/connection';
import { trialAccountOf } from './trialEmail';

/**
 * The free trial runs every analysis on the user's own data (user, 2026-10-10). Only when a
 * project has nothing to analyse yet does a trial user see an example instead, sent with
 * `sample: true` so the screen labels it. Paid users keep the normal empty answer.
 */

/** Is the caller on the free trial? (admins never are; a viewer is judged by the company's plan) */
export async function isTrialUser(request: FastifyRequest): Promise<boolean> {
  if (request.user!.role === 'admin') return false;
  return (await trialAccountOf(request.user!.userId)) !== null;
}

/** Does the project have at least one task? One indexed lookup. */
export async function projectHasTasks(projectId: string): Promise<boolean> {
  const rows = await databaseService.query<{ one: number }>(
    'SELECT 1 AS one FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE s.project_id = ? LIMIT 1',
    [projectId],
  );
  return rows.length > 0;
}

/** Does the project have at least one RAID item? One indexed lookup. */
export async function projectHasRaidItems(projectId: string): Promise<boolean> {
  const rows = await databaseService.query<{ one: number }>(
    'SELECT 1 AS one FROM project_risks WHERE project_id = ? LIMIT 1',
    [projectId],
  );
  return rows.length > 0;
}

/** Show the example instead: a trial user, and the project has nothing to analyse. */
export async function showTrialExample(request: FastifyRequest, hasData: (projectId: string) => Promise<boolean>, projectId: string): Promise<boolean> {
  if (await hasData(projectId)) return false;
  return isTrialUser(request);
}
