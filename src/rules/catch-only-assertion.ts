import type { RawFinding, Rule } from '../core/types.js';
import { atAssertion, eachTest } from './helpers.js';

export const catchOnlyAssertion: Rule = {
  id: 'catch-only-assertion',
  severity: 'error',
  description: 'Assertions live only in a catch block; if the code stops throwing, the catch never runs and the test passes.',
  fix: 'Use expect(() => fn()).toThrow(...) / await expect(p).rejects.toThrow(...), or add expect.assertions(n) at the top of the test.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      if (t.hasAssertionCountGuard) continue;
      const inCatch = t.assertions.filter((a) => a.context.inCatch && !a.context.catchGuarded);
      if (inCatch.length === 0) continue;
      const onlyCatch = inCatch.length === t.assertions.length && t.helperAssertionCalls === 0;
      out.push(
        atAssertion(
          t,
          inCatch[0]!,
          onlyCatch
            ? 'All assertions are inside a catch block — if the code stops throwing, this test still passes.'
            : 'Assertion inside a catch block is skipped whenever the code does not throw.',
          { severity: onlyCatch ? 'error' : 'warning' },
        ),
      );
    }
    return out;
  },
};
