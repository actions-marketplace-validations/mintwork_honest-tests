import type * as t from '@babel/types';
import { basename } from 'node:path';
import type {
  Assertion,
  AssertionContext,
  ExprInfo,
  MatcherKind,
  MockRestore,
  MockSetup,
  ModuleMock,
  SpyOnUnit,
  TestCase,
  TestFileModel,
  TestModifier,
} from '../../core/types.js';
import {
  chainProps,
  chainRoot,
  describeExpr,
  isCall,
  isFunction,
  isMember,
  normText,
  parseSource,
  propName,
  stringValue,
  textOf,
  unwrap,
  walk,
  type Node,
} from './ast.js';

const TEST_BASES = new Set(['it', 'test', 'specify', 'xit', 'fit', 'xtest']);
const SUITE_BASES = new Set(['describe', 'context', 'suite', 'xdescribe', 'fdescribe', 'xcontext']);
const TEST_MEMBER_MODS = new Set([
  'only',
  'skip',
  'todo',
  'each',
  'concurrent',
  'sequential',
  'fails',
  'failing',
  'skipIf',
  'runIf',
  'for',
  'shuffle',
]);
const CHAI_WORDS = new Set([
  'to',
  'be',
  'been',
  'is',
  'that',
  'which',
  'and',
  'has',
  'have',
  'with',
  'at',
  'of',
  'same',
  'but',
  'does',
  'still',
  'also',
  'deep',
  'nested',
  'own',
  'ordered',
  'any',
  'all',
  'should',
]);
const MODIFIER_WORDS = new Set(['not', 'resolves', 'rejects', ...CHAI_WORDS]);
const MOCK_CONFIG = /^(mockReturnValue|mockReturnValueOnce|mockResolvedValue|mockResolvedValueOnce|mockRejectedValue|mockRejectedValueOnce|mockImplementation|mockImplementationOnce|mockReturnThis)$/;
const MODULE_MOCK_FNS = new Set(['mock', 'doMock', 'unstable_mockModule']);
const HELPER_ASSERT = /^(expect|assert|verify|check|ensure|should|validate)([A-Z_]|$)/;
const FAIL_CALLS = new Set(['fail', 'expect.fail', 'assert.fail', 'chai.assert.fail']);
/** Modules whose exports are assertion functions: `import { equal } from 'node:assert'`. */
const ASSERT_MODULES = /^((node:)?assert(\/strict)?|chai|uvu\/assert|power-assert|tap|tape)$/;
/** `expect.<x>(...)` entry points that start a matcher chain like `expect(...)` does. */
const EXPECT_ENTRY_PROPS = new Set(['soft', 'poll', 'element']);
/** Jasmine-style globals that are often also ordinary local names (`fit()` a text, `context`). */
const SHADOWABLE_TEST_BASES = new Set(['fit', 'xit', 'xtest', 'fdescribe', 'xdescribe', 'context', 'xcontext', 'specify', 'suite']);
/** Calls that undo a mock's configured behavior. */
const MOCK_RESTORE = /^(mockRestore|mockReset)$/;

const MATCHER_KINDS: Array<[RegExp, MatcherKind]> = [
  [/^(toMatchSnapshot|toMatchInlineSnapshot|toMatchFileSnapshot|toThrowErrorMatchingSnapshot|toThrowErrorMatchingInlineSnapshot|matchSnapshot)$/, 'snapshot'],
  [/^(toBe|toEqual|toStrictEqual|toMatchObject|equal|equals|eq|eql|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|toBeCloseTo|closeTo|sameMembers|members|true|false)$/, 'equal'],
  [/^(toBeTruthy|ok|isOk|isTrue|assert)$/, 'truthy'],
  [/^(toBeFalsy|notOk|isNotOk|isFalse)$/, 'falsy'],
  [/^(toBeDefined|exist|exists|isDefined|isNotUndefined)$/, 'defined'],
  [/^(toBeUndefined|undefined|isUndefined)$/, 'undefined'],
  [/^(toBeNull|null|isNull)$/, 'null'],
  [/^(toHaveLength|lengthOf|length|toHaveSize)$/, 'length'],
  [/^(toBeGreaterThanOrEqual|gte|least|isAtLeast)$/, 'compare-gte'],
  [/^(toBeGreaterThan|toBeLessThan|toBeLessThanOrEqual|gt|lt|lte|above|below|most|isAbove|isBelow|isAtMost)$/, 'compare-other'],
  [/^(toThrow|toThrowError|throw|throws|Throw|rejects|doesNotThrow)$/, 'throws'],
  [/^(toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled|toBeCalledWith|toBeCalledTimes|toHaveReturned|toHaveReturnedWith|toHaveReturnedTimes|toHaveBeenCalledOnce|calledWith|called|calledOnce)$/, 'called'],
  [/^(toBeInstanceOf|toBeTypeOf|instanceOf|instanceof|a|an|typeOf|isString|isNumber|isArray|isObject|isFunction)$/, 'type'],
];

