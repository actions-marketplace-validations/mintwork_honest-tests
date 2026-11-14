import type { RawFinding, Rule } from '../core/types.js';
import { atAssertion, code, eachTest } from './helpers.js';

/**
 * Matchers that only look at the value they're given. `throws`/`called` fail on a plain value, snapshots
 * are snapshot-only's call, and custom matchers (`expect(msg).toHaveBeenWarnedTimes(1)`) may use the
 * literal as a key into state the code under test changed — so unknown matchers never count.
 */
const VALUE_KINDS = new Set(['equal', 'truthy', 'falsy', 'defined', 'undefined', 'null', 'length', 'compare-gte', 'compare-other', 'type']);
const VALUE_MATCHERS = /^(toContain|toContainEqual|toMatch|toBeNaN|include|includes|contain|contains|match|matches|oneOf|toBeOneOf)$/;
/** Property probes see inherited properties too, so code that pollutes a prototype can make them fail. */
const PROPERTY_PROBES = /^(toHaveProperty|property|nestedProperty|haveOwnProperty|ownProperty|ownPropertyDescriptor|keys|any|all)$/;

export const assertsOnOwnLiteral: Rule = {
  id: 'asserts-on-own-literal',
  severity: 'error',
  description: 'Asserts on an object/array literal the test just built — no code under test is involved, so it can never fail.',
  fix: 'Pass the literal through the code under test and assert on what it returns. For type-only checks use a compile-time test (expectTypeOf, tsd, `// @ts-expect-error`) instead of a runtime assertion.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      for (const a of t.assertions) {
        const s = a.subject;
        if (!s?.ownLiteral || PROPERTY_PROBES.test(a.matcher ?? '')) continue;
        if (!VALUE_KINDS.has(a.matcherKind) && !(a.matcherKind === 'other' && VALUE_MATCHERS.test(a.matcher ?? ''))) continue;
        if (!a.args.every((x) => x.kind === 'literal' || x.pureLiteral)) continue;
        // `expect({a: 1}).toEqual({a: 1})` is tautological-assertion's finding.
        if (a.args[0] && a.args[0].text === s.text) continue;
        const { name, line } = s.ownLiteral;
        out.push(
          atAssertion(
            t,
            a,
            `Asserts on ${code(s.text)}, which comes only from the literal ${code(name)} built on line ${line} — no code under test runs, so this can never fail.`,
          ),
        );
      }
    }
    return out;
  },
};
