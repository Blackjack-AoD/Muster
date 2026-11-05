---
name: review-security
description: 'Review check "Security": report ways untrusted input in a change could harm a player or their data. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a security review or runs /review-security.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Security

Muster is a static app with no server and no accounts. What it must not trust is what comes in: data files from any GitHub repo a player adds, share links anyone can send, and backup files. Report ways that input could harm a player or their data.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read `git diff BASE..HEAD` for every path in the change.

| Problem | Report it when |
| --- | --- |
| Script from data | Text from a data file, share link or backup reaches `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function` or a URL attribute |
| Unsafe URL | A value from data is used as an `href` or `src` without allowing only `https:` |
| Unchecked input | A share link or backup is used before it's validated, so a crafted one can crash the app or damage stored lists |
| Unbounded input | A zip, XML file or link is read with no bound where a crafted one could hang the phone. Decompression of an untrusted link counts |
| Built request | A repo name or path reaches a URL without encoding |
| New origin | A new network destination. Muster talks only to GitHub, and an extra origin leaks what a player does |
| Service worker | A change that lets the service worker cache cross-origin responses, or serve data a player should be able to refresh |
| Secret | A token or key in code, a workflow or a fixture |
| Workflow | A GitHub Actions change that widens permissions, or runs untrusted input |
| Dependency | A new dependency, or one added to `dependencies` rather than `devDependencies`, without a reason |

Do not report a theoretical risk with no path from input to harm. Write `body` as a table: file and line, the problem, the input that reaches it, and the fix in one sentence.