export function matcherKindOf(name: string | null): MatcherKind {
  if (!name) return 'none';
  for (const [re, kind] of MATCHER_KINDS) if (re.test(name)) return kind;
  return 'other';
}

interface TestCallInfo {
  base: string;
  kind: 'test' | 'suite';
  modifier: TestModifier;
  /** Arguments carrying (name, fn) — the outer call's args for curried `.each(...)`. */
  args: Node[];
}

function resolveTestCall(call: t.CallExpression, localNames?: Set<string>): TestCallInfo | null {
  const mods: string[] = [];
  let curried = false;
  let cur: Node = call.callee as Node;
  for (;;) {
    if (cur.type === 'Identifier') break;
    if (isMember(cur)) {
      const name = propName(cur);
      if (!name || !TEST_MEMBER_MODS.has(name)) return null;
      mods.unshift(name);
      cur = cur.object;
      continue;
    }
    if (isCall(cur) && !curried) {
      // it.each(table)(name, fn) / test.skipIf(cond)(name, fn)
      curried = true;
      cur = cur.callee as Node;
      continue;
    }
    return null;
  }
  const base = (cur as t.Identifier).name;
  const isTest = TEST_BASES.has(base);
  const isSuite = SUITE_BASES.has(base);
  if (!isTest && !isSuite) return null;
  if (localNames?.has(base) && SHADOWABLE_TEST_BASES.has(base)) return null;
  if (curried && !mods.some((m) => m === 'each' || m === 'skipIf' || m === 'runIf' || m === 'for')) return null;

  let modifier: TestModifier = null;
  if (base.startsWith('x') || mods.includes('skip')) modifier = 'skip';
  if (base.startsWith('f') && base !== 'fails') modifier = 'only';
  if (mods.includes('only')) modifier = 'only';
  if (mods.includes('todo')) modifier = 'todo';
  return { base, kind: isTest ? 'test' : 'suite', modifier, args: call.arguments as Node[] };
}

function lineText(lines: string[], start: number, end: number): string {
  const slice = lines.slice(start - 1, Math.min(end, start + 2));
  return slice.map((l) => l.trim()).join(' ').slice(0, 200);
}

/** Expected unit-under-test name for a test file: `pricing.test.ts` -> `pricing`. */
export function unitNameForTestFile(path: string): string {
  let name = basename(path).replace(/\.(m|c)?[jt]sx?$/, '');
  name = name.replace(/[._-](test|spec|unit|int|integration)$/i, '');
  name = name.replace(/\.(test|spec)$/i, '');
  return name.toLowerCase();
}

function specifierUnitName(spec: string): string {
  const parts = spec.split('/').filter(Boolean);
  let last = parts[parts.length - 1] ?? '';
  last = last.replace(/\.(m|c)?[jt]sx?$/, '');
  if (last === 'index' && parts.length > 1) last = parts[parts.length - 2]!;
  return last.toLowerCase();
}

function isLocalSpecifier(spec: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/?|#|src\/)/.test(spec);
}

interface MockScan {
  setups: MockSetup[];
}

