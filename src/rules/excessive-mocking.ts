import type { Rule } from '../core/types.js';

export const EXCESSIVE_MOCK_THRESHOLD = 5;

export const excessiveMocking: Rule = {
  id: 'excessive-mocking',
  severity: 'warning',
  description: `File mocks ${EXCESSIVE_MOCK_THRESHOLD}+ modules — the test mostly exercises mocks wired to each other.`,
  fix: 'Mock at the system boundary (HTTP, DB, clock) and let internal modules run for real, or split the unit so it needs fewer collaborators.',
  check(file) {
    if (file.moduleMocks.length < EXCESSIVE_MOCK_THRESHOLD) return [];
    const first = file.moduleMocks[0]!;
    return [
      {
        line: first.line,
        column: 1,
        evidence: file.moduleMocks.map((m) => m.specifier).join(', '),
        message: `Mocks ${file.moduleMocks.length} modules — little real code is left under test.`,
      },
    ];
  },
};
