import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { AutomationCooldown } from '../services/automation/types';

interface CooldownRow {
  id: string;
  automation_id: string;
  cooldown_key: string;
  last_fired_at: string;
  fire_count_today: number;
  fire_date: string;
}

function rowToDTO(row: CooldownRow): AutomationCooldown {
  return {
    id: row.id,
    automationId: row.automation_id,
    cooldownKey: row.cooldown_key,
    lastFiredAt: row.last_fired_at,
    fireCountToday: Number(row.fire_count_today),
    fireDate: row.fire_date,
  };
}

export class AutomationCooldownRepository extends BaseRepository<AutomationCooldown> {
  constructor() {
    super('automation_cooldowns', rowToDTO);
  }

  async upsert(automationId: string, cooldownKey: string): Promise<void> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO automation_cooldowns (id, automation_id, cooldown_key, last_fired_at, fire_count_today, fire_date)
       VALUES (?, ?, ?, NOW(), 1, CURDATE())
       ON DUPLICATE KEY UPDATE last_fired_at = NOW(),
         fire_count_today = IF(fire_date = CURDATE(), fire_count_today + 1, 1),
         fire_date = CURDATE()`,
      [id, automationId, cooldownKey],
    );
  }

  async get(automationId: string, cooldownKey: string): Promise<AutomationCooldown | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM automation_cooldowns WHERE automation_id = ? AND cooldown_key = ?',
      [automationId, cooldownKey],
    );
    return rows.length > 0 ? rowToDTO(rows[0]) : null;
  }

  async cleanupOld(daysOld = 7): Promise<number> {
    const result = await this.queryRaw(
      'DELETE FROM automation_cooldowns WHERE fire_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)',
      [daysOld],
    ) as any;
    return result.affectedRows ?? 0;
  }
}

export const automationCooldownRepository = new AutomationCooldownRepository();
