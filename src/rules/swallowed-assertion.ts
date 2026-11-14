import type { RawFinding, Rule } from '../core/types.js';
import { atAssertion, eachTest } from './helpers.js';

export const swallowedAssertion: Rule = {
  id: 'swallowed-assertion',
  severity: 'error',
  description: 'Assertion sits inside a try block whose catch does not rethrow, so a failing assertion is caught and the test passes.',
  fix: 'Remove the try/catch. For expected errors use expect(() => fn()).toThrow(...) or await expect(p).rejects.toThrow(...).',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      for (const a of t.assertions) {
        if (a.context.inSwallowingTry) {
          out.push(atAssertion(t, a, 'Assertion is inside a try/catch that swallows errors — when it fails, the catch eats the AssertionError and the test passes.'));
        }
      }
    }
    return out;
  },
};