/** Find mock configuration in a subtree (top-level setup or a single test body). */
function scanMocks(source: string, root: Node, skip?: (n: Node) => boolean): MockScan {
  const setups: MockSetup[] = [];
  walk(root, (node) => {
    if (skip && skip(node)) return false;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      const init = unwrap(node.init);
      if (isCall(init)) {
        const rootNode = chainRoot(init);
        const props = chainProps(init);
        const isMockFactory =
          rootNode.type === 'Identifier' && (rootNode.name === 'vi' || rootNode.name === 'jest') && (props[0] === 'fn' || props[0] === 'spyOn');
        if (isMockFactory) {
          const configures = props.some((p) => MOCK_CONFIG.test(p)) || (props[0] === 'fn' && innermostCallArgs(init).length > 0);
          setups.push({ target: node.id.name, line: node.loc!.start.line, configuresReturn: configures });
          if (props[0] === 'spyOn') {
            const spy = innermostCall(init);
            const target = spyTarget(source, spy);
            if (target) setups.push({ target, line: node.loc!.start.line, configuresReturn: configures });
          }
        }
      }
    }
    if (isCall(node) && isMember(node.callee as Node)) {
      const callee = node.callee as t.MemberExpression;
      const name = propName(callee);
      if (name && MOCK_CONFIG.test(name)) {
        const target = mockTargetText(source, callee.object);
        if (target) setups.push({ target, line: node.loc!.start.line, configuresReturn: true });
      }
    }
  });
  return { setups };
}

function innermostCall(call: Node): t.CallExpression {
  let cur: Node = call;
  let last = call as t.CallExpression;
  for (;;) {
    if (isCall(cur)) {
      last = cur as t.CallExpression;
      cur = cur.callee as Node;
    } else if (isMember(cur)) cur = cur.object;
    else return last;
  }
}

function innermostCallArgs(call: Node): Node[] {
  return innermostCall(call).arguments as Node[];
}

function spyTarget(source: string, spy: t.CallExpression): string | null {
  const [obj, method] = spy.arguments as Node[];
  const m = stringValue(method);
  if (!obj || !m) return null;
  return `${normText(source, obj)}.${m}`;
}

/** Text of what a `.mockReturnValue` call configures: `fn`, `vi.mocked(fn)` -> `fn`, `vi.spyOn(o,'m')` -> `o.m`. */
function mockTargetText(source: string, obj: Node): string | null {
  const node = unwrap(obj);
  if (isCall(node)) {
    const root = chainRoot(node);
    const props = chainProps(node);
    if (root.type === 'Identifier' && (root.name === 'vi' || root.name === 'jest')) {
      if (props[0] === 'mocked' && node.arguments[0]) return normText(source, node.arguments[0] as Node);
      if (props[0] === 'spyOn') return spyTarget(source, innermostCall(node));
      return null;
    }
    // chained: fn.mockReturnValueOnce(1).mockReturnValueOnce(2)
    if (isMember(node.callee as Node)) {
      const n = propName(node.callee as t.MemberExpression);
      if (n && MOCK_CONFIG.test(n)) return mockTargetText(source, (node.callee as t.MemberExpression).object);
    }
    return null;
  }
  return normText(source, node);
}

interface AssertionScan {
  assertions: Assertion[];
  helperAssertionCalls: number;
  hasAssertionCountGuard: boolean;
}

function calleeName(source: string, call: Node): string {
  return isCall(call) ? normText(source, call.callee as Node) : '';
}

function containsFailOrThrow(source: string, node: Node | null | undefined): boolean {
  if (!node) return false;
  let found = false;
  walk(node, (n) => {
    if (found) return false;
    if (isFunction(n) || n.type === 'FunctionDeclaration') return n === node ? undefined : false;
    if (n.type === 'ThrowStatement') found = true;
    if (isCall(n) && FAIL_CALLS.has(calleeName(source, n))) found = true;
    return undefined;
  });
  return found;
}

/** What the file tells us about assertion entry points beyond `expect`/`assert`. */
interface AssertVocab {
  /** Local names bound to assertion functions: `import { equal as eq } from 'node:assert'` -> eq => equal. */
  assertFns: Map<string, string>;
  /** Local names bound to an assertion module object: `import a from 'node:assert/strict'`. */
  assertRoots: Set<string>;
  /** Functions declared in this file whose bodies assert (`function check(x) { expect(x)... }`). */
  helpers: Set<string>;
}

const EMPTY_VOCAB: AssertVocab = { assertFns: new Map(), assertRoots: new Set(['assert']), helpers: new Set() };

/** True if `call` starts or is an assertion: expect chains, assert.*, imported assert fns, asserting helpers. */
function isAssertionCall(call: Node, vocab: AssertVocab): boolean {
  if (!isCall(call)) return false;
  const callee = call.callee as Node;
  const root = chainRoot(callee);
  if (root.type === 'Identifier') {
    if (root.name === 'expect' || vocab.assertRoots.has(root.name)) return true;
    if (callee === root && (vocab.assertFns.has(root.name) || vocab.helpers.has(root.name))) return true;
  }
  const name = callee.type === 'Identifier' ? callee.name : isMember(callee) ? propName(callee) : null;
  if (name && HELPER_ASSERT.test(name)) return true;
  return isMember(callee) && chainProps(callee).includes('should');
}

