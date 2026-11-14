import type { RawFinding, Rule } from '../core/types.js';
import { atAssertion, eachTest } from './helpers.js';

export const conditionalAssertion: Rule = {
  id: 'conditional-assertion',
  severity: 'warning',
  description: 'Assertion is guarded by an if/ternary/&&, so the test passes without checking anything when the guard is false.',
  fix: 'Assert the condition itself (expect(result).toBeDefined()), then assert unconditionally. Split data-dependent branches into separate tests.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      const a = t.assertions.find((x) => x.context.inConditional && !x.context.inCatch);
      if (a) out.push(atAssertion(t, a, 'Assertion only runs when a condition holds — when it does not, the test passes silently.'));
    }
    return out;
  },
};
