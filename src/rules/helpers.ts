import type { Assertion, RawFinding, TestCase, TestFileModel } from '../core/types.js';

export function* eachTest(file: TestFileModel): Generator<TestCase> {
  for (const t of file.tests) {
    if (t.kind !== 'test' || !t.analyzable) continue;
    if (t.modifier === 'todo' || t.modifier === 'skip') continue;
    yield t;
  }
}

export function atAssertion(t: TestCase, a: Assertion, message: string, extra: Partial<RawFinding> = {}): RawFinding {
  return { line: a.line, column: a.column, message, evidence: a.text, test: t.name, ...extra };
}

export function atTest(t: TestCase, message: string, extra: Partial<RawFinding> = {}): RawFinding {
  return { line: t.line, column: 1, message, evidence: t.headText, test: t.name, ...extra };
}

export function code(s: string, max = 60): string {
  return '`' + (s.length > max ? s.slice(0, max - 1) + '…' : s) + '`';
}
