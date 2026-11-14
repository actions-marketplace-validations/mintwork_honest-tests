import type { RawFinding, Rule } from '../core/types.js';

export const focusedTest: Rule = {
  id: 'focused-test',
  severity: 'error',
  description: '.only / fit / fdescribe left in — every other test in the file silently stops running.',
  fix: 'Remove .only before committing.',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of file.tests) {
      if (t.modifier === 'only') {
        out.push({ line: t.line, column: 1, evidence: t.headText, test: t.name, message: `${t.kind === 'suite' ? 'Suite' : 'Test'} "${t.name}" is focused — the rest of the file is skipped.` });
      }
    }
    return out;
  },
};
