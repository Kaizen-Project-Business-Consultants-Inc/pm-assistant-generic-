import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RAID, meetings and lessons learned ask the database a fixed number of times, not once per
 * item (2026-10-09, batch 4 of the loop clean-up) — with the same values as the one-row statements.
 */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[]; plane: 'tenant' | 'control' }>, answer: (_sql: string, _p: any[]): any => [] }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params, plane: 'tenant' }); return db.answer(sql, params); }),
    queryControlPlane: vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params, plane: 'control' }); return db.answer(sql, params); }),
  },
}));
vi.mock('../../services/RagService', () => ({ ragService: { indexLesson: vi.fn(async () => {}) } }));
vi.mock('../../services/EmbeddingService', () => ({ embeddingService: {} }));

import { meetingSpeakerLinkRepository } from '../../database/MeetingSpeakerLinkRepository';
import { riskRepository } from '../../database/RiskRepository';
import { embeddingRepository } from '../../database/EmbeddingRepository';
import { lessonsLearnedService } from '../../services/lessonsLearned';

const stmts = (re: RegExp) => db.sql.filter(s => re.test(s.sql.trim()));

beforeEach(() => { db.sql = []; db.answer = () => []; });

describe('meeting speaker names', () => {
  it('250 names: 2 statements; each row is (key, name, person, saved by), in order', async () => {
    const links = Array.from({ length: 250 }, (_, i) => ({ speakerName: ` Speaker ${i} `, userId: i % 2 ? `u${i}` : null }));
    await meetingSpeakerLinkRepository.save(links, 'pm1');
    const ins = stmts(/^INSERT INTO meeting_speaker_links/);
    expect(ins.map(s => s.params.length / 4)).toEqual([200, 50]);
    expect(ins[1].params.slice(0, 4)).toEqual(['speaker 200', ' Speaker 200 ', null, 'pm1']);
    expect(ins[0].sql).toMatch(/ON DUPLICATE KEY UPDATE/);
  });
});

describe('RAID owner backfill', () => {
  it('one name look-up and one update for every item; "A / B" takes the first with an account', async () => {
    db.answer = (sql) => {
      if (sql.includes('FROM project_risks')) return [
        { id: 'r1', owner_name: 'Ann Lee' },
        { id: 'r2', owner_name: 'Nobody (contractor) / Bob' },
        { id: 'r3', owner_name: 'Nobody' },
        { id: 'r4', owner_name: 'Bob & Ann Lee' },
      ];
      if (sql.includes('FROM resources')) return [{ name: 'Ann Lee', user_id: 'uA' }, { name: 'Bob', user_id: 'uB' }];
      return [];
    };
    const linked = await riskRepository.backfillOwnerIds();
    expect(linked).toBe(3);
    expect(stmts(/FROM resources/)).toHaveLength(1);
    const ups = stmts(/^UPDATE project_risks SET owner_id = CASE/);
    expect(ups).toHaveLength(1);
    expect(ups[0].params).toEqual(['r1', 'uA', 'r2', 'uB', 'r4', 'uB', 'r1', 'r2', 'r4']);
  });

  it('names match as the database does: capitals, accents and spaces do not matter', async () => {
    db.answer = (sql) => {
      if (sql.includes('FROM project_risks')) return [{ id: 'r1', owner_name: 'ann lee' }, { id: 'r2', owner_name: 'Jose Diaz' }];
      if (sql.includes('FROM resources')) return [{ name: 'Ann Lee ', user_id: 'uA' }, { name: 'José Díaz', user_id: 'uJ' }];
      return [];
    };
    expect(await riskRepository.backfillOwnerIds()).toBe(2);
    expect(stmts(/^UPDATE project_risks/)[0].params).toEqual(['r1', 'uA', 'r2', 'uJ', 'r1', 'r2']);
  });

  it('nothing to link: no updates', async () => {
    db.answer = (sql) => (sql.includes('FROM project_risks') ? [{ id: 'r1', owner_name: 'Ghost' }] : []);
    expect(await riskRepository.backfillOwnerIds()).toBe(0);
    expect(stmts(/^UPDATE/)).toHaveLength(0);
  });
});

describe('RAID items by id', () => {
  it('one read for many ids, duplicates asked once; none for an empty list', async () => {
    await riskRepository.findByIds(['a', 'b', 'a']);
    expect(stmts(/FROM project_risks WHERE id IN/)[0].params).toEqual(['a', 'b']);
    db.sql = [];
    expect(await riskRepository.findByIds([])).toEqual([]);
    expect(db.sql).toHaveLength(0);
  });
});

describe('knowledge base clean-up', () => {
  it('1,200 old sections: 3 deletes on the shared database, 500 ids each at most', async () => {
    await embeddingRepository.deleteMany('knowledge_base', Array.from({ length: 1200 }, (_, i) => `kb${i}`));
    const dels = stmts(/^DELETE FROM embeddings/);
    expect(dels.map(d => d.params.length - 1)).toEqual([500, 500, 200]);
    expect(dels.every(d => d.plane === 'control' && d.params[0] === 'knowledge_base')).toBe(true);
  });
});

describe('lessons learned', () => {
  const lesson = (i: number) => ({
    id: `ll${i}`, projectId: 'p1', projectName: 'P', projectType: 'it', category: 'schedule', title: `L${i}`,
    description: 'd', impact: 'negative', recommendation: 'r', confidence: 70, createdAt: '2026-10-09T00:00:00Z',
  }) as any;

  it('150 lessons: 2 inserts of 22 values each row, same order as before', async () => {
    await lessonsLearnedService.persistLessons(Array.from({ length: 150 }, (_, i) => lesson(i)));
    const ins = stmts(/^INSERT INTO lessons_learned/);
    expect(ins.map(s => s.params.length / 22)).toEqual([100, 50]);
    expect(ins[1].params.slice(0, 22)).toEqual([
      'll100', 'p1', 'P', 'it', 'schedule', 'L100', 'd', 'negative', 'r',
      null, null, 0, 0, null, 70, 'approved', null, 'manual', null, 0, null, '2026-10-09T00:00:00Z',
    ]);
  });

  it('a single lesson still saves the same way', async () => {
    await lessonsLearnedService.persistLesson(lesson(1));
    expect(stmts(/^INSERT INTO lessons_learned/)[0].params).toHaveLength(22);
  });

  it('patterns: cleared, then one insert per 200', async () => {
    const pats = Array.from({ length: 3 }, (_, i) => ({ id: `pat${i}`, title: 't', description: 'd', frequency: 2, projectTypes: ['it'], category: 'c', recommendation: 'r', confidence: 60, detectedAt: '2026-10-09' })) as any;
    await lessonsLearnedService.persistPatterns(pats);
    expect(db.sql[0].sql).toMatch(/^DELETE FROM lesson_patterns/);
    const ins = stmts(/^INSERT INTO lesson_patterns/);
    expect(ins).toHaveLength(1);
    expect(ins[0].params.slice(9, 18)).toEqual(['pat1', 't', 'd', 2, '["it"]', 'c', 'r', 60, '2026-10-09']);
  });
});
