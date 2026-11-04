---
name: review-prose
description: 'Review check "Prose": report commit messages, comments and docs in a change that break the writing rules. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a prose review or runs /review-prose.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Prose

Report writing in the change that breaks `.claude/contracts/writing.md` or `.claude/contracts/delegation.md` §2. Read both first.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read `git log --format='%h %s%n%b' BASE..HEAD` and each comment, test name and Markdown line in `git diff BASE..HEAD`. Count; don't estimate.

| Problem | Report it when |
| --- | --- |
| Long subject | A commit subject is 72 characters or more, or isn't `area: what changed` in lower case |
| Long body | A commit body is over 15 lines |
| Wrong content | A commit body gives a verification result, says how the work went, or counts items |
| Argument in code | A comment weighs alternatives or justifies a decision |
| Over a limit | A doc comment over 5 lines, or more than 3 consecutive `//` lines |
| Issue reference | `src/` or `scripts/` cites a GitHub issue |
| Stale comment | A comment no longer matches the code beside it |
| Count that goes stale | A new line counts a collection, unless the number is the fact |
| Hard reading | A sentence is passive, padded, or uses jargon where a plain word works |

Do not report old text the change didn't touch, or a preference no rule covers. Write `body` as a table: where it is, the problem, and the rewrite in one line.
