import type { RawFinding, Rule } from '../core/types.js';

export const skippedTest: Rule = {
  id: 'skipped-test',
  severity: 'warning',
  description: '.skip / xit / xdescribe left in — the test counts toward the total but verifies nothing.',
  fix: 'Fix the test, delete it, or turn it into it.todo("...") with a tracking issue.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of file.tests) {
      if (t.modifier === 'skip') {
        out.push({ line: t.line, column: 1, evidence: t.headText, test: t.name, message: `${t.kind === 'suite' ? 'Suite' : 'Test'} "${t.name}" is skipped.` });
      }
    }
    return out;
  },
};
