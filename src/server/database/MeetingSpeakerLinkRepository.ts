import { databaseService } from './connection';

/** The PM's "who's who" choice for a meeting speaker name; userId null = not a project member */
export interface SpeakerLink { speakerName: string; userId: string | null }

export const speakerKey = (name: string) => name.trim().toLowerCase().slice(0, 255);

class MeetingSpeakerLinkRepository {
  async findByNames(names: string[]): Promise<Map<string, SpeakerLink>> {
    const keys = [...new Set(names.map(speakerKey))];
    if (keys.length === 0) return new Map();
    const rows = await databaseService.query<{ speaker_key: string; speaker_name: string; user_id: string | null }>(
      `SELECT speaker_key, speaker_name, user_id FROM meeting_speaker_links WHERE speaker_key IN (${keys.map(() => '?').join(',')})`,
      keys,
    );
    return new Map(rows.map(r => [r.speaker_key, { speakerName: r.speaker_name, userId: r.user_id }]));
  }

  async save(links: SpeakerLink[], updatedBy: string): Promise<void> {
    for (const l of links) {
      await databaseService.query(
        `INSERT INTO meeting_speaker_links (speaker_key, speaker_name, user_id, updated_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE speaker_name = VALUES(speaker_name), user_id = VALUES(user_id), updated_by = VALUES(updated_by)`,
        [speakerKey(l.speakerName), l.speakerName.slice(0, 255), l.userId, updatedBy],
      );
    }
  }
}

export const meetingSpeakerLinkRepository = new MeetingSpeakerLinkRepository();
