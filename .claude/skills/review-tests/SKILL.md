---
name: review-tests
description: 'Review check "Tests that cannot fail": report tests a change added or changed that would still pass with the code they test broken. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a tests that cannot fail review or runs /review-tests.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Tests that cannot fail

Report tests the change added or changed that would still pass with the code they test broken.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read the testing section of `.claude/agents/senior-ts-dev.md` first. Then read the changed tests with `git diff BASE..HEAD -- '*.test.ts' '*.test.tsx'`, and the source each one tests.

For each new or changed test, ask: what change to `src/` makes this fail? Report the test when the answer is "none".

| Smell | Report it when |
| --- | --- |
| Unawaited assertion | `expect(...).rejects` or `.resolves` has no `await`, so the test ends before it's checked |
| Vague assertion | `toBeDefined`, `toBeTruthy` or `not.toThrow` where the real value could be asserted |
| Bare throw | `toThrow()` with no message, so any error passes |
| Echoed expectation | The expected value is computed the way the code computes it, or was pasted from output, not worked out from the rules |
| Snapshot | `toMatchSnapshot` or a golden file: it records what the code does, not what's right |
| Assumed fixture | The assertion depends on a fixture value the test never varies, so the fixture can't falsify it |
| Mocked own code | A test mocks a module in `src/data` or `src/store.ts` where the real one could run. `fake-indexeddb` stands in for storage, and only `fetch`, `navigator` and `DOMParser` are stubbed |
| Empty loop | An assertion inside a loop or `it.each` over data that could be empty |
| Interpolated shape | A `<condition>`, `<repeat>`, `<constraint>` or `<modifier>` has a templated `type`, `field` or `scope`, which hides it from the sweep |
| Focused or skipped | `.only` or `.skip` is left in |
| Unexplained known bug | `it.fails` with no `// BUG:` comment, or one whose failure isn't the bug it names |
| Order only | The result depends on the order tests run in, or on state left by another test |

Also report new behaviour in `src/` that the change added with no test at all.

Do not report a style preference, or an old test the change did not touch. Write `body` as a table: test and line, the smell, the change to `src/` it would miss, and the fix in one sentence.
