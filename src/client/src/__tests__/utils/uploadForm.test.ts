import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { uploadForm } from '../../utils/uploadForm';

/**
 * Upload bodies send their fields BEFORE the file (2026-10-14). The server's request.file() only
 * sees fields ahead of the file: every Meeting Intelligence transcript upload failed and Doc
 * Intelligence lost the description because the file went first.
 */
/** A FormData built by hand: the file appended, then another field appended after it */
const FILE_THEN_FIELD = /\.append\(['"`]file['"`][^;]*;\s*(?:if \([^)]*\) )?\w+\.append\(/;

describe('uploadForm', () => {
  it('puts every field ahead of the file and leaves out empty ones', () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const form = uploadForm(file, { projectId: 'p1', scheduleId: 's1', meetingId: undefined, description: '' });
    expect([...form.keys()]).toEqual(['projectId', 'scheduleId', 'file']);
    expect(form.get('projectId')).toBe('p1');
  });

  it('no API call appends a field after the file (use uploadForm)', () => {
    const dir = join(__dirname, '..', '..', 'services', 'apiAreas');
    const offenders: string[] = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, name), 'utf-8');
      // a FormData built by hand: the file appended, then another append before the request is sent
      if (FILE_THEN_FIELD.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
    // the scan really catches the old shape
    expect(FILE_THEN_FIELD.test("formData.append('file', file);\n    formData.append('projectId', projectId);")).toBe(true);
  });
});
