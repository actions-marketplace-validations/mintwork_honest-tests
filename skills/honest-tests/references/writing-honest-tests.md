# Writing honest tests

## The litmus test

For every test, you should be able to complete this sentence:

> "If someone changes **\_\_\_** in the implementation, this test goes red."

If the blank is "nothing" or "it throws", the test is decoration.

A cheap mental mutation check: imagine flipping `>=` to `>`, `+` to `-`, `true` to `false`, or
replacing a return value with `undefined`. Which of your tests would fail? `npx @mintwork/honest-tests mutate
<file>` does exactly this for real.

## Choosing expected values (the oracle)

The expected value must be known **independently** of the code under test:

| Source | OK? |
| --- | --- |
| Worked out by hand in a comment (`// 40 * 0.9 = 36, + 5 shipping`) | yes |
| Taken from a spec, ticket, RFC, or domain rule | yes |
| A fixture file reviewed by a human | yes |
| Copied from what the code printed when you ran it | **no** — unless you then verified it |
| Computed with the same formula as the implementation | **no** |
| `fn(x)` compared with `fn(x)` | **never** |

Show your arithmetic in a short comment when it isn't obvious; it makes review trivial.

## Cover the behaviors that bugs live in

1. **Boundaries** — every comparison is a potential off-by-one. For `total >= 50`, test 49.99 and 50.
   For a range `0..100`, test -1, 0, 100, 101.
2. **Empty and identity cases** — empty list, 0, empty string, single element.
3. **Error paths** — invalid input must throw / reject / return an error *of the right type*:
   `expect(() => applyDiscount(1, 101)).toThrow(RangeError)`.
4. **Each branch** — every `if` should have a test where it's true and one where it's false.
5. **Side effects that matter** — calls to collaborators *with arguments*:
   `expect(mailer.send).toHaveBeenCalledWith('ada@example.com', expect.stringContaining('Receipt'))`.

## Mock at the boundary, not in the middle

Mock: network, database, filesystem, clock (`vi.useFakeTimers()`), randomness, third-party SDKs,
other services.

Don't mock: the unit under test, pure helpers it uses, value objects, or anything cheap and
deterministic. Over-mocked tests pass while the real wiring is broken.

```ts
// Dishonest: tests the mock
vi.mock('../src/pricing');
vi.mocked(subtotal).mockReturnValue(35);
expect(subtotal(items)).toBe(35);

// Honest: the real unit, a mocked boundary
const rates = { fetchTaxRate: vi.fn().mockResolvedValue(0.2) };
expect(await priceWithTax(items, rates)).toBe(42); // 35 * 1.2
expect(rates.fetchTaxRate).toHaveBeenCalledWith('DE');
```

## Prefer precise matchers

| Instead of | Use |
| --- | --- |
| `toBeDefined()` / `toBeTruthy()` | `toBe(value)`, `toEqual({...})`, `toMatchObject({...})` |
| `toHaveBeenCalled()` | `toHaveBeenCalledWith(args)` / `toHaveBeenCalledTimes(n)` |
| `toBeGreaterThan(0)` | `toBe(5)` when the value is known |
| `toThrow()` | `toThrow(RangeError)` or `toThrow('percent must be between 0 and 100')` |
| `toMatchSnapshot()` alone | an explicit assertion, optionally plus the snapshot |

## Structure

- One behavior per test; name it after the behavior: `'ships free once the discounted total reaches 50'`.
- Arrange / act / assert, with the act being a call to the real unit.
- No logic in tests: no `if`, no loops computing expected values, no `try/catch` around assertions.
  Use `it.each` tables for many cases.
- Async: always `await` (or `return`) promises and `.resolves`/`.rejects` matchers.
- Errors: `expect(() => f()).toThrow(...)`, `await expect(p).rejects.toThrow(...)`.

## When a test fails

1. Read the failure. Decide whether the **code** or the **test** is wrong — with evidence.
2. If the code is wrong: fix the code (or report the bug), keep the test.
3. If the test is wrong: fix the expectation *and* write down why the new value is correct.
4. Never delete, skip, loosen (`toBe` → `toBeDefined`), or wrap the assertion in `try/catch` to get green.
5. Never run snapshot update (`-u`) without reviewing each changed snapshot.

## Before you say "done"

```bash
npx @mintwork/honest-tests audit <tests>        # zero errors
npx @mintwork/honest-tests mutate <source file> # report the score; explain each survivor
```

Report: tests added, behaviors covered, mutation score, and any surviving mutants you judged
equivalent (with a one-line reason each).
