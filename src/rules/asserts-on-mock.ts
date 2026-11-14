import type { RawFinding, Rule } from '../core/types.js';
import { atAssertion, code, eachTest } from './helpers.js';

export const assertsOnMock: Rule = {
  id: 'asserts-on-mock',
  severity: 'error',
  description: 'Asserts on the return value of a mock the test configured itself — it tests the mock, not the code.',
  fix: 'Call the real unit under test (which uses the mock as a dependency) and assert on what the unit produces. Assert on the mock only for interactions (toHaveBeenCalledWith).',
  check(file) {
    const out: RawFinding[] = [];
    for (const t of eachTest(file)) {
      const configured = new Map<string, number>();
      for (const m of t.mockSetups) if (m.configuresReturn && !configured.has(m.target)) configured.set(m.target, m.line);
      if (configured.size === 0) continue;
      for (const a of t.assertions) {
        const s = a.subject;
        if (!s || a.matcherKind === 'called' || a.matcherKind === 'none') continue;
        let hit: string | undefined;
        if (s.kind === 'call' && s.calleeText && configured.has(s.calleeText)) hit = s.calleeText;
        else if (s.kind === 'identifier' && s.aliasCalleeText && configured.has(s.aliasCalleeText)) hit = s.aliasCalleeText;
        else if (s.kind === 'member') hit = [...configured.keys()].find((k) => s.text.startsWith(`${k}.mock.`));
        if (hit) {
          out.push(
            atAssertion(
              t,
              a,
              `Asserts on what mock ${code(hit)} returns (configured on line ${configured.get(hit)}) — this verifies the mock, not your code.`,
            ),
          );
        }
      }
    }
    return out;
  },
};
