# Show HN draft

**Title** (80 chars max):

> Show HN: Honest-tests – your AI wrote 200 tests, many can't fail

**URL:** https://github.com/ranjan-mohanty/honest-tests

**Text:**

Your AI wrote 200 tests. Many can't fail.

I kept seeing the same pattern in agent-written test suites: a wall of green checkmarks, coverage going
up, and tests that couldn't fail if they tried. Some compare a value to itself
(`expect(r).toBe(r)`). Some never assert anything. Some assert on the value a mock was configured to
return. Some put the assertion inside a `try {} catch {}` that swallows the `AssertionError`. And some
build `{ service: 's3' }` and then check that `.service` is `'s3'`.

honest-tests is a small CLI plus an agent skill for JS/TS (vitest/jest) that does two things:

1. `npx honest-tests audit .` – static rules for tests that can't fail (13 rules, `--json` for CI and
   agents).
2. `npx honest-tests mutate src/file.ts` – built-in mutation testing. It flips `>=` to `>`, `&&` to `||`,
   constants, conditions and return values on a temp copy of the project. It runs only the tests that
   reach the file, and lists every change no test noticed.

The second command is the useful one. A static rule can tell you a test looks fake. A surviving mutant
proves that a line isn't checked.

Some numbers from running it on real code (projects not named, since the point isn't to shame
anyone):

- Across 5 popular OSS JS/TS projects (11,178 tests, all 13 current rules), 2.6% of tests get an
  error-level finding, and 0.6% have a high-confidence can't-fail bug. Mature human-written suites
  are mostly fine. The rules are tuned so a finding usually means something.
- In one app that enforces 100% line coverage, mutation testing still found that 15% of changes to a
  formatting module are caught by no test. Line coverage measures what ran, not what was checked.

The agent side is an Agent Skill (Claude Code plugin, plus `init codex` / `init cursor`) with a few hard
rules: never weaken an assertion to get green, derive expected values independently, mock boundaries
rather than the unit, and run `audit` + `mutate` before claiming tests are done.

I care a lot about false positives. A rule that cries wolf trains agents to sprinkle disable comments.
For example, the newest rule (`asserts-on-own-literal`) made 14 hits across ~27k OSS tests, and all 14
were real can't-fail assertions. Its first version flagged prototype-pollution tests
(`expect({}.polluted).toBe(undefined)`), which really can fail, so it now ignores reads that could
reach the prototype.

Limitations: JS/TS only for now (pytest adapter next), mutants run one at a time, and path-alias
imports aren't followed when picking related tests.

Would love feedback, especially false positives on your suite. MIT licensed.

---

**First comment (post right after submitting):**

How it decides what's fake, briefly. Each JS/TS test file is parsed into a language-neutral model
(tests, assertions, their subjects, matchers, try/catch and conditional context, mocks). The rules only
read that model, so a pytest adapter gets every rule for free.

The mutation runner copies the project to a temp dir, symlinks `node_modules`, and runs a baseline
first (a red baseline aborts). It writes each mutant only to the copy and restores it after every run.
The demo in the README is rendered from the real CLI output (`npm run demo:gif`).
