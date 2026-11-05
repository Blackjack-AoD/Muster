---
name: review-duplication
description: 'Review check "Duplication and dead code": report code a change added that the repo already has, and code it left unreachable. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a duplication review or runs /review-duplication.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Duplication and dead code

Report code the change added that does what code in the repo already does, and code the change left unreachable.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read the added functions with `git diff BASE..HEAD -- '*.ts' '*.tsx'`. For each new function that isn't a component, search the repo for one doing the same work. Search by behaviour, with `git grep`, not only by name. Read a candidate in full before you report it.

| Problem | Report it when |
| --- | --- |
| Same function | A new function does what an existing one does, with the same inputs and result. Name the existing one |
| Local helper | A new helper repeats something in `src/data`, `src/ui/common.tsx` or the platform |
| Repeated logic | The same calculation appears in a screen and in `src/data` |
| Unreachable | An export, function or type the change left with no caller. Search `src/` and `scripts/` first |
| Dead branch | A branch the change made impossible, such as a case for a value nothing produces now |

Do not report a function only a test calls when a test is its reason to exist, or two functions that look alike but change for different reasons. Write `body` as a table: file and line, the problem, the existing code or the missing caller, and the fix in one sentence.
