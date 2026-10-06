/**
 * Accessible-name scanner for the React client (src/client/src).
 *
 * Lists every <input>, <select>, <textarea> and icon-only <button> that a screen reader would
 * announce with no name ("edit text", "combo box", "button"). Uses the TypeScript compiler's
 * parser, not regex (CLAUDE.md lesson 4): it walks the real JSX tree.
 *
 * A control HAS a name when it has any of:
 *  - aria-label / aria-labelledby / title (any value — dynamic values are trusted), set directly or
 *    through a spread of an object literal declared in the same file ({...common});
 *  - an `id` whose expression matches a `<label htmlFor>` in the same file (compared as source text);
 *  - an ancestor `<label>` element in the same JSX tree;
 *  - for <button>: visible text anywhere inside it (text, a {expression} that could be text,
 *    or text inside a child element), or a `value` on <input type="button">.
 * <input type="hidden|submit|reset"> are skipped (no name needed / browser default name).
 * A placeholder is NOT a name here: it vanishes once someone types, and it is not a label.
 *
 * Run: npx tsx scripts/a11y-scan.ts   (prints every unnamed control and the totals)
 * Guarded by src/client/src/__tests__/utils/a11yNamesGuard.test.ts (a ratchet).
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface UnnamedControl {
  file: string; // relative to src/client/src, forward slashes
  line: number;
  tag: 'input' | 'select' | 'textarea' | 'button';
  snippet: string; // first line of the element, trimmed
}

type JsxEl = ts.JsxElement | ts.JsxSelfClosingElement;

function opening(el: JsxEl): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(el) ? el.openingElement : el;
}

function tagName(el: JsxEl): string {
  return opening(el).tagName.getText();
}

function attrs(el: JsxEl): { map: Map<string, ts.JsxAttribute>; spread: boolean } {
  const map = new Map<string, ts.JsxAttribute>();
  let spread = false;
  for (const p of opening(el).attributes.properties) {
    if (ts.isJsxAttribute(p)) map.set(p.name.getText(), p);
    else spread = true;
  }
  return { map, spread };
}

/** Source text of an attribute value, normalised so `"x"` and `{'x'}` and `{"x"}` compare equal */
function valueKey(a: ts.JsxAttribute): string | null {
  const init = a.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return `"${init.text}"`;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return `"${e.text}"`;
    return e.getText().replace(/\s+/g, '');
  }
  return null;
}

function stringAttr(a: ts.JsxAttribute | undefined): string | null {
  if (!a || !a.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteral(a.initializer.expression)) {
    return a.initializer.expression.text;
  }
  return null;
}

/** An attribute that is present and not literally empty / undefined */
function hasNonEmpty(a: ts.JsxAttribute | undefined): boolean {
  if (!a) return false;
  if (!a.initializer) return false;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text.trim() !== '';
  if (ts.isJsxExpression(a.initializer)) {
    const e = a.initializer.expression;
    if (!e) return false;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.trim() !== '';
    if (ts.isIdentifier(e) && e.text === 'undefined') return false;
    return true;
  }
  return false;
}

/** Could this expression render text? Literals, identifiers, calls and the like: yes. JSX: look inside. */
function exprHasText(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return exprHasText(e.expression);
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return nodeHasText(e);
  if (ts.isConditionalExpression(e)) return exprHasText(e.whenTrue) || exprHasText(e.whenFalse);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return exprHasText(e.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return exprHasText(e.left) || exprHasText(e.right);
    }
    return true; // string concatenation etc.
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.TrueKeyword) return false;
  if (ts.isIdentifier(e) && e.text === 'undefined') return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.trim() !== '';
  // identifiers, calls (t('x'), fmt(n)), property access, template expressions, numbers...
  return true;
}

