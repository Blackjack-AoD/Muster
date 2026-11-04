---
name: review-ts-smells
description: 'Review check "TypeScript smells": report unsafe or unidiomatic TypeScript and over-complex code in a change. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a TypeScript review or runs /review-ts-smells.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# TypeScript smells

Report TypeScript smells in code the change added or changed. `.claude/agents/senior-ts-dev.md` holds the rules.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read the changed files with `git diff BASE..HEAD -- '*.ts' '*.tsx'`, leaving out tests. Judge only lines the change added or changed. Read the surrounding function when a smell depends on context.

| Smell | Report it when | The fix |
| --- | --- | --- |
| `any` | A new `any`, explicit or implied | `unknown` and narrowing, or the real type |
| Unchecked assertion | A new `as` or `!` where narrowing would work | A check or a type guard. Justified only where the compiler can't see an invariant the code guarantees |
| Unchecked boundary | `JSON.parse`, a backup file, a share link or a response is typed by assertion | Treat it as `unknown` and check it |
| Quiet default | A `switch` or `if` chain over a union or a data value falls through to a value, hiding a case it doesn't handle | A `never` check, or a warning for data values |
| Bag of optionals | Optional fields that only make sense together or depending on a state field | A discriminated union |
| `enum` | A new `enum` | A union of string literals |
| Logical or on data | `\|\|` where `0` or `''` is a real value | `??` |
| Mutated argument | A function changes an object it was given and isn't named for that | Return a new value, or change the name |
| Spread in a loop | Spread or `concat` builds an array or object inside a loop or `reduce` | A local array and `push` |
| Dense `reduce` | `reduce` doing more than a simple sum, where a loop reads better | `for...of` |
| Floating promise | A promise neither awaited nor handled, in code where failure matters | `await`, or handle the failure |
| Swallowed error | A `catch` that hides a failure, or an empty one with no comment saying why it's safe | Let it propagate, or warn |
| Silent data loss | Bad or unknown data is dropped with no warning to the player | Warn |
| Order dependence | A result depends on the order units were added or modifiers evaluated | Compute in a form that doesn't |
| Layer break | `src/data` imports `src/ui`, `src/store.ts` or `preact`, or touches `document` or `window` | Pass the value in |
| Logic in a component | A calculation in a `.tsx` file that could be tested alone | Move it to a function |
| Unsafe HTML | `innerHTML` or `dangerouslySetInnerHTML` | Render it as text |
| Too complex | A new or grown function does several jobs, or is nested deeply enough that a reader must hold it in their head | Split it |
| Clever types | Generics or conditional types that need a comment to explain | A simpler type |

Do not report a style preference, or code the change did not touch. Write `body` as a table: file and line, the smell, and the fix in one sentence.
