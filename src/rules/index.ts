import type { Rule } from '../core/types.js';
import { assertsOnMock } from './asserts-on-mock.js';
import { catchOnlyAssertion } from './catch-only-assertion.js';
import { conditionalAssertion } from './conditional-assertion.js';
import { excessiveMocking } from './excessive-mocking.js';
import { focusedTest } from './focused-test.js';
import { mockedUnitUnderTest } from './mocked-unit-under-test.js';
import { neverFailingAssertion } from './never-failing-assertion.js';
import { noAssertions } from './no-assertions.js';
import { skippedTest } from './skipped-test.js';
import { snapshotOnly } from './snapshot-only.js';
import { swallowedAssertion } from './swallowed-assertion.js';
import { tautologicalAssertion } from './tautological-assertion.js';

export const rules: Rule[] = [
  noAssertions,
  tautologicalAssertion,
  assertsOnMock,
  neverFailingAssertion,
  swallowedAssertion,
  catchOnlyAssertion,
  mockedUnitUnderTest,
  excessiveMocking,
  snapshotOnly,
  conditionalAssertion,
  focusedTest,
  skippedTest,
];

export function ruleById(id: string): Rule | undefined {
  return rules.find((r) => r.id === id);
}