function containsAssertion(node: Node | null | undefined, vocab: AssertVocab): boolean {
  if (!node) return false;
  let found = false;
  walk(node, (n) => {
    if (found) return false;
    if (isAssertionCall(n, vocab)) found = true;
    return undefined;
  });
  return found;
}

/** `if (a) {assert} else if (b) {assert} else {assert}`: some assertion runs whichever branch is taken. */
function everyBranchAsserts(node: Node, vocab: AssertVocab): boolean {
  if (node.type === 'IfStatement') {
    if (!node.alternate || !containsAssertion(node.consequent, vocab)) return false;
    return everyBranchAsserts(node.alternate, vocab);
  }
  if (node.type === 'ConditionalExpression') return containsAssertion(node.consequent, vocab) && containsAssertion(node.alternate, vocab);
  return containsAssertion(node, vocab);
}

/** The value a guard tests: `!r.success` / `r.success === false` / `(x)` -> `r.success` / `x`. */
function guardOperand(source: string, test: Node): string {
  let node = unwrap(test);
  for (;;) {
    if (node.type === 'UnaryExpression' && node.operator === '!') node = unwrap(node.argument as Node);
    else if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
      const right = unwrap(node.right as Node);
      const left = unwrap(node.left as Node);
      const isConst = (n: Node) =>
        n.type === 'BooleanLiteral' ||
        n.type === 'NullLiteral' ||
        n.type === 'StringLiteral' ||
        n.type === 'NumericLiteral' ||
        (n.type === 'Identifier' && n.name === 'undefined');
      if (isConst(right)) node = left;
      else if (isConst(left)) node = right;
      else break;
    } else break;
  }
  return normText(source, node);
}

function containsReturn(node: Node): boolean {
  let found = false;
  walk(node, (n) => {
    if (found || isFunction(n) || n.type === 'FunctionDeclaration') return false;
    if (n.type === 'ReturnStatement') found = true;
    return undefined;
  });
  return found;
}

/** Variables the catch body sets to `true` (`threw = true`), so a later `expect(threw)` proves it ran. */
function flagsSetIn(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && unwrap(n.right as Node).type === 'BooleanLiteral') out.push(n.left.name);
  });
  return out;
}

/**
 * A catch whose skipping fails the test anyway: the try throws/fails after the risky call, the catch
 * returns and the code after the try fails, or the catch sets a flag that is asserted afterwards.
 */
function catchIsGuarded(source: string, tryStmt: t.TryStatement, parent: Node | undefined, vocab: AssertVocab): boolean {
  if (containsFailOrThrow(source, tryStmt.block)) return true;
  const handler = tryStmt.handler;
  if (!handler || !parent || !('body' in parent) || !Array.isArray(parent.body)) return false;
  const siblings = parent.body as Node[];
  const after = siblings.slice(siblings.indexOf(tryStmt) + 1);
  if (after.length === 0) return false;
  if (containsReturn(handler.body) && after.some((s) => containsFailOrThrow(source, s))) return true;
  const flags = flagsSetIn(handler.body);
  if (flags.length === 0) return false;
  return after.some((s) => {
    let hit = false;
    walk(s, (n) => {
      if (hit) return false;
      if (isAssertionCall(n, vocab) && isCall(n) && (n.arguments as Node[]).some((a) => a.type === 'Identifier' && flags.includes(a.name))) hit = true;
      return undefined;
    });
    return hit;
  });
}

