import type * as t from '@babel/types';
import type { Mutant } from '../../core/types.js';
import { isCall, isMember, parseSource, textOf, walk, type Node } from './ast.js';

const BINARY_SWAPS: Record<string, string> = {
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
  '<': '<=',
  '<=': '<',
  '>': '>=',
  '>=': '>',
  '+': '-',
  '-': '+',
  '*': '/',
  '/': '*',
  '%': '*',
};

const LOGICAL_SWAPS: Record<string, string> = {
  '&&': '||',
  '||': '&&',
};

const ASSIGN_SWAPS: Record<string, string> = {
  '+=': '-=',
  '-=': '+=',
  '*=': '/=',
  '/=': '*=',
};

/** Calls whose arguments we never mutate (noise, not behavior). */
const SKIP_CALLEE = /^(console|logger|log|debug|assert|invariant)$/;

function isStringish(node: Node): boolean {
  return node.type === 'StringLiteral' || node.type === 'TemplateLiteral';
}

/**
 * Generate simple, high-signal mutants for a JS/TS source file:
 * operator flips, boolean flips, negation removal, numeric tweaks, and
 * return-value replacement. Type-only syntax is never touched.
 */
export function generateJsMutants(path: string, source: string): Mutant[] {
  const ast = parseSource(path, source);
  const mutants: Mutant[] = [];
  const seen = new Set<string>();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const position = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo]! + 1 };
  };
  const short = (s: string) => {
    const one = s.replace(/\s+/g, ' ');
    return one.length > 40 ? one.slice(0, 39) + '…' : one;
  };

  const add = (_node: Node, start: number, end: number, replacement: string, operator: string, description: string) => {
    const key = `${start}:${end}:${replacement}`;
    if (seen.has(key)) return;
    seen.add(key);
    const original = source.slice(start, end);
    if (original === replacement) return;
    mutants.push({
      id: 0,
      file: path,
      ...position(start),
      start,
      end,
      original,
      replacement,
      operator,
      description,
    });
  };

  walk(ast, (node, ancestors) => {
    // Never mutate types, imports, or logging.
    if (node.type.startsWith('TS') && !['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node.type)) {
      return false;
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'Directive') return false;
    if (isCall(node)) {
      let callee: Node = node.callee as Node;
      while (isMember(callee)) callee = callee.object;
      if (callee.type === 'Identifier' && SKIP_CALLEE.test(callee.name)) return false;
    }
    const parent = ancestors[ancestors.length - 1];

    switch (node.type) {
      case 'BinaryExpression': {
        const swap = BINARY_SWAPS[node.operator];
        if (!swap) break;
        if ((node.operator === '+' || node.operator === '-') && (isStringish(node.left as Node) || isStringish(node.right))) break;
        const left = node.left as Node;
        const opStart = source.indexOf(node.operator, left.end!);
        if (opStart < 0 || opStart >= node.right.start!) break;
        add(node, opStart, opStart + node.operator.length, swap, 'binary', `\`${node.operator}\` → \`${swap}\``);
        break;
      }
      case 'LogicalExpression': {
        const swap = LOGICAL_SWAPS[node.operator];
        if (!swap) break;
        const opStart = source.indexOf(node.operator, node.left.end!);
        if (opStart < 0 || opStart >= node.right.start!) break;
        add(node, opStart, opStart + node.operator.length, swap, 'logical', `\`${node.operator}\` → \`${swap}\``);
        break;
      }
      case 'AssignmentExpression': {
        const swap = ASSIGN_SWAPS[node.operator];
        if (!swap) break;
        const opStart = source.indexOf(node.operator, node.left.end!);
        if (opStart < 0 || opStart >= node.right.start!) break;
        add(node, opStart, opStart + node.operator.length, swap, 'assignment', `\`${node.operator}\` → \`${swap}\``);
        break;
      }
      case 'BooleanLiteral': {
        add(node, node.start!, node.end!, String(!node.value), 'boolean', `\`${node.value}\` → \`${!node.value}\``);
        break;
      }
      case 'UnaryExpression': {
        if (node.operator === '!') {
          const arg = textOf(source, node.argument);
          add(node, node.start!, node.end!, `(${arg})`, 'negation', `removed \`!\` from \`!${short(arg)}\``);
        }
        break;
      }
      case 'NumericLiteral': {
        // Skip array indices and object keys; they are rarely behavior and mostly noise.
        if (parent && isMember(parent) && parent.property === node) break;
        if (parent && parent.type === 'ObjectProperty' && (parent as t.ObjectProperty).key === node) break;
        const raw = textOf(source, node);
        if (!/^\d+(\.\d+)?$/.test(raw)) break;
        const next = node.value === 0 ? '1' : node.value === 1 ? '0' : String(node.value + 1);
        add(node, node.start!, node.end!, next, 'number', `\`${raw}\` → \`${next}\``);
        break;
      }
      case 'ReturnStatement': {
        const arg = node.argument;
        if (!arg) break;
        if (arg.type === 'BooleanLiteral' || (arg.type === 'Identifier' && arg.name === 'undefined')) break;
        const fn = [...ancestors].reverse().find((a) => a.type.includes('Function'));
        if (fn && (fn as t.Function).generator) break;
        add(node, arg.start!, arg.end!, 'undefined', 'return', `return value replaced with \`undefined\``);
        break;
      }
      case 'ArrowFunctionExpression': {
        if (node.body.type !== 'BlockStatement' && node.body.type !== 'BooleanLiteral') {
          const body = node.body as Node;
          add(body, body.start!, body.end!, 'undefined', 'return', `arrow return value replaced with \`undefined\``);
        }
        break;
      }
      case 'IfStatement': {
        const test = node.test as Node;
        add(test, test.start!, test.end!, 'true', 'condition', `condition \`${short(textOf(source, test))}\` → \`true\``);
        add(test, test.start!, test.end!, 'false', 'condition', `condition \`${short(textOf(source, test))}\` → \`false\``);
        break;
      }
      default:
        break;
    }
    return undefined;
  });

  mutants.sort((a, b) => a.start - b.start || a.end - b.end);
  mutants.forEach((m, i) => (m.id = i + 1));
  return mutants;
}

export function applyMutant(source: string, m: Mutant): string {
  return source.slice(0, m.start) + m.replacement + source.slice(m.end);
}
