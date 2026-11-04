---
name: review-ok
description: Finish a Muster issue after the user approves it. Push main (which deploys), confirm the deploy, close the issue, remove the "in progress" label, then delete that issue's worktrees and branches. Use when the user says "review ok", "review ok, push", "approved, close it" or "ship it and clean up" about an issue that implement-issue built.
---

# Review OK

"Review ok" from the user is the review. Don't ask for a second one. Run the steps in order. Stop at the first failure and report its output.

**This deploys.** Pushing `main` publishes the app to GitHub Pages, if the tests pass in the deploy workflow, and phones pick it up on their next update check.

**Scope is one issue.** Take the number from the argument, or from the issue this session implemented. If neither names one issue, ask with `AskUserQuestion`.

**Remove only what this session's delegations for this issue created.** The agent results name the worktree paths. If you don't have them, list `git worktree list` and ask.

## 1. Push

From the main checkout:

```bash
git status --short                                                        # must be clean
git fetch origin && git rev-list --left-right --count main...origin/main  # left = to push, right = to pull
git log --oneline origin/main..main                                       # what this push deploys
git push origin main
```

If the push is rejected, or the right count isn't 0: `git rebase origin/main`, `mise run typecheck && mise run test && mise run build`, and push again. Never force-push. If a check fails, stop.

## 2. Confirm the deploy

```bash
gh run list --branch main --workflow "Deploy to GitHub Pages" --limit 1 --json databaseId,status,headSha
gh run watch <id> --exit-status
```

If it fails, stop and tell the user at once: `main` holds a change players haven't received, and the next push deploys it. Don't revert without asking.

## 3. Close the issue

```bash
gh issue edit <n> --remove-label "in progress"
gh issue close <n>
```

Post no comment. Leave the assignee.

Close the parent epic when this issue was its last open sub-issue:

```bash
p=$(gh issue view <n> --json parent -q '.parent.number // empty')
[ -n "$p" ] && gh api "repos/{owner}/{repo}/issues/$p/sub_issues" --paginate -q '.[] | select(.state == "open") | .number'
```

Close it only when the epic is open and the list prints nothing. Remove its `in progress` label if it has one. Post no comment.

## 4. Check each worktree

For each worktree `$WT`:

```bash
git -C "$WT" status --short --untracked-files=no                       # tracked changes
git cherry origin/main "$(git -C "$WT" rev-parse HEAD)" | grep '^+'     # commits not on main
git worktree list --porcelain | grep -A3 "$WT" | grep locked            # a lock, with a pid
git -C "$WT" branch --show-current                                      # its branch, if any
```

Don't remove a worktree, and ask with `AskUserQuestion`, when it has tracked changes, `git cherry` prints a `+` line, or its lock names a pid that answers `kill -0 <pid>`: an agent still runs there.

## 5. Remove worktrees and branches

```bash
git worktree unlock "$WT" 2>/dev/null
git worktree remove --force "$WT"   # --force: node_modules and other ignored files block a plain remove
git branch -D <branch>              # skip for a detached worktree
git worktree prune
```

## 6. Report

Give one short list: the range pushed, the deploy result, the issue closed, the label removed, the epic closed or the sub-issues that keep it open, what you removed, and what you skipped and why.