function assertionContext(source: string, target: Node, ancestors: Node[], bodyIndex: number, vocab: AssertVocab = EMPTY_VOCAB): AssertionContext {
  const ctx: AssertionContext = { inSwallowingTry: false, inCatch: false, catchGuarded: false, inConditional: false };
  const guards: string[] = [];
  for (let i = ancestors.length - 1; i >= bodyIndex; i--) {
    const a = ancestors[i]!;
    const child = ancestors[i + 1] ?? target;
    if (a.type === 'CatchClause') {
      ctx.inCatch = true;
      const tryStmt = ancestors[i - 1];
      if (tryStmt && tryStmt.type === 'TryStatement' && catchIsGuarded(source, tryStmt, ancestors[i - 2], vocab)) ctx.catchGuarded = true;
    }
    if (a.type === 'TryStatement' && child === a.block && a.handler) {
      if (!containsFailOrThrow(source, a.handler.body)) ctx.inSwallowingTry = true;
    }
    if ((a.type === 'IfStatement' || a.type === 'ConditionalExpression') && child !== a.test) {
      // Walk up an else-if chain to its head; if every branch asserts, something is always checked.
      let j = i;
      while (j - 1 >= bodyIndex) {
        const up = ancestors[j - 1]!;
        if (up.type === 'IfStatement' && up.alternate === ancestors[j]) j--;
        else break;
      }
      if (!everyBranchAsserts(ancestors[j]!, vocab)) {
        ctx.inConditional = true;
        guards.push(guardOperand(source, a.test as Node));
      }
    }
    if (a.type === 'LogicalExpression' && child === a.right) {
      ctx.inConditional = true;
      // `expect(a).toBe(1) && expect(b)...`: the left side is an assertion returning undefined — never excusable.
      guards.push(isAssertionCall(chainCallOf(a.left as Node), vocab) ? '\u0000assertion' : guardOperand(source, a.left as Node));
    }
  }
  if (guards.length) ctx.guards = guards;
  return ctx;
}

/** Innermost call at the root of a matcher chain (`expect(x).toBe(1)` -> `expect(x)`). */
function chainCallOf(node: Node): Node {
  let cur = unwrap(node);
  for (;;) {
    if (isCall(cur) && isMember(cur.callee as Node)) cur = (cur.callee as t.MemberExpression).object;
    else if (isMember(cur)) cur = cur.object;
    else return cur;
  }
}

