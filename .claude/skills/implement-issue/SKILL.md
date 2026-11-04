---
name: implement-issue
description: Implement a GitHub issue end-to-end in Muster. Read the issue, check blockers, claim it, delegate each acceptance criterion to a subagent in its own worktree, read the diffs, land the work on local main, correct the docs the work made stale, and post a review-ready comment. Use when the user wants to work on a GitHub issue, says "implement issue", "let's work on issue 5" or "start building #12". Also handles a re-run on an implemented issue, reading BUG and MISSING feedback and addressing it.
---

# Implement issue

Takes an issue number, implements its acceptance criteria through subagents, and leaves them on local `main` for the user to review.

This is trunk-based development: no feature branches and no pull requests. Delegations work in their own worktrees and land on local `main` by fast-forward, one criterion at a time. **Pushing `main` deploys to players, so this skill never pushes.** `review-ok` does, once the user approves.

The test suite takes about a second, so run it freely.

## Process

### 1. Read the issue

```bash
gh issue view <n>
gh issue view <n> --comments
```

Take the acceptance criteria (checkbox lines), the **Blocked by** section and the parent epic, if any.

If every criterion is ticked, this is a **feedback pass**: go to step 2a. Otherwise go to step 2b.

### 2a. Feedback pass

Claim the issue (step 2c). Read the issue comments for **BUG:** and **MISSING:**.

For each one, start a fresh delegation (step 6a). For a BUG, the first thing the agent writes is a test that reproduces it, failing for the reason the reviewer gave. A bug that wasn't reproduced first wasn't necessarily fixed: it may just have moved.

When they're fixed, run step 8's checks and post one comment listing what was fixed. If there's no such feedback, tell the user.

### 2b. Check blockers

```bash
gh issue view <blocker> --json state -q '.state'
```

If any blocker is open, stop and say which. Don't proceed.

### 2c. Claim the issue

```bash
me=$(gh api user -q '.login')
gh issue view <n> --json assignees,labels -q '{assignees: [.assignees[].login], labels: [.labels[].name]}'
```

If the issue carries `in progress` and `$me` isn't assigned, or it has no assignee, stop and ask with `AskUserQuestion` whether to take it over. Two agents on one issue make edits nothing can reconcile.

Otherwise claim it. Create the label once with `gh label create "in progress"` if it's missing.

```bash
gh issue edit <n> --add-label "in progress" --add-assignee @me
```

### 3. Sync, then check the baseline

```bash
git fetch origin
git rev-list --left-right --count main...origin/main   # left = yours unpushed, right = theirs unpulled
git rebase origin/main                                 # nothing to do when the right-hand count is 0
git rev-parse HEAD                                     # the base SHA, used in steps 7 and 8
mise run lint && mise run test && mise run typecheck
```

Local `main` must stay a descendant of `origin/main`. If there's uncommitted work in the way, don't stash or discard it: ask.

If the baseline fails, those failures aren't this issue's. Delegate a fix of those failures only, up to three tries. If it's still red, stop and tell the user.

### 4. Choose the subagent

Default to `senior-ts-dev` and don't ask. Use `general-purpose` for work that's only workflows, tooling or docs. Name the choice in your next message.

### 5. Read the epic, and check the work

If the issue has a parent epic, read its decisions.

**A request doesn't waive a stored format or a decision.** Before delegating, check the behaviour against:

- The epic's Decisions, and any decision recorded on the issue.
- The stored formats: `Roster`, `Force`, `Sel`, `Opt.key`, `Snapshot`, the backup file. A change needs a migration and a test using the old shape. If the issue doesn't cover that, ask.
- What real data does. If a criterion depends on the meaning of a BattleScribe or New Recruit feature, shallow-clone a data repo into the scratchpad and look.

If the work conflicts with any of these, don't delegate it. Tell the user what it conflicts with, and recommend the design that doesn't.

Read `.claude/contracts/delegation.md` once, so you can tell whether a report obeyed it.

### 6. Implement the criteria

Review and land criteria one at a time.

