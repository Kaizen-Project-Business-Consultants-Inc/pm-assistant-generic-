/**
 * Guard (2026-10-06): axios's get(url, config) and delete(url, config) take request OPTIONS as
 * the second argument, not a body. A body passed there is silently dropped (or a field named
 * like an option — params, headers, data — is misread). Every axios get/delete in the client
 * must pass either nothing or an object literal of axios options: query values go in
 * `{ params }`, a DELETE body in `{ data }`. apiService.request() does this for its callers.
 * No call may pick the verb dynamically (`this.api[method](...)`), which hides this.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const ROOT = join(__dirname, '../..'); // src/client/src
const AXIOS_OPTIONS = new Set([
  'params', 'data', 'signal', 'responseType', 'headers', 'timeout', 'withCredentials', 'validateStatus',
  'onDownloadProgress', 'onUploadProgress', 'paramsSerializer', 'baseURL', 'maxContentLength', 'transformResponse',
]);
/** The receivers that are the axios instance (or axios itself) */
const AXIOS_RECEIVER = /^(this\.api|api|axios|http|apiClient|axiosInstance)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('axios get/delete never get a body as their second argument', () => {
  it('every call passes no second argument or an object of axios options', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of sourceFiles(ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (!/\.(get|delete)\(|\]\(/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        // No computed verb on the axios instance (`this.api[method](url, x)`): it hides which
        // verb gets `x` — that is how the generic helper sent GET/DELETE data as options
        if (ts.isCallExpression(n) && ts.isElementAccessExpression(n.expression)
          && AXIOS_RECEIVER.test(n.expression.expression.getText(sf))) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          offenders.push(`${relative(ROOT, file)}:${line + 1}  computed verb: ${n.getText(sf).replace(/\s+/g, ' ').slice(0, 120)}`);
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
          && (n.expression.name.text === 'get' || n.expression.name.text === 'delete')
          && AXIOS_RECEIVER.test(n.expression.expression.getText(sf))) {
          checked++;
          const second = n.arguments[1];
          const ok = !second
            || (second.kind === ts.SyntaxKind.UndefinedKeyword || second.getText(sf) === 'undefined')
            || (ts.isObjectLiteralExpression(second) && second.properties.every(p => {
              const key = p.name ? p.name.getText(sf).replace(/['"]/g, '') : '';
              return AXIOS_OPTIONS.has(key);
            }))
            // the generic helper builds its options conditionally: `x === undefined ? undefined : { params: x }`
            || (ts.isConditionalExpression(second)
              && [second.whenTrue, second.whenFalse].every(b => b.getText(sf) === 'undefined'
                || (ts.isObjectLiteralExpression(b) && b.properties.every(p => AXIOS_OPTIONS.has(p.name?.getText(sf) ?? '')))));
          if (!ok) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            offenders.push(`${relative(ROOT, file)}:${line + 1}  ${n.getText(sf).replace(/\s+/g, ' ').slice(0, 120)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(checked).toBeGreaterThan(100); // the scan really found the client's API calls
    expect(offenders).toEqual([]);
  });
});