function scanAssertions(source: string, lines: string[], body: Node, aliases: Map<string, string>, vocab: AssertVocab = EMPTY_VOCAB): AssertionScan {
  const assertions: Assertion[] = [];
  let helperAssertionCalls = 0;
  let hasAssertionCountGuard = false;

  const withAlias = (info: ExprInfo): ExprInfo => {
    if (info.kind === 'identifier' && aliases.has(info.text)) return { ...info, aliasCalleeText: aliases.get(info.text) };
    return info;
  };

  walk(body, (node, ancestors) => {
    if (!isCall(node)) return;
    const callee = node.callee as Node;
    const bodyIndex = 0;

    // expect.assertions(n) / expect.hasAssertions()
    if (isMember(callee) && callee.object.type === 'Identifier' && callee.object.name === 'expect') {
      const n = propName(callee);
      if (n === 'assertions' || n === 'hasAssertions') hasAssertionCountGuard = true;
      if (!EXPECT_ENTRY_PROPS.has(n ?? '')) return;
    }

    const isExpectRoot =
      (callee.type === 'Identifier' && callee.name === 'expect') ||
      (isMember(callee) && callee.object.type === 'Identifier' && callee.object.name === 'expect' && EXPECT_ENTRY_PROPS.has(propName(callee) ?? ''));
    // expect.poll(fn) asserts on what fn returns, not on the function object.
    const polls = isMember(callee) && propName(callee) === 'poll';

    if (isExpectRoot) {
      // Climb the matcher chain: expect(x).not.resolves.toBe(y)
      const props: string[] = [];
      let cur: Node = node;
      let called = false;
      let args: Node[] = [];
      let i = ancestors.length - 1;
      for (; i >= 0; i--) {
        const p = ancestors[i]!;
        if (isMember(p) && p.object === cur) {
          const n = propName(p);
          if (n) props.push(n);
          cur = p;
          continue;
        }
        if (isCall(p) && p.callee === cur) {
          called = true;
          args = p.arguments as Node[];
          cur = p;
        }
        break;
      }
      const outerParent = called ? ancestors[i - 1] : ancestors[i];
      const matcher = [...props].reverse().find((p) => !MODIFIER_WORDS.has(p)) ?? null;
      const chaiStyle = props.some((p) => CHAI_WORDS.has(p));
      let kind = matcherKindOf(matcher);
      if (!called && !chaiStyle) kind = 'none';
      if (matcher === 'true' && chaiStyle) kind = 'equal';
      const isAsync = props.includes('resolves') || props.includes('rejects');
      const awaited =
        cur === body ||
        (!!outerParent &&
        (outerParent.type === 'AwaitExpression' ||
          outerParent.type === 'ReturnStatement' ||
          outerParent.type === 'ArrayExpression' ||
          (outerParent.type === 'ArrowFunctionExpression' && outerParent.body === cur) ||
          (isMember(outerParent) && ['then', 'catch', 'finally'].includes(propName(outerParent) ?? '')) ||
          // const pending = expect(p).rejects.toThrow(); ...; await pending
          (outerParent.type === 'VariableDeclarator' && outerParent.id.type === 'Identifier' && isReferencedElsewhere(body, outerParent.id))));
      const subjectNode = node.arguments[0] as Node | undefined;
      let subject = subjectNode ? withAlias(describeExpr(source, subjectNode)) : null;
      if (subject && polls) subject = { text: subject.text, kind: 'other' };
      const start = node.loc!.start;
      assertions.push({
        line: start.line,
        column: start.column + 1,
        text: lineText(lines, start.line, cur.loc!.end.line),
        style: 'expect',
        subject,
        matcher,
        matcherKind: kind,
        negated: props.includes('not'),
        args: args.map((a) => describeExpr(source, a)),
        async: isAsync,
        awaitedOrReturned: awaited,
        context: assertionContext(source, node, ancestors, bodyIndex, vocab),
      });
      return;
    }

    // assert(x) / assert.equal(a, b) / assert.strict.equal(...) / equal(a, b) imported from node:assert
    const root = chainRoot(callee);
    const importedFn = callee.type === 'Identifier' ? vocab.assertFns.get(callee.name) : undefined;
    if (importedFn !== undefined || (root.type === 'Identifier' && vocab.assertRoots.has(root.name) && (callee === root || isMember(callee)))) {
      const method = importedFn ?? (callee === root ? 'assert' : propName(callee as t.MemberExpression));
      if (method === 'fail') {
        helperAssertionCalls++;
        return;
      }
      const start = node.loc!.start;
      const [subj, ...rest] = node.arguments as Node[];
      const m = method ?? 'assert';
      assertions.push({
        line: start.line,
        column: start.column + 1,
        text: lineText(lines, start.line, node.loc!.end.line),
        style: 'assert',
        subject: subj ? withAlias(describeExpr(source, subj)) : null,
        matcher: m,
        matcherKind: matcherKindOf(m),
        negated: /^(not|isNot|doesNot)/.test(m),
        args: rest.slice(0, 1).map((a) => describeExpr(source, a)),
        async: m === 'rejects' || m === 'doesNotReject',
        awaitedOrReturned: true,
        context: assertionContext(source, node, ancestors, bodyIndex, vocab),
      });
      return;
    }

    // Helper assertions: expectValidUser(u), assertOk(res), request(app).get('/').expect(200), x.should.equal(1)
    const name = callee.type === 'Identifier' ? callee.name : isMember(callee) ? propName(callee) : null;
    if (name && (HELPER_ASSERT.test(name) || name === 'expect')) helperAssertionCalls++;
    else if (callee.type === 'Identifier' && vocab.helpers.has(callee.name)) helperAssertionCalls++;
    else if (isMember(callee) && chainProps(callee).includes('should')) helperAssertionCalls++;
    return;
  });

  return { assertions, helperAssertionCalls, hasAssertionCountGuard };
}

/** True if `id` is used anywhere in `scope` other than at its own declaration. */
function isReferencedElsewhere(scope: Node, id: t.Identifier): boolean {
  let found = false;
  walk(scope, (n) => {
    if (found) return false;
    if (n.type === 'Identifier' && n !== id && n.name === id.name) found = true;
    return undefined;
  });
  return found;
}

function collectAliases(source: string, body: Node): Map<string, string> {
  const aliases = new Map<string, string>();
  walk(body, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      const init = unwrap(node.init);
      if (isCall(init)) aliases.set(node.id.name, normText(source, init.callee as Node));
    }
  });
  return aliases;
}

