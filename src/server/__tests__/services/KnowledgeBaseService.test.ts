import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('../../config', () => ({
  config: {
    EMBEDDING_ENABLED: false,
    OPENAI_API_KEY: '',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 1536,
    RAG_TOP_K: 5,
    RAG_SIMILARITY_THRESHOLD: 0.5,
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { KnowledgeBaseService } from '../../services/KnowledgeBaseService';

const service = new KnowledgeBaseService();

const parse = (md: string, file = 'docs/USER_GUIDE.md', name = 'User Guide') =>
  service.parseMarkdownToChunks(md, file, name);

describe('KnowledgeBaseService', () => {
  describe('parseMarkdownToChunks', () => {
    it('creates a single chunk from simple content', () => {
      const md = '## Getting Started\n\nSome intro text here.';
      const chunks = parse(md);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].title).toBe('Getting Started');
      expect(chunks[0].content).toContain('Some intro text here.');
    });

    it('splits on ### headings', () => {
      const md = [
        '## Tasks',
        '### Creating Tasks',
        'Click the + button.',
        '### Deleting Tasks',
        'Click the trash icon.',
      ].join('\n');

      const chunks = parse(md);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].title).toBe('Creating Tasks');
      expect(chunks[0].content).toContain('Click the + button.');
      expect(chunks[1].title).toBe('Deleting Tasks');
      expect(chunks[1].content).toContain('Click the trash icon.');
    });

    it('includes breadcrumb in content', () => {
      const md = '## Schedules\n### Adding Tasks\n\nUse the Gantt chart.';
      const chunks = parse(md);
      expect(chunks[0].content).toContain('[User Guide > Schedules > Adding Tasks]');
    });

    it('generates deterministic slug IDs', () => {
      const md = '## Risk Management\n### Identifying Risks\n\nSome content.';
      const chunks = parse(md);
      expect(chunks[0].id).toBe('kb:user-guide:risk-management:identifying-risks');
    });

    it('handles content before first ### under a ##', () => {
      const md = [
        '## Overview',
        'This is the overview intro.',
        '### Details',
        'Detail content here.',
      ].join('\n');

      const chunks = parse(md);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].title).toBe('Overview');
      expect(chunks[0].content).toContain('overview intro');
      expect(chunks[1].title).toBe('Details');
    });

    it('handles content before any heading', () => {
      const md = 'This is top-level content with no heading.';
      const chunks = parse(md);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].title).toBe('User Guide');
      expect(chunks[0].sectionPath).toBe('User Guide');
    });

    it('uses source name in section path', () => {
      const md = '## Admin\n### Users\n\nManage users here.';
      const chunks = parse(md, 'docs/ADMIN_MANUAL.md', 'Admin Manual');
      expect(chunks[0].sectionPath).toBe('Admin Manual > Admin > Users');
      expect(chunks[0].sourceFile).toBe('docs/ADMIN_MANUAL.md');
    });

    it('generates unique IDs for different sections', () => {
      const md = [
        '## Section A',
        '### Sub 1',
        'Content A1.',
        '### Sub 2',
        'Content A2.',
        '## Section B',
        '### Sub 1',
        'Content B1.',
      ].join('\n');

      const chunks = parse(md);
      const ids = chunks.map(c => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('computes content hash', () => {
      const md = '## Test\n### Hash Test\n\nSome content.';
      const chunks = parse(md);
      expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('splits large chunks at paragraph boundaries', () => {
      const paragraphs: string[] = [];
      for (let i = 0; i < 20; i++) {
        paragraphs.push('word '.repeat(100).trim());
      }
      const md = '## Big Section\n### Big Subsection\n\n' + paragraphs.join('\n\n');

      const chunks = parse(md);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].title).toContain('Part 1');
      expect(chunks[1].title).toContain('Part 2');
      expect(chunks[0].id).toContain('-part1');
      expect(chunks[1].id).toContain('-part2');
    });

    it('does not split chunks under 1500 words', () => {
      const content = 'word '.repeat(1000).trim();
      const md = `## Normal\n### Normal Sub\n\n${content}`;
      const chunks = parse(md);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].title).toBe('Normal Sub');
    });

    it('handles empty markdown', () => {
      const chunks = parse('');
      expect(chunks).toHaveLength(0);
    });

    it('handles markdown with only headings', () => {
      const md = '## Heading One\n## Heading Two';
      const chunks = parse(md);
      expect(chunks).toHaveLength(0);
    });
  });
});
