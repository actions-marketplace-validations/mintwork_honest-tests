import type { Rule } from '../core/types.js';
import { atTest, eachTest } from './helpers.js';

export const snapshotOnly: Rule = {
  id: 'snapshot-only',
  severity: 'warning',
  description: 'The only assertions are snapshots, which record whatever the code does today — bugs included.',
  fix: 'Add at least one explicit assertion on the property that matters (a value, a field, a call). Keep the snapshot only as a change detector.',
  check(file) {
    const out = [];
    for (const t of eachTest(file)) {
      if (t.assertions.length === 0 || t.helperAssertionCalls > 0) continue;
      if (t.assertions.every((a) => a.matcherKind === 'snapshot')) {
        out.push(atTest(t, `Test "${t.name}" only asserts a snapshot — it will happily approve a wrong result the first time it runs.`));
      }
    }
    return out;
  },
};