/** Does a JSX node contain any visible text? Self-closing custom components (icons) do not. */
function nodeHasText(n: ts.Node): boolean {
  if (ts.isJsxText(n)) return n.text.trim() !== '';
  if (ts.isJsxExpression(n)) return !!n.expression && exprHasText(n.expression);
  if (ts.isJsxSelfClosingElement(n)) {
    // <img alt="..."> is text for naming purposes
    if (n.tagName.getText() === 'img') return hasNonEmpty(attrs(n).map.get('alt'));
    return false;
  }
  if (ts.isJsxElement(n)) {
    const a = attrs(n).map;
    if (stringAttr(a.get('aria-hidden')) === 'true' || (a.get('aria-hidden') && !a.get('aria-hidden')!.initializer)) return false;
    return n.children.some(nodeHasText);
  }
  if (ts.isJsxFragment(n)) return n.children.some(nodeHasText);
  return false;
}

/** A spread like {...common} whose object literal (declared in this file) sets aria-label / aria-labelledby */
function spreadNames(el: JsxEl, objects: Map<string, ts.ObjectLiteralExpression>): boolean {
  return opening(el).attributes.properties.some(p => {
    if (!ts.isJsxSpreadAttribute(p) || !ts.isIdentifier(p.expression)) return false;
    const obj = objects.get(p.expression.text);
    return !!obj && obj.properties.some(prop => ts.isPropertyAssignment(prop) && prop.name &&
      ['aria-label', 'aria-labelledby'].includes(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : ''));
  });
}

function insideLabel(el: ts.Node): boolean {
  for (let p: ts.Node | undefined = el.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === 'label') return true;
  }
  return false;
}

export function scanSource(file: string, source: string): UnnamedControl[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labelFor = new Set<string>();
  const controls: JsxEl[] = [];
  /** `const common = { 'aria-label': ..., ... }` — object literals a control may spread in */
  const objectLiterals = new Map<string, ts.ObjectLiteralExpression>();

  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      objectLiterals.set(n.name.text, n.initializer);
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const name = tagName(n);
      if (name === 'label') {
        const f = attrs(n).map.get('htmlFor');
        const k = f && valueKey(f);
        if (k) labelFor.add(k);
      }
      if (name === 'input' || name === 'select' || name === 'textarea' || name === 'button') controls.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const out: UnnamedControl[] = [];
  for (const el of controls) {
    const tag = tagName(el) as UnnamedControl['tag'];
    const { map } = attrs(el);
    if (hasNonEmpty(map.get('aria-label')) || hasNonEmpty(map.get('aria-labelledby')) || hasNonEmpty(map.get('title'))) continue;
    if (spreadNames(el, objectLiterals)) continue;

    if (tag === 'button') {
      if (ts.isJsxElement(el) && el.children.some(nodeHasText)) continue;
      if (insideLabel(el)) continue;
    } else {
      if (tag === 'input') {
        const type = stringAttr(map.get('type'));
        if (type === 'hidden' || type === 'submit' || type === 'reset') continue;
        if ((type === 'button') && hasNonEmpty(map.get('value'))) continue;
        if (type === 'image' && hasNonEmpty(map.get('alt'))) continue;
      }
      const id = map.get('id');
      const k = id && valueKey(id);
      if (k && labelFor.has(k)) continue;
      if (insideLabel(el)) continue;
    }
    const start = opening(el).getStart(sf);
    const { line } = sf.getLineAndCharacterOfPosition(start);
    out.push({ file, line: line + 1, tag, snippet: source.slice(start).split('\n')[0].trim().slice(0, 100) });
  }
  return out;
}

export const CLIENT_SRC = join(__dirname, '..', 'src', 'client', 'src');

/** Every .tsx under src/client/src except tests, relative paths with forward slashes */
export function clientTsxFiles(dir = CLIENT_SRC, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === '__fixtures__') continue;
      out.push(...clientTsxFiles(full, r));
    } else if (name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(name)) {
      out.push(r);
    }
  }
  return out.sort();
}

export function scanClient(): UnnamedControl[] {
  return clientTsxFiles().flatMap(f => scanSource(f, readFileSync(join(CLIENT_SRC, f), 'utf8')));
}

export function countByFile(list: UnnamedControl[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const u of list) c[u.file] = (c[u.file] ?? 0) + 1;
  return c;
}
