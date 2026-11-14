import type { RawFinding, Rule } from '../core/types.js';
import { code } from './helpers.js';

export const mockedUnitUnderTest: Rule = {
  id: 'mocked-unit-under-test',
  severity: 'error',
  description: 'The module the test file is named after is itself mocked, so the real implementation never runs.',
  fix: 'Mock only the unit\'s dependencies (network, clock, filesystem, other modules) — never the unit itself. Import the real module and assert on its behavior.',
  check(file) {
    const out: RawFinding[] = [];
    for (const m of file.moduleMocks) {
      if (!m.isUnitUnderTest) continue;
      out.push({
        line: m.line,
        column: 1,
        evidence: m.text,
        severity: m.partial ? 'warning' : 'error',
        message: m.partial
          ? `Partially mocks ${code(m.specifier)}, the module under test — the overridden exports are never really tested here.`
          : `Mocks ${code(m.specifier)}, the module this file is testing — every assertion runs against the mock, not the real code.`,
      });
    }
    for (const s of file.unitSpies) {
      out.push({
        line: s.line,
        column: 1,
        evidence: s.text,
        message: `Replaces ${code(s.target)} (an export of the module under test) with a mock implementation.`,
      });
    }
    return out;
  },
};