/** Which local names are assertion functions/modules, and which file-local functions assert. */
function assertVocabulary(ast: t.File): AssertVocab {
  const assertFns = new Map<string, string>();
  const assertRoots = new Set<string>(['assert']);
  const bind = (imported: string, local: string) => {
    if (imported === 'expect') return;
    if (imported === 'assert' || imported === 'strict' || imported === 'default') assertRoots.add(local);
    else assertFns.set(local, imported);
  };
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ImportDeclaration' || !ASSERT_MODULES.test(stmt.source.value)) continue;
    for (const sp of stmt.specifiers) {
      if (sp.type === 'ImportSpecifier') bind(sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value, sp.local.name);
      else assertRoots.add(sp.local.name);
    }
  }
  // const assert = require('node:assert'); const { equal } = require('assert/strict')
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    let init = unwrap(node.init);
    if (isMember(init) && propName(init) === 'strict') init = init.object;
    if (!isCall(init) || init.callee.type !== 'Identifier' || init.callee.name !== 'require') return;
    const spec = stringValue(init.arguments[0] as Node);
    if (!spec || !ASSERT_MODULES.test(spec)) return;
    if (node.id.type === 'Identifier') assertRoots.add(node.id.name);
    else if (node.id.type === 'ObjectPattern') {
      for (const prop of node.id.properties) {
        if (prop.type !== 'ObjectProperty' || prop.value.type !== 'Identifier') continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : stringValue(prop.key as Node);
        if (key) bind(key, prop.value.name);
      }
    }
  });

  // File-local helpers that assert: function check(x) { expect(x)... } / const check = (x) => assert.ok(x)
  const candidates = new Map<string, Node>();
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id) candidates.set(node.id.name, node.body);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && isFunction(unwrap(node.init))) {
      candidates.set(node.id.name, (unwrap(node.init) as t.ArrowFunctionExpression).body as Node);
    }
  });
  const vocab: AssertVocab = { assertFns, assertRoots, helpers: new Set() };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of candidates) {
      if (vocab.helpers.has(name) || !containsAssertion(body, vocab)) continue;
      vocab.helpers.add(name);
      changed = true;
    }
  }
  return vocab;
}

/** Names declared by functions/variables anywhere in the file (imports excluded). */
function declaredNames(ast: t.File): Set<string> {
  const names = new Set<string>();
  const addPattern = (p: Node) => {
    if (p.type === 'Identifier') names.add(p.name);
    else if (p.type === 'ObjectPattern') {
      for (const prop of p.properties) addPattern(prop.type === 'RestElement' ? prop.argument : (prop.value as Node));
    } else if (p.type === 'ArrayPattern') {
      for (const el of p.elements) if (el) addPattern(el);
    } else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id) names.add(node.id.name);
    if (node.type === 'VariableDeclarator') addPattern(node.id);
  });
  return names;
}

/** `spy.mockRestore()` / `fn.mockReset()` / `vi.restoreAllMocks()` inside a test body. */
function scanRestores(source: string, body: Node): MockRestore[] {
  const out: MockRestore[] = [];
  walk(body, (node) => {
    if (!isCall(node) || !isMember(node.callee as Node)) return;
    const callee = node.callee as t.MemberExpression;
    const name = propName(callee);
    if (!name) return;
    const line = node.loc!.start.line;
    const obj = callee.object;
    if (obj.type === 'Identifier' && (obj.name === 'vi' || obj.name === 'jest') && /^(restoreAllMocks|resetAllMocks)$/.test(name)) {
      out.push({ target: null, line });
    } else if (MOCK_RESTORE.test(name)) {
      const target = mockTargetText(source, obj as Node);
      if (target) out.push({ target, line });
    }
  });
  return out;
}

function testName(source: string, arg: Node | undefined): string {
  if (!arg) return '<anonymous>';
  // Template names keep their spacing: `adds ${n} items`, not `adds ${n}items`.
  return stringValue(arg) ?? textOf(source, arg).replace(/\s+/g, ' ').trim();
}

