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
      const restores = t.mockRestores ?? [];
      // Lines of setups that share a declaration (`const spy = vi.spyOn(o, 'm')` registers `spy` and `o.m`).
      const setupLines = (target: string) => new Set(t.mockSetups.filter((m) => m.target === target).map((m) => m.line));
      /** The mock still returns its configured value at `line` (not restored/reset in between). */
      const activeAt = (target: string, line: number) => {
        const lines = setupLines(target);
        const setupLine = configured.get(target)!;
        return !restores.some((r) => {
          if (r.line <= setupLine || r.line >= line) return false;
          if (r.target === null || r.target === target) return true;
          return [...setupLines(r.target)].some((l) => lines.has(l));
        });
      };
      for (const a of t.assertions) {
        const s = a.subject;
        if (!s || a.matcherKind === 'called' || a.matcherKind === 'none') continue;
        let hit: string | undefined;
        if (s.kind === 'call' && s.calleeText && configured.has(s.calleeText)) hit = s.calleeText;
        else if (s.kind === 'identifier' && s.aliasCalleeText && configured.has(s.aliasCalleeText)) hit = s.aliasCalleeText;
        // Only `.mock.results` echoes configured return values; `.mock.calls`, `.lastCall`,
        // `.invocationCallOrder`, `.instances` record what the code under test did with the mock.
        else if (s.kind === 'member') hit = [...configured.keys()].find((k) => s.text.startsWith(`${k}.mock.results`));
        if (hit && !activeAt(hit, a.line)) hit = undefined;
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
