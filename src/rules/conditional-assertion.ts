import type { Assertion, RawFinding, Rule } from '../core/types.js';
import { atAssertion, eachTest } from './helpers.js';

export const conditionalAssertion: Rule = {
  id: 'conditional-assertion',
  severity: 'warning',
  description: 'Assertion is guarded by an if/ternary/&&, so the test passes without checking anything when the guard is false.',
  fix: 'Assert the condition itself (expect(result).toBeDefined()), then assert unconditionally. Split data-dependent branches into separate tests.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      // A guard that re-tests something already asserted (`expect(r.success).toBe(false); if (!r.success) ...`)
      // only narrows types — the branch is guaranteed to run. The earlier assertion may itself sit behind
      // such a narrowing guard (nested `if (!r.success) { expect(i.code)...; if (i.code === 'x') ... }`).
      const memo = new Map<Assertion, boolean>();
      const runsAlways = (x: Assertion): boolean => {
        if (!x.context.inConditional) return true;
        let r = memo.get(x);
        if (r === undefined) {
          r = (x.context.guards ?? []).every((g) => t.assertions.some((p) => p.line < x.line && p.subject?.text === g && runsAlways(p)));
          memo.set(x, r);
        }
        return r;
      };
      const a = t.assertions.find((x) => x.context.inConditional && !x.context.inCatch && !runsAlways(x));
      if (a) out.push(atAssertion(t, a, 'Assertion only runs when a condition holds — when it does not, the test passes silently.'));
    }
    return out;
  },
};
