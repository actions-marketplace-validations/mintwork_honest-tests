# X thread draft

Attach `docs/demo.gif` to post 1. Each post stays under 280 characters.

---

**1/**
Your AI wrote 200 tests. Many can't fail.

I built honest-tests: an agent skill + CLI that finds JS/TS tests that can't fail, and proves it by
breaking your code and watching the suite stay green.

npx honest-tests audit .

[demo.gif]

**2/**
What "can't fail" looks like:

expect(r).toBe(r)
a test with no assertion
asserting what a mock was told to return
try { expect(…) } catch {}
const p = { service: 's3' }; expect(p.service).toBe('s3')

All green. All useless.

**3/**
Static rules say a test *looks* fake. Mutation testing proves it:

npx honest-tests mutate src/pricing.ts

It flips >= to >, && to ||, 50 to 51, and return x to undefined on a temp copy, then lists every change
no test noticed.

**4/**
Real numbers (no projects named):

Across 5 popular OSS JS/TS projects (11,178 tests, all 13 current rules), 2.6% of tests get an
error-level finding, and 0.6% have a high-confidence can't-fail bug.

Human-written suites are mostly fine. The rules are tuned for precision.

**5/**
The one that surprised me: an app that enforces 100% line coverage.

Mutation testing still found that 15% of changes to a formatting module are caught by no test.

Coverage measures what ran, not what was checked.

**6/**
The point is agents. The skill teaches Claude Code / Codex / Cursor one rule: a test is honest only
if it fails when the behavior it names is broken.

Then: never weaken an assert to get green, never mock the unit, and run audit + mutate before saying
"done".

**7/**
Claude Code:
/plugin marketplace add ranjan-mohanty/honest-tests

Codex / Cursor:
npx honest-tests init codex
npx honest-tests init cursor

MIT, Node 22+, one runtime dep. pytest next.

github.com/ranjan-mohanty/honest-tests
