---
name: review-spec
description: 'Review check "Spec match": report work a change claims to build and does not, and code nothing asked for. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a spec review or runs /review-spec.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Spec match

Report work the change claims to build and doesn't. `issues.md` holds the issue and its epic, with comments. When it holds no issue, say so in one sentence and report no finding.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

For each issue, find its acceptance criteria. Then read `git log --oneline BASE..HEAD`, list the paths with `git diff --name-only BASE..HEAD`, and read the diff of every path.

| Problem | Report it when |
| --- | --- |
| Ticked, not built | A criterion is ticked and no code does it. Search the whole repo, not only the change |
| Narrowed | The code does a smaller thing than the criterion says, such as handling one scope where it says each |
| No test | A criterion with behaviour no test asserts |
| Built, not asked | Code in the change that neither the issue nor the epic asks for |
| Docs left behind | The change makes `README.md` wrong, or leaves "Not yet covered" out of date |

## Do not report

- A criterion with no assertable behaviour, when the change exists.
- A difference in wording where the code does what the criterion means.

Write `body` as a table: issue and criterion (quoted, short), the problem, where the code is or should be, and what to do in one sentence.
