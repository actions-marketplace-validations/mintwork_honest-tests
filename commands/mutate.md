---
description: Mutation-check a source file and explain which behaviors its tests don't actually verify
argument-hint: "<source-file>"
---

Run `npx honest-tests mutate $ARGUMENTS --json` (it works on a temp copy; the working tree is not modified).

Then, for every surviving mutant, explain in one line which behavior is untested and propose the exact
assertion that would kill it (following `references/writing-honest-tests.md` from the `honest-tests` skill).
Flag mutants you believe are equivalent, with a reason. Finish with the mutation score.