**One delegation, one fresh agent.** Criteria that are one piece of work go to one delegation: the test is whether they share a file. Where they share no file they're separate delegations, however neatly the issue groups them. Those can run at the same time, in one `Agent` block, and land in the order they finish.

Don't continue a finished agent into the next delegation: every later turn pays for its whole context. Use `SendMessage` only for the fix-retry loop (c), or for a correction when a landing moved something a running agent's brief names.

**a) Delegate**

Before every `Agent` call:

```bash
git fetch origin
git rebase origin/main        # a no-op when nothing moved
git rev-parse --short HEAD    # the SHA this prompt names
```

Use `isolation: "worktree"` on every call. Worktrees are cut from `origin/main`, not from local `main`, so they can't see what you've landed and not pushed. Each prompt must open with this, with the SHA filled in:

```bash
git rev-parse --show-toplevel                              # must be a worktree, not the main checkout
git merge --ff-only <SHA>                                  # brings in what has landed on main
git merge-base --is-ancestor <SHA> HEAD && echo "base OK"  # or STOP
mise trust -q && mise run install                          # a new worktree starts untrusted, with no node_modules
```

Say: fast-forward, never rebase, never create a branch or worktree of your own, and stop if the fast-forward is refused or `--show-toplevel` is the main checkout. Name one file or function the task edits, for the agent to confirm it exists.

The prompt also holds:

- The issue number, for the agent to read with `gh issue view`, and the criterion it's on.
- What earlier criteria completed.
- **Locations, found once by you:** the paths, the nearest code to follow, the tests that cover it. A path and a line range are material. A file layout, a function list or a test list is a plan, and producing those is the agent's job.
- `.claude/contracts/delegation.md`, by path, to read in full and treat as binding. Name the path; never paste it.
- *"Do not spawn subagents. If the brief lacks a fact you need, read the code yourself, or stop and report what you need."*
- When two delegations run at once, name the sibling and repeat the ban on `git stash`.

**Never hand a subagent a finished test list.** Where an earlier delegation produced one, give it as material, and require the agent to restate it as its own before its first edit. Producing the list is the mechanism, and a ready-made one removes the only pause the contract has.

**Don't poll a running agent.** An empty worktree is the normal state of an agent reading, so looking tells you nothing and costs a turn. Say it's running and wait for the notification. Never predict what it will hand back.

**b) Read the diff, not the report**

```bash
WT=<the worktree path from the agent's result>
git -C "$WT" log --oneline main..HEAD     # test: first, then the implementation
git -C "$WT" log -p main..HEAD
```

Read every new file in full. The report is the agent's account of its work, not the work.

- **Test-first shows in the log.** A `test:` commit adds nothing under `src/` except stubs with no behaviour. Tests in the same commit as their code break the ordering: send it back.
- **The summary line for each `test:` commit** shows a failure per added test and no failed suites. Fewer failures than tests means a test passed against the stub, so it pins nothing: ask for a sharper assertion, unless the report names it as a mutation check.
- **The failure lines show why each test failed.** Vitest counts `x is not a function` as a failed test, so the summary can't show this. Each should be an `AssertionError`, unless the error is the bug being fixed. `Failed Suites`, or a `TypeError` from a missing export, is a staging slip rather than an ordering error: the stub went in with the code, so ask for the pair to be rewritten.
- **A test in the tree that isn't on the report's list** is one planned late. Ask why. "I thought of it later" means it goes back to be written first.
- **A decision made rather than raised.** Scan for *worth a reviewer's eye*, *flagging*, *the spec doesn't say*, *deliberately*, *I chose*. Each is a decision to put to the user, however well argued. A wrong decision that passes tests is the expensive kind. When the user answers, delete the paragraph: the test pins it.
- **A precedent being distinguished:** *"X does it this way, but that doesn't apply because…"*. Read both precedents yourself before accepting that.
- **Scope creep:** files the criterion didn't call for, a helper added in passing, an abstraction with one caller.
- **New `any`, `as` or `!`, new lint warnings,** and any change to a stored format.
- **A mutation check's exemption:** the file it exercises must not be in the diff. *"Already correct"* is the tell: send it back.

**c) Handle DECISION NEEDED**

If a report holds a block, or step b found a decision made in the wrong shape:

