import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { splitUserGuide, searchGuide, findGuideAnchor } from '../../utils/userGuide';

const sample = [
  '# PM Assistant -- User Guide',
  'intro',
  '## Table of Contents',
  '1. Getting Started',
  '## 1. Getting Started',
  'Sign in.',
  '### Settings (Admin/Manager)',
  'Manager things.',
  '### Admin AI Usage (Admin Only)',
  'Admin things.',
  '### Everyday',
  'For everyone.',
  '## 2. Projects',
  'Create a project.',
].join('\n');

describe('splitUserGuide (in-app full guide)', () => {
  it('makes one chapter per "## " heading and drops the file\'s own contents list', () => {
    const ch = splitUserGuide(sample, 'admin');
    expect(ch.map(c => [c.id, c.title])).toEqual([['1-getting-started', '1. Getting Started'], ['2-projects', '2. Projects']]);
  });

  it('shows admin-only parts to admins only, and admin/manager parts to managers', () => {
    const member = splitUserGuide(sample, 'team_member')[0].markdown;
    expect(member).not.toContain('Manager things');
    expect(member).not.toContain('Admin things');
    expect(member).toContain('For everyone');
    const pm = splitUserGuide(sample, 'project_manager')[0].markdown;
    expect(pm).toContain('Manager things');
    expect(pm).not.toContain('Admin things');
    expect(splitUserGuide(sample, 'admin')[0].markdown).toContain('Admin things');
  });

  it('search matches every word in the title or text', () => {
    const ch = splitUserGuide(sample, 'admin');
    expect(searchGuide(ch, 'create project').map(c => c.id)).toEqual(['2-projects']);
    expect(searchGuide(ch, '').length).toBe(2);
  });

  it('the real guide splits into its chapters', () => {
    const md = readFileSync(join(__dirname, '../../../../../docs/USER_GUIDE.md'), 'utf-8');
    const ch = splitUserGuide(md, 'team_member');
    expect(ch.length).toBeGreaterThan(30);
    expect(ch.some(c => /Resources/.test(c.title))).toBe(true);
    expect(ch.every(c => !/admin only/i.test(c.markdown.split('\n').filter(l => l.startsWith('###')).join('\n')))).toBe(true);
  });
});

describe('sub-heading ids (links to a heading, 2026-10-08)', () => {
  const md = [
    '## 1. Setup',
    '### Admin Tools (Admin Only)',
    '#### Permissions',
    'admin text',
    '### Everyday',
    '#### Permissions',
    'everyone',
    '## 2. Notifications & Alerts',
    '### Notifications',
    '### A <kbd>key</kbd> trick',
  ].join('\n');

  it("a repeated heading keeps GitHub's number even when an earlier copy is hidden from this reader", () => {
    expect(splitUserGuide(md, 'admin')[0].headingIds).toEqual(['admin-tools-admin-only', 'permissions', 'everyday', 'permissions-1']);
    expect(splitUserGuide(md, 'team_member')[0].headingIds).toEqual(['everyday', 'permissions-1']);
  });

  it('a heading repeating a chapter title is numbered; inline HTML is left out of the id', () => {
    expect(splitUserGuide(md)[1].headingIds).toEqual(['notifications', 'a-key-trick']);
  });

  it("finds a chapter by the app's id or GitHub's, and a sub-heading's chapter", () => {
    const ch = splitUserGuide(md, 'team_member');
    expect(findGuideAnchor(ch, '2-notifications-alerts')).toEqual({ chapterId: '2-notifications-alerts' });
    expect(findGuideAnchor(ch, '2-notifications--alerts')).toEqual({ chapterId: '2-notifications-alerts' });
    expect(findGuideAnchor(ch, 'permissions-1')).toEqual({ chapterId: '1-setup', headingId: 'permissions-1' });
    expect(findGuideAnchor(ch, 'permissions')).toBeNull(); // the admin-only copy
    expect(findGuideAnchor(ch, '')).toBeNull();
  });
});
