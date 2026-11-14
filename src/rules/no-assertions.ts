import type { Rule } from '../core/types.js';
import { atTest, eachTest } from './helpers.js';

export const noAssertions: Rule = {
  id: 'no-assertions',
  severity: 'error',
  description: 'Test contains no assertions, so it passes as long as nothing throws.',
  fix: 'Assert on the observable result (return value, state change, emitted call). If "does not throw" is the real contract, say so: expect(() => fn()).not.toThrow().',
  check(file) {
    const out = [];
    for (const t of eachTest(file)) {
      if (t.assertions.length === 0 && t.helperAssertionCalls === 0 && !t.hasAssertionCountGuard) {
        out.push(atTest(t, `Test "${t.name}" has no assertions — it can only fail by crashing.`));
      }
    }
    return out;
  },
};
