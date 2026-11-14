# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-14

First public release.

### Added

- **`honest-tests audit`**: static detection of JS/TS tests (vitest, jest, node:assert, chai) that
  can't fail. It has 13 rules:
  - errors: `no-assertions`, `tautological-assertion`, `asserts-on-mock`, `asserts-on-own-literal`,
    `never-failing-assertion`, `swallowed-assertion`, `catch-only-assertion`,
    `mocked-unit-under-test`, `focused-test`
  - warnings: `excessive-mocking`, `snapshot-only`, `conditional-assertion`, `skipped-test`
- **`asserts-on-own-literal`**: flags assertions on a literal the test just built, e.g.
  `const p = { service: 's3' }; expect(p.service).toBe('s3')`. These are common in runtime "type
  tests". The rule only fires when the value traces back purely to literals declared in the same
  test, and that binding is never passed to code, mutated or reassigned.
- **`honest-tests mutate <file>`**: built-in mutation testing. It works on a temporary copy of the
  project and only runs the test files that reach the target, so the working tree is never touched,
  even on Ctrl-C. Supports `--test-cmd`, `--max-mutants`, `--timeout` and `--min-score`.
  `audit --mutate <file>` combines both checks in one run.
- Output for humans and machines (`--json`, schema version 1), plus suppression comments
  (`honest-tests-disable-next-line`, `-disable-line` and file-level `disable`) and `--fail-on`.
- **Agent integrations**:
  - Agent Skill (`skills/honest-tests`) with a smell catalog, a guide to writing honest tests, an
    audit procedure and a mutation-testing reference.
  - Claude Code plugin and marketplace, with `/honest-tests:audit` and `/honest-tests:mutate`.
  - `honest-tests init claude|codex|cursor` installs the skill, an `AGENTS.md` section or a Cursor
    rule.
- `npm run demo:gif` renders the README demo from the real CLI output.

### Known limitations

- JS/TS only. The pytest adapter is planned; Python test files are reported as unsupported rather
  than skipped silently.
- `mutate` doesn't follow path-alias imports (`@/lib/x`) when picking related tests yet. Pass
  `--test-cmd` in that case.
- Mutants run one at a time.

[0.1.0]: https://github.com/ranjan-mohanty/honest-tests/releases/tag/v0.1.0
