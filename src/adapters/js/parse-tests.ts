import type * as t from '@babel/types';
import { basename } from 'node:path';
import type {
  Assertion,
  AssertionContext,
  ExprInfo,
  MatcherKind,
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

function resolveTestCall(call: t.CallExpression): TestCallInfo | null {
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

function assertionContext(source: string, target: Node, ancestors: Node[], bodyIndex: number): AssertionContext {
  const ctx: AssertionContext = { inSwallowingTry: false, inCatch: false, catchGuarded: false, inConditional: false };
  for (let i = ancestors.length - 1; i >= bodyIndex; i--) {
    const a = ancestors[i]!;
    const child = ancestors[i + 1] ?? target;
    if (a.type === 'CatchClause') {
      ctx.inCatch = true;
      const tryStmt = ancestors[i - 1];
      if (tryStmt && tryStmt.type === 'TryStatement' && containsFailOrThrow(source, tryStmt.block)) ctx.catchGuarded = true;
    }
    if (a.type === 'TryStatement' && child === a.block && a.handler) {
      if (!containsFailOrThrow(source, a.handler.body)) ctx.inSwallowingTry = true;
    }
    if (a.type === 'IfStatement' && child !== a.test) ctx.inConditional = true;
    if (a.type === 'ConditionalExpression' && child !== a.test) ctx.inConditional = true;
    if (a.type === 'LogicalExpression' && child === a.right) ctx.inConditional = true;
  }
  return ctx;
}

function scanAssertions(source: string, lines: string[], body: Node, aliases: Map<string, string>): AssertionScan {
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
      if (n !== 'soft' && n !== 'poll') return;
    }

    const isExpectRoot =
      (callee.type === 'Identifier' && callee.name === 'expect') ||
      (isMember(callee) &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'expect' &&
        (propName(callee) === 'soft' || propName(callee) === 'poll'));

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
          (isMember(outerParent) && ['then', 'catch', 'finally'].includes(propName(outerParent) ?? ''))));
      const subjectNode = node.arguments[0] as Node | undefined;
      const start = node.loc!.start;
      assertions.push({
        line: start.line,
        column: start.column + 1,
        text: lineText(lines, start.line, cur.loc!.end.line),
        style: 'expect',
        subject: subjectNode ? withAlias(describeExpr(source, subjectNode)) : null,
        matcher,
        matcherKind: kind,
        negated: props.includes('not'),
        args: args.map((a) => describeExpr(source, a)),
        async: isAsync,
        awaitedOrReturned: awaited,
        context: assertionContext(source, node, ancestors, bodyIndex),
      });
      return;
    }

    // assert(x) / assert.equal(a, b) / assert.strict.equal(...)
    const root = chainRoot(callee);
    if (root.type === 'Identifier' && root.name === 'assert' && (callee === root || isMember(callee))) {
      const method = callee === root ? 'assert' : propName(callee as t.MemberExpression);
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
        context: assertionContext(source, node, ancestors, bodyIndex),
      });
      return;
    }

    // Helper assertions: expectValidUser(u), assertOk(res), request(app).get('/').expect(200), x.should.equal(1)
    const name = callee.type === 'Identifier' ? callee.name : isMember(callee) ? propName(callee) : null;
    if (name && (HELPER_ASSERT.test(name) || name === 'expect')) helperAssertionCalls++;
    else if (isMember(callee) && chainProps(callee).includes('should')) helperAssertionCalls++;
    return;
  });

  return { assertions, helperAssertionCalls, hasAssertionCountGuard };
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

function testName(source: string, arg: Node | undefined): string {
  if (!arg) return '<anonymous>';
  return stringValue(arg) ?? normText(source, arg);
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

  const isUnitSpec = (spec: string) => isLocalSpecifier(spec) && specifierUnitName(spec) === unitName && unitName.length > 0;
  const importsUnit = [...importedSpecs].some(isUnitSpec);

  // Locate test bodies first so file-level mock scanning can skip them.
  const testBodies = new Set<Node>();

  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const info = resolveTestCall(node);
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
    const scan = scanAssertions(source, lines, fnBody, aliases);
    tc.assertions = scan.assertions;
    tc.helperAssertionCalls = scan.helperAssertionCalls;
    tc.hasAssertionCountGuard = scan.hasAssertionCountGuard;
    tc.mockSetups = [...fileLevel.setups, ...scanMocks(source, fnBody).setups];
  }

  return { file: path, language: 'js', tests, moduleMocks, unitSpies: behaviorSpies, lines };
}
