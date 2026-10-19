import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The code's embedding document types must all exist in the `embeddings.document_type` ENUM.
 * Until 2026-10-19 'project_document' was in the code but never in the column, so every document
 * insert failed and document search never found anything (RAG-2) — mocked tests could not see it.
 */
const MIGRATIONS = path.resolve(__dirname, '../../database/migrations');
const SERVICE = path.resolve(__dirname, '../../services/EmbeddingService.ts');

function latestEnum(): string[] {
  const files = fs.readdirSync(MIGRATIONS).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  let values: string[] = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    const re = /(?:CREATE TABLE[^;]*?\bembeddings\b[^;]*?|ALTER TABLE\s+embeddings[^;]*?)document_type\s+ENUM\(([^)]*)\)/gis;
    for (const m of sql.matchAll(re)) values = [...m[1].matchAll(/'([^']+)'/g)].map(v => v[1]);
  }
  return values;
}

describe('embedding document types vs the database column', () => {
  it('every type in EmbeddingDocumentType is allowed by the latest migration', () => {
    const src = fs.readFileSync(SERVICE, 'utf8');
    const union = /export type EmbeddingDocumentType\s*=\s*([^;]+);/.exec(src)![1];
    const codeTypes = [...union.matchAll(/'([^']+)'/g)].map(m => m[1]);
    const column = latestEnum();
    expect(column.length).toBeGreaterThan(0);
    expect(codeTypes.filter(t => !column.includes(t))).toEqual([]);
  });
});
