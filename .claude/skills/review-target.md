# The change under review

**Uncommitted work is a first-class target.** This repo commits to `main` directly, so a change under review may not be in a commit range.

Each review check (`.claude/skills/review-<check>/SKILL.md`) and `/codereview` read this file to pin the change they review. In a check, `BASE..HEAD` means that change.

## Pin the change

```bash
git status --short
git log --oneline -3
git branch --show-current
```

| The user said | Mode | Diff command |
| --- | --- | --- |
| nothing, and the working tree is dirty | **working tree** | `git diff HEAD` plus each untracked file |
| nothing, the tree is clean, and `main` is ahead of `origin/main` | **range** from `origin/main` | `git diff origin/main...HEAD` |
| nothing, and there's nothing unpushed | ask which commit or ref | - |
| `staged` | **staged** | `git diff --cached`, nothing else |
| a SHA, branch, tag, `HEAD~5` | **range** | `git diff <point>...HEAD` |
| a date, such as `24 hours ago` | **range**, from `git rev-list -1 --before="<date>" HEAD` | `git diff <point>...HEAD` |
| a ref, and the tree is dirty | ask which they mean | - |

**Working tree:** `git diff HEAD` doesn't show new files, and they're often the substance of a change. List them with `git ls-files --others --exclude-standard` and read each in full.

**Staged:** review the index and nothing else. Don't review untracked files: the commit wouldn't contain them. Paths in both `git diff --name-only` and `git diff --cached --name-only` are partially staged, so name them in the report.

**An empty diff is a stop, not a review.** Don't fall back to another mode. Confirm a ref resolves with `git rev-parse <point>`.

**Uncommitted work may be mid-flight.** If you know of an unfinished edit or an outstanding finding, say so before reviewing.

## `issues.md`

Make this file before the checks run. It's the spec of the change. Look for it in this order:

1. An issue number the user gave, an issue labelled `in progress`, or a reference in commit messages. Fetch it with `gh issue view <n>` and `gh issue view <n> --comments`. A child issue names its epic: read both, and prefer the epic where they disagree.
2. A path the user passed.
3. If you find nothing, ask. If there isn't one, skip the `spec` check and say so.

Read an issue's comments as part of the spec. A criterion may have been rewritten, or something deferred. When a comment defers something, that's scope, not a gap.

### Settled decisions

A decision the user made is settled, and a check doesn't report it. Collect each into a `## Settled` section at the end of `issues.md`:

- Each line of a "Decisions:" list in an issue comment, when an owner, member or collaborator wrote it.
- Each decision in the epic's Decisions section.
- Each answer the user gave in the session running the review.

Name the rule each one settles, not only a line, so a check skips every instance of it.

When `issues.md` holds the issue of the change, check each criterion against the change, ticked or not.
