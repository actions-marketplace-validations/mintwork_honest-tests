import { parse, type ParserPlugin } from '@babel/parser';
import type * as t from '@babel/types';
import { extname } from 'node:path';
import type { ExprInfo } from '../../core/types.js';

export type Node = t.Node;

export function parseSource(path: string, source: string): t.File {
  const ext = extname(path).toLowerCase();
  const plugins: ParserPlugin[] = ['decorators-legacy', 'importAttributes'];
  if (['.ts', '.mts', '.cts'].includes(ext)) plugins.push('typescript');
  else if (ext === '.tsx') plugins.push('typescript', 'jsx');
  else plugins.push('jsx');
  return parse(source, {
    sourceType: 'unambiguous',
    plugins,
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowUndeclaredExports: true,
  });
}

const SKIP_KEYS = new Set([
  'type',
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
]);

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Depth-first walk. `visit` receives the node and its ancestors (outermost first).
 * Return `false` from `visit` to skip the node's children.
 */
export function walk(root: Node, visit: (node: Node, ancestors: Node[]) => boolean | void, ancestors: Node[] = []): void {
  if (visit(root, ancestors) === false) return;
  ancestors.push(root);
  for (const key of Object.keys(root)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (root as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, ancestors);
    } else if (isNode(value)) {
      walk(value, visit, ancestors);
    }
  }
  ancestors.pop();
}

export function textOf(source: string, node: Node): string {
  return source.slice(node.start ?? 0, node.end ?? 0);
}

export function normalize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),.[\]{}])\s*/g, '$1')
    .replace(/;+$/, '')
    .trim();
}

export function normText(source: string, node: Node): string {
  return normalize(textOf(source, node));
}

/** Strip wrappers that don't change runtime meaning for our purposes. */
export function unwrap(node: Node): Node {
  let cur: Node = node;
  for (;;) {
    switch (cur.type) {
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'ParenthesizedExpression':
      case 'AwaitExpression':
        cur = (cur as { expression?: Node; argument?: Node }).expression ?? (cur as { argument: Node }).argument;
        continue;
      default:
        return cur;
    }
  }
}

export function isCall(node: Node | null | undefined): node is t.CallExpression | t.OptionalCallExpression {
  return !!node && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression');
}

export function isMember(node: Node | null | undefined): node is t.MemberExpression | t.OptionalMemberExpression {
  return !!node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression');
}

export function isFunction(node: Node | null | undefined): node is t.ArrowFunctionExpression | t.FunctionExpression {
  return !!node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression');
}

export function propName(member: t.MemberExpression | t.OptionalMemberExpression): string | null {
  const p = member.property;
  if (!member.computed && p.type === 'Identifier') return p.name;
  if (p.type === 'StringLiteral') return p.value;
  return null;
}

export function stringValue(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  return null;
}

/** Root identifier name of a member/call chain: `vi.fn().mockReturnValue(1)` -> `vi`. */
export function chainRoot(node: Node): Node {
  let cur = node;
  for (;;) {
    if (isCall(cur)) cur = cur.callee as Node;
    else if (isMember(cur)) cur = cur.object;
    else return cur;
  }
}

/** All member property names along a call chain, outermost last. */
export function chainProps(node: Node): string[] {
  const props: string[] = [];
  let cur = node;
  for (;;) {
    if (isCall(cur)) cur = cur.callee as Node;
    else if (isMember(cur)) {
      const name = propName(cur);
      if (name) props.unshift(name);
      cur = cur.object;
    } else return props;
  }
}

export function describeExpr(source: string, raw: Node): ExprInfo {
  const node = unwrap(raw);
  const text = normText(source, node);
  switch (node.type) {
    case 'NumericLiteral':
    case 'BigIntLiteral':
      return { text, kind: 'literal', literalValue: Number((node as t.NumericLiteral).value) };
    case 'StringLiteral':
      return { text, kind: 'literal', literalValue: node.value };
    case 'BooleanLiteral':
      return { text, kind: 'literal', literalValue: node.value };
    case 'NullLiteral':
      return { text, kind: 'literal', literalValue: null };
    case 'RegExpLiteral':
      return { text, kind: 'object' };
    case 'TemplateLiteral':
      return node.expressions.length === 0
        ? { text, kind: 'literal', literalValue: stringValue(node) ?? '' }
        : { text, kind: 'other' };
    case 'Identifier':
      if (node.name === 'undefined') return { text, kind: 'literal', literalValue: undefined, isUndefinedLiteral: true };
      return { text, kind: 'identifier' };
    case 'UnaryExpression':
      if (node.operator === 'typeof') return { text, kind: 'typeof' };
      if (node.operator === 'void') return { text, kind: 'literal', literalValue: undefined, isUndefinedLiteral: true };
      if ((node.operator === '-' || node.operator === '+') && node.argument.type === 'NumericLiteral') {
        return { text, kind: 'literal', literalValue: Number(text) };
      }
      return { text, kind: 'other' };
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return { text, kind: 'member' };
    case 'CallExpression':
    case 'OptionalCallExpression':
      return { text, kind: 'call', calleeText: normText(source, node.callee as Node) };
    case 'ObjectExpression':
      return { text, kind: 'object' };
    case 'ArrayExpression':
      return { text, kind: 'array' };
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ClassExpression':
      return { text, kind: 'function' };
    case 'NewExpression':
      return { text, kind: 'new' };
    default:
      return { text, kind: 'other' };
  }
}
