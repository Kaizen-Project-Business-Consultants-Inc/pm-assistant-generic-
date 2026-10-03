import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve, relative } from 'path';

/**
 * Import tangles (code health, 2026-10-03). Parts of the server that import each other in a
 * circle went from 18 to 49 in September; the code had grown ~117 "load it later" workarounds
 * to keep starting up. A tangle makes changes riskier: the next ordinary import can stop the
 * server starting, or quietly stop a reaction (e.g. Schedule Review re-running).
 *
 * This guard reads every import with TypeScript's own parser (type-only imports don't count —
 * they vanish when the code is built; "load it later" imports DO count — they are the
 * workaround, not the cure), finds the groups of files that import each other in a circle,
 * and counts the import links inside those groups ("tangled links").
 *
 * The ceilings may only go DOWN. Untangling work lowers them step by step; a change that
 * adds a tangle fails here and names the links, so it is fixed before it ships.
 */
const CEILING = {
  // 2026-10-03 baseline: 104 links / 38 files (one knot of 33 files around the schedule, plus
  // Embedding and RAID Review pairs). On 2026-09-01 it was 21 / 11.
  // Step 1B ("something changed" notices, services/domainEvents.ts): 80 / 31, RAID knot gone.
  // Step 1C (database layer stops calling business logic): 74 / 28, Embedding pair gone.
  server: { tangledLinks: 74, filesInTangles: 28 },
  client: { tangledLinks: 5, filesInTangles: 5 },
};

const ROOT = resolve(__dirname, '..', '..', '..', '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|d)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // packages are not ours
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const cand of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    if (existsSync(cand) && statSync(cand).isFile() && /\.(ts|tsx)$/.test(cand)) return cand;
  }
  return null;
}

/** The imports that exist when the code runs: value imports, re-exports and import() calls */
export function runtimeImports(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings
        && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0
        && clause.namedBindings.elements.every(e => e.isTypeOnly)));
      if (!typeOnly) specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly));
      if (!typeOnly) specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specs.push(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node)) {
      return; // `typeof import('x')` / `import('x').T` — a type, gone at run time
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...new Set(specs.map(s => resolveImport(file, s)).filter((x): x is string => !!x))];
}

export interface TangleReport { tangledLinks: string[]; filesInTangles: number; groups: string[][] }

/** Groups of files that import each other in a circle (Tarjan's strongly connected components) */
export function analyse(srcDir: string): TangleReport {
  const files = listSourceFiles(srcDir);
  const graph = new Map(files.map(f => [f, runtimeImports(f).filter(t => t !== f)]));
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const g: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); g.push(w); } while (w !== v);
      if (g.length > 1) groups.push(g);
    }
  };
  for (const f of files) if (!idx.has(f)) strong(f);
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.forEach(f => groupOf.set(f, i)));
  const rel = (f: string) => relative(srcDir, f).replace(/\\/g, '/');
  const tangledLinks: string[] = [];
  for (const [from, tos] of graph) {
    const g = groupOf.get(from);
    if (g === undefined) continue;
    for (const to of tos) if (groupOf.get(to) === g) tangledLinks.push(`${rel(from)} -> ${rel(to)}`);
  }
  return { tangledLinks: tangledLinks.sort(), filesInTangles: groupOf.size, groups: groups.map(g => g.map(rel).sort()) };
}

describe('import tangles may only go down', () => {
  for (const [name, dir] of [['server', join(ROOT, 'src', 'server')], ['client', join(ROOT, 'src', 'client', 'src')]] as const) {
    it(`${name}: no more tangled links than the ceiling`, () => {
      const r = analyse(dir);
      const ceiling = CEILING[name];
      const msg = `${name}: ${r.tangledLinks.length} tangled links (ceiling ${ceiling.tangledLinks}), ${r.filesInTangles} files in ${r.groups.length} tangle(s).\n`
        + 'A new import closed a circle. Instead of importing the other part directly, announce the change (domain events) or move the shared piece down a layer.\n'
        + r.tangledLinks.join('\n');
      expect(r.tangledLinks.length, msg).toBeLessThanOrEqual(ceiling.tangledLinks);
      expect(r.filesInTangles, msg).toBeLessThanOrEqual(ceiling.filesInTangles);
      if (process.env.PRINT_TANGLES) console.log(msg);
    }, 60_000);
  }
});

describe('the tangle finder itself', () => {
  const fixture = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'tangles-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  it('finds a circle, including one closed by a "load it later" import()', () => {
    const dir = fixture({
      'a.ts': "import { b } from './b';\nexport const a = () => b();",
      'b.ts': "export const b = async () => (await import('./a')).a;",
      'c.ts': "import { a } from './a';\nexport const c = a;",
    });
    try {
      const r = analyse(dir);
      expect(r.tangledLinks).toEqual(['a.ts -> b.ts', 'b.ts -> a.ts']);
      expect(r.filesInTangles).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('type-only imports do not count — they are gone when the code runs', () => {
    const dir = fixture({
      'a.ts': "import type { B } from './b';\nimport { type C } from './c';\nexport type A = B | C;\nexport const a = 1;",
      'b.ts': "import { a } from './a';\nexport type B = typeof a;",
      'c.ts': "export type C = typeof import('./a');",
    });
    try {
      expect(analyse(dir).tangledLinks).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/**
 * Layering (step 1C): the database layer reads and writes rows; it never calls business logic.
 * TaskRepository asking TaskAssignmentService for a plain read closed a large circle. Type
 * labels (`import type`) are fine — they vanish when built. Plain helpers with no app imports
 * of their own are listed here.
 */
describe('the database layer never calls business logic', () => {
  const ALLOWED = new Set([
    'services/RedisService.ts',          // cache client used by CachedRepository
    'services/dagWorkflow/types.ts',     // plain types/constants
    'services/dagWorkflow/rowMappers.ts',// plain row → object mappers
  ]);
  // The data layer: repositories, the connection and plain row helpers. (tenantProvisioner /
  // tenantMigrationRunner also live in database/ but are company-setup scripts that run the layer,
  // not part of it — nothing in the layer imports them.)
  const isDataLayer = (name: string) => /Repository\.ts$|^connection\.ts$|^bookingDates\.ts$|^BaseRepository\.ts$/.test(name);
  it('repositories import from services/ only type labels or the listed plain helpers', () => {
    const SERVER = join(ROOT, 'src', 'server');
    const dbDir = join(SERVER, 'database');
    const offenders: string[] = [];
    for (const f of readdirSync(dbDir).filter(isDataLayer).map(n => join(dbDir, n))) {
      for (const to of runtimeImports(f)) {
        const rel = relative(SERVER, to).replace(/\\/g, '/');
        if (rel.startsWith('services/') && !ALLOWED.has(rel)) offenders.push(`database/${relative(dbDir, f)} -> ${rel}`);
      }
    }
    expect(offenders, 'Move the read into a repository, or import only types (import type)').toEqual([]);
  });
});
