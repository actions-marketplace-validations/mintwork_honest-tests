# Reddit drafts

Post each one separately and adapt it to the sub. Attach `docs/demo.gif`, or link the repo, which shows
it at the top.

---

## r/ClaudeAI

**Title:** Your AI wrote 200 tests. Many can't fail. I built a skill + CLI that catches it (and proves it)

**Body:**

If you've asked Claude Code (or any agent) to "add tests", you've probably seen this. Everything's
green and coverage goes up, but then you read the tests:

```ts
expect(result).toBe(result);                       // compares a value to itself
applyDiscount(100, 10);                            // no assertion at all
try { expect(total).toBe(70) } catch {}            // wrong value, still passes
const q = vi.fn().mockReturnValue(true);
expect(q()).toBe(true);                            // tests the mock it just configured
const p = { service: 's3' };
expect(p.service).toBe('s3');                      // asserts on a literal it just built
```

**honest-tests** is an Agent Skill + CLI for JS/TS (vitest/jest):

- **The skill** teaches one rule: a test is honest only if it fails when the behavior it names is
  broken. It also sets hard rules: never weaken an assertion to get green, never mock the unit under
  test, and derive expected values independently. Before saying "done", Claude self-audits with
  `audit` + `mutate`.
- **`npx @mintwork/honest-tests audit .`** has 13 static rules for tests that can't fail, plus `--json` for
  agents and CI.
- **`npx @mintwork/honest-tests mutate src/x.ts`** does built-in mutation testing. It breaks your code on purpose
  (on a temp copy) and shows every change no test noticed. That's the proof.

Install in Claude Code:

```text
/plugin marketplace add mintwork/honest-tests
/plugin install honest-tests@honest-tests
```

Or `npx @mintwork/honest-tests init claude` to drop the skill into `.claude/skills/`. There are also slash
commands: `/honest-tests:audit` and `/honest-tests:mutate`.

Real-world numbers, with no projects named:

- Across 5 popular OSS JS/TS projects (11,178 tests, all 13 current rules), 2.6% of tests get an
  error-level finding, and 0.6% have a high-confidence can't-fail bug.
- In one app that enforces 100% line coverage, mutation testing still found that 15% of changes to a
  formatting module are caught by no test.

I tune hard against false positives, because a noisy rule just teaches the agent to add disable
comments. Feedback very welcome, especially "this flagged my test and it's actually fine".

Repo: https://github.com/mintwork/honest-tests (MIT)

---

## r/javascript

**Title:** honest-tests: find JS/TS tests that can't fail, then prove it with built-in mutation testing

**Body:**

AI agents are great at producing tests that pass and terrible at producing tests that can fail. I
wrote a small tool for vitest/jest suites that does two things:

**1. `npx @mintwork/honest-tests audit .`** has 13 rules for tests whose outcome is fixed before your code runs:

- tautologies (`expect(x).toBe(x)`, `toHaveLength(list.length)`)
- tests with no assertions
- asserting on a mock's configured return value
- mocking the module under test
- assertions in a `try` whose `catch` swallows the error, or only inside a `catch`
- un-awaited `.resolves`/`.rejects`, and `.toBeTruthy` without `()`
- asserting on an object literal the test just built (common in runtime "type tests")
- leftover `.only`/`.skip`

**2. `npx @mintwork/honest-tests mutate src/pricing.ts`** does lightweight mutation testing with no config. It
flips `>=`→`>`, `&&`→`||`, `true`→`false`, `50`→`51`, `if (c)`→`if (true)` and `return x`→`return
undefined`. It runs only the test files that import the target (directly or through other local
modules) and prints every surviving mutant with its source line. It works on a temp copy, so your
tree is never touched.

Some numbers, with no projects named:

- Across 5 popular OSS JS/TS projects (11,178 tests, all 13 current rules), 2.6% of tests get an
  error-level finding, and 0.6% have a high-confidence can't-fail bug. Most human-written suites are in good
  shape, and the rules are tuned for precision rather than volume.
- In one app that enforces **100% line coverage**, mutation testing still found that 15% of changes
  to a formatting module are caught by no test.

It also ships as an Agent Skill (Claude Code plugin, Codex `AGENTS.md`, Cursor rule), so agents check
their own tests before claiming they're done. That's the original motivation.

It has one runtime dependency (`@babel/parser`), needs Node 22+, and is MIT licensed. A pytest adapter
is next. The rule engine is language-neutral.

https://github.com/mintwork/honest-tests
