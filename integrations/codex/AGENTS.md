## Testing: honest tests only

A test is honest only if it **fails when the behavior it names is broken**. When writing or changing tests:

- Never weaken an assertion, change an expected value, add `.skip`, or wrap an assertion in `try/catch` to make a test pass. When a test fails, first assume the code is wrong.
- Expected values must come from a spec or a hand calculation, never from re-running the code under test (`expect(f(x)).toBe(f(x))`) or copying its output unverified.
- Never mock the module under test. Mock only boundaries (network, DB, clock, randomness, filesystem).
- Assert on what the unit returns or changes, not on what a mock was configured to return. Use mocks for interaction checks (`toHaveBeenCalledWith`).
- Every test asserts something specific: exact values over `toBeDefined()`/`toBeTruthy()`; no snapshot-only tests; `await` every `.resolves`/`.rejects`; errors via `expect(() => f()).toThrow(Type)`.
- Cover boundaries (`>=` vs `>`), empty inputs, and error paths.
- Never commit `.only`.

Before reporting that tests are done, run and fix:

```bash
npx honest-tests audit <test files>    # must report 0 errors
npx honest-tests mutate <source file>  # report the mutation score; add tests for surviving mutants
```

To audit an existing suite: run `npx honest-tests audit . --json`, verify each finding by reading the test (confirmed / false-positive / accepted), prove key findings with `npx honest-tests mutate <file>`, then report "N of M tests can't fail" with the confirmed findings and surviving mutants. Do not edit files during an audit unless asked.
