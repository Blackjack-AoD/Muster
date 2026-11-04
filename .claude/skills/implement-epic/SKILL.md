---
name: implement-epic
description: Implement a Muster epic whose child issues are already written. Plan parallel workstreams by file ownership, give each stream one worktree, run a fresh subagent for each issue, and land each issue on local main through implement-issue. Use when the user says "implement epic", "plan how you would implement epic N", "run the epic", or asks for parallel workstreams across the child issues of an issue.
---

# Implement epic

Takes an epic number. Plans streams of child issues, then runs them at the same time, each stream in one worktree that lives until its last issue lands.

**`implement-issue` is the procedure for each issue.** This skill changes only what's in "What differs from implement-issue". Read that skill before the first delegation.

**The run has two parts, and the user starts the second.** Plan, ask the decisions, then stop. Create no worktree and claim no issue until the user says to start.

## Part 1: Plan

### 1. Read the epic and its children

Save each to the scratchpad and read from there. Don't print the bodies whole.

```bash
gh issue view <epic> > $S/epic.md && grep -n '^#' $S/epic.md
gh issue view <epic> --comments > $S/comments.md
for n in <children>; do gh issue view $n --json number,title,state,labels,assignees,body > $S/i$n.json; done
```

From each child, take its state, assignee, acceptance criteria and blockers. Check each blocker outside the epic: an open one nobody is working on puts its dependants outside this run. Say so in the plan.

### 2. Find the files the issues share

A stream groups issues by file, because two agents editing one file conflict.

- List the source and test files each child changes. Use `grep -n` for the functions it names, and line numbers where a large file holds more than one area.
- Mark each file more than one child changes.
- List each shared surface more than one child needs and none owns: a type, a helper, a store function. Give it its own issue, landed before the issues that use it.

### 3. Make the streams

**One stream owns each shared file, or one region of it.** The user gives the maximum number of streams. Use fewer when the issues don't fill them.

- Put the issues that change a file in the stream that owns it.
- Put each stored format change in one stream.
- Order each stream by its blockers, with the critical path first.
- Leave out an issue that waits for work outside the run.

Give the plan as tables:

| Table | Columns |
| --- | --- |
| Streams | Worktree name, what it owns, its issues in order |
| Merge points | The issue, its worktree, and what must land before it starts |
| Conflict risks | The shared file or surface, and what keeps the conflict small |

State the critical path as one line of issue numbers.

### 4. Ask the decisions, then stop

Use `AskUserQuestion`. Ask only what changes the order of work:

- A blocker link that holds a stream idle and the tables don't need.
- A blocker in progress outside the run: who lands it.
- Each open choice in a child: an "X, or Y", or a criterion that names no rule. Ask them all now and put each answer in the delegation prompt. An agent that stops on a choice the issue already showed costs a round trip.

State the plan again with the answers applied. Name the first issue of each stream. Then stop.

## Part 2: Run

### 5. Set up, once

Do `implement-issue` steps 2b, 2c and 5 for the first issue of each stream. Then sync and cut the streams:

```bash
git fetch origin
git rebase origin/main
git rev-parse --short HEAD                     # the base SHA
mise run lint && mise run test && mise run typecheck    # the baseline
for w in <stream names>; do
  git worktree add -q -b <w> .claude/worktrees/<w> main
  (cd .claude/worktrees/<w> && mise trust -q && mise run install)
done
```

Claim only the issue a stream is about to start. Claim the next one when it starts.

### 6. Delegate one issue for each stream

Start the first agent of each stream in one `Agent` block, with no `isolation`. The prompt holds what `implement-issue` step 6a lists, plus:

- **The worktree first:** its absolute path and branch. The agent's shell possibly starts in the main checkout, so tell it to `cd` to the worktree in each command and never to write in the main checkout.
- **The base check:** `git rev-parse --show-toplevel`, `git merge --ff-only <SHA>`, `git merge-base --is-ancestor <SHA> HEAD`, and a `grep` for one function the issue edits.
- **The sibling worktrees by name**, with the ban on `git stash`.
- **The region the stream owns** in a shared file, and the region a sibling edits.
- **The scope limits:** what a later issue of the stream builds, so the agent doesn't build it now.

### 7. Land each issue as its agent reports

Do `implement-issue` steps 6b to 6e, in the order they finish, then its documentation pass for that issue. Then:

1. Read the merge points table. If the stream's next issue needs work that hasn't landed, the stream waits. Start the next issue of another stream the landing unblocked.
2. Claim the next issue and start a new agent in the same worktree, after `git -C "$WT" rebase main`. Its prompt names the new SHA and what the stream's earlier issues left behind.

When a landing changes something a running agent's brief names, send the correction with `SendMessage` at once.

Tick a criterion and fast-forward only when the last run of the rebased branch passed. Don't chain them after a pipe: a pipe through `grep` can return success when the tests never ran.

### 8. Finish

When every stream has ended, run `implement-issue` step 8's checks once on `main`. Land nothing while they run. A failure belongs to the landings since the last green SHA: find the one that caused it. Then post each child's completion comment.

Tell the user, and leave the worktrees and branches in place until `review-ok`. Don't push.

## What differs from implement-issue

| implement-issue | This skill |
| --- | --- |
| `isolation: "worktree"` on each `Agent` call | No `isolation`. The prompt names the stream's worktree |
| A worktree lives for one criterion | A worktree lives for the stream |
| The blocker check stops the run | A blocker makes the stream wait, unless the user waived it in step 4 |
| Checks and the completion comment per issue | Checks once, after every stream ends; then the completion comments |
| `review-ok` deletes the issue's worktree | The worktree holds later issues, so delete it after the stream's last issue |

These rules don't change: one fresh agent per delegation, the test-first check on each `test:` commit, the writing check before each landing, `DECISION NEEDED` goes to the user, never poll a running agent, and push only through `review-ok`.