1. Don't land anything, and don't work around it with another agent.
2. Put each question to the user with `AskUserQuestion`, as they arise, with the options and costs, and the recommendation first where you agree with it.
3. Keep the answer for the completion comment.
4. Check the answer against step 5.
5. Start a new `Agent` call in the same worktree with the answer stated as a constraint, and the earlier commits named as existing work. Don't answer through `SendMessage`.

A block is the mechanism working, never the agent failing. Your own brief is one of the things a block can be raised against: check the claim before defending it, and say plainly if your instruction was wrong.

**d) Run the checks**

```bash
git -C "$WT" rebase main
(cd "$WT" && mise run lint && mise run test && mise run typecheck)
```

If a check fails, find the cause first, then send the agent the fix to make, up to three tries. If it's still failing, stop and ask the user. A failure that appears only after the rebase isn't flaky: two pieces of work have met.

**e) Land the criterion**

Run the check in `.claude/contracts/writing.md` on the commits. A reword changes SHAs, so rerun step d after one.

Tick the criterion and land it together, from the main checkout:

```bash
gh issue view <n> --json body -q '.body' > $S/body.md     # edit: - [ ] becomes - [x]
gh issue edit <n> --body-file $S/body.md && git merge --ff-only <the worktree's branch>
```

If the fast-forward refuses, a sibling landed: rebase and rerun step d rather than forcing it. When a landing changes something a running sibling's brief names, `SendMessage` it the correction at once. Nothing else will tell it.

**Never squash a `test:` commit into its implementation.** The pair is the only record that the test came first.

Landing per criterion keeps each review small, and makes unwinding a criterion one `git revert`.

Nothing under `.claude/` lands with a criterion. A criterion that needed a tooling change leaves it uncommitted, and you tell the user.

### 7. The documentation pass

Do this yourself. You have the whole issue in context, and a subagent given one criterion doesn't, which is why stale claims survive. The failure isn't a missing doc: it's a confident sentence that was true last week.

```bash
git diff --stat $BASE..HEAD
grep -n "Not yet covered" -A6 README.md
```

- `README.md`: Screens, "How the data is read", "Not yet covered", commands.
- `.claude/agents/senior-ts-dev.md` and the skills, where a command or a rule changed. Tell the user; leave these uncommitted.
- `it.fails` tests this issue made pass, and `// BUG:` comments that no longer apply.
- A comment arguing for a decision. Delete it: the test pins the decision.

Verify against the code, not the report. Correct text in place. Delete a wrong claim rather than striking it through. A doc that's merely thin isn't this pass's business; a doc that's now wrong is.

Commit the pass yourself in the main checkout, staging paths explicitly so nothing under `.claude/` rides along.

Tell the user what you found and changed. If you found nothing, say so: it's a real answer for a small issue and a suspicious one for a large change.

### 8. Run the checks, then post the completion comment

From the main checkout, on `main`:

```bash
git status --short
mise run lint && mise run typecheck && mise run test && mise run build
```

A failure here is this issue's, because step 3 proved `main` green at the base SHA. Fix it with a fresh agent in a worktree, as a `test:` and implementation pair, land it, and run this step again.

Tests say nothing about how a screen looks. If the change touches `src/ui`, run it with `mise run dev` and check it, or say plainly that you didn't.

Don't push, and don't close the issue. Leave the label and the assignment: an issue awaiting review is still in progress.

Post one comment on the issue, following `.claude/contracts/writing.md`:

```bash
gh issue comment <n> --body "All acceptance criteria implemented and verified with passing tests. Ready for human review.

Decisions:
- <question> → <answer>"
```

Leave the decisions list out if there were none. This is the only comment on a normal run. The next step is `/codereview` and then `/review-ok <n>`.

## Important notes

- **Group commands by action.** Each Bash call does one action you can name in a few words. The tick and the fast-forward are one action. A commit, a rebase, a test run and an issue edit are each their own call.
- **An issue is finished when the documents that describe the system are true again**, not when its tests pass.
- **Surface decisions as they arise**, not at the end. A decision made in criterion 2 is built on by criterion 3.