export function parseJsTestFile(path: string, source: string): TestFileModel {
  const ast = parseSource(path, source);
  const lines = source.split(/\r?\n/);
  const tests: TestCase[] = [];
  const moduleMocks: ModuleMock[] = [];
  const unitSpies: SpyOnUnit[] = [];
  const unitName = unitNameForTestFile(path);

  // Imports: local name -> specifier
  const imports = new Map<string, string>();
  const importedSpecs = new Set<string>();
  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') {
      importedSpecs.add(stmt.source.value);
      for (const s of stmt.specifiers) imports.set(s.local.name, stmt.source.value);
    }
  }
  walk(ast, (node) => {
    // require('x') and dynamic import('x') also count as imports
    if (isCall(node) && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      const s = stringValue(node.arguments[0] as Node);
      if (s) importedSpecs.add(s);
    }
    if (node.type === 'ImportExpression' || (isCall(node) && node.callee.type === 'Import')) {
      const arg = node.type === 'ImportExpression' ? (node as { source: Node }).source : (node.arguments[0] as Node);
      const s = stringValue(arg);
      if (s) importedSpecs.add(s);
    }
  });

  const vocab = assertVocabulary(ast);
  const localNames = declaredNames(ast);

  const isUnitSpec = (spec: string) => isLocalSpecifier(spec) && specifierUnitName(spec) === unitName && unitName.length > 0;
  const importsUnit = [...importedSpecs].some(isUnitSpec);

  // Locate test bodies first so file-level mock scanning can skip them.
  const testBodies = new Set<Node>();

  walk(ast, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    // A test-looking call inside a test body is not a test (runners reject nested tests): it's a local fn.
    const info = ancestors.some((a) => testBodies.has(a)) ? null : resolveTestCall(node, localNames);
    if (info) {
      const fn = info.args.slice(1).find((a) => isFunction(a));
      if (fn && info.kind === 'test') testBodies.add(fn);
      const start = node.loc!.start;
      const tc: TestCase = {
        name: testName(source, info.args[0]),
        kind: info.kind,
        line: start.line,
        endLine: node.loc!.end.line,
        modifier: info.modifier,
        headText: lineText(lines, start.line, start.line),
        analyzable: !!fn,
        assertions: [],
        helperAssertionCalls: 0,
        hasAssertionCountGuard: false,
        mockSetups: [],
      };
      (tc as TestCase & { _fn?: Node })._fn = fn;
      tests.push(tc);
      return;
    }

    // vi.mock('../src/x') / jest.mock(...)
    const callee = node.callee as Node;
    if (isMember(callee) && callee.object.type === 'Identifier' && (callee.object.name === 'vi' || callee.object.name === 'jest')) {
      const fnName = propName(callee);
      if (fnName === 'spyOn') {
        const [obj] = node.arguments as Node[];
        const objName = obj && obj.type === 'Identifier' ? obj.name : null;
        if (objName && imports.has(objName) && isUnitSpec(imports.get(objName)!)) {
          unitSpies.push({
            target: spyTarget(source, node) ?? normText(source, node),
            line: node.loc!.start.line,
            text: lineText(lines, node.loc!.start.line, node.loc!.end.line),
          });
        }
      }
      if (fnName && MODULE_MOCK_FNS.has(fnName)) {
        const spec = stringValue(node.arguments[0] as Node);
        if (spec) {
          const factory = node.arguments[1] as Node | undefined;
          const factoryText = factory ? textOf(source, factory) : '';
          const partial = /importOriginal|requireActual|importActual/.test(factoryText);
          moduleMocks.push({
            specifier: spec,
            line: node.loc!.start.line,
            text: lineText(lines, node.loc!.start.line, node.loc!.start.line),
            isUnitUnderTest: isUnitSpec(spec) && importsUnit,
            partial,
          });
        }
      }
    }
  });

  const fileLevel = scanMocks(source, ast, (n) => testBodies.has(n));

  // Only keep unit spies that actually replace behavior.
  const replacedTargets = new Set(fileLevel.setups.filter((s) => s.configuresReturn).map((s) => s.target));
  for (const fn of testBodies) for (const s of scanMocks(source, fn).setups) if (s.configuresReturn) replacedTargets.add(s.target);
  const behaviorSpies = unitSpies.filter((s) => replacedTargets.has(s.target));

  for (const tc of tests) {
    const fn = (tc as TestCase & { _fn?: Node })._fn;
    delete (tc as TestCase & { _fn?: Node })._fn;
    if (!fn || tc.kind !== 'test') continue;
    const fnBody = (fn as t.ArrowFunctionExpression).body as Node;
    const aliases = collectAliases(source, fnBody);
    const scan = scanAssertions(source, lines, fnBody, aliases, vocab);
    tc.assertions = scan.assertions;
    tc.helperAssertionCalls = scan.helperAssertionCalls;
    tc.hasAssertionCountGuard = scan.hasAssertionCountGuard;
    tc.mockSetups = [...fileLevel.setups, ...scanMocks(source, fnBody).setups];
    const restores = scanRestores(source, fnBody);
    if (restores.length) tc.mockRestores = restores;
  }

  return { file: path, language: 'js', tests, moduleMocks, unitSpies: behaviorSpies, lines };
}
