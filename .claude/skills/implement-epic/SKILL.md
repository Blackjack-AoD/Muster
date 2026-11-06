---
name: implement-epic
description: Implement a Muster epic. Break it into small child issues that share no file where they can, plan parallel workstreams by file ownership, file the issues, give each stream one worktree, run a fresh subagent for each issue, and land each issue on local main through implement-issue. Use when the user says "implement epic", "break down the epic", "split epic N into tasks", "plan how you would implement epic N", "run the epic", asks for parallel workstreams across the child issues of an issue, or after write-the-epic.
---

# Implement epic

Takes an epic number. Splits the epic into child issues where it has none, plans streams of them, then runs the streams at the same time, each in one worktree that lives until its last issue lands.

**`implement-issue` is the procedure for each issue.** This skill changes only what's in "What differs from implement-issue". Read that skill before the first delegation.

**A re-run on a finished epic is a feedback pass.** When every child's criteria are ticked, skip the plan and do `implement-issue` step 2a for each child with **BUG:** or **MISSING:** comments.

**The run has two parts, and the user starts the second.** Plan, ask the decisions, then stop. File no issue, create no worktree and claim no issue until the user says to start.

## Part 1: Plan

### 1. Read the epic and its children

Save each to the scratchpad and read from there. Don't print the bodies whole.

```bash
gh issue view <epic> > $S/epic.md && grep -n '^#' $S/epic.md
gh issue view <epic> --comments > $S/comments.md
for n in <children>; do gh issue view $n --json number,title,state,labels,assignees,body > $S/i$n.json; done
```

Take the epic's decisions. From each child, take its state, assignee, acceptance criteria and blockers. Check each blocker outside the epic: an open one nobody is working on puts its dependants outside this run. Say so in the plan.

### 2. Find the files the work shares

A stream groups issues by file, because two agents editing one file conflict.

- List the source and test files each piece of the epic changes. Use `grep -n` for the functions and types, and line numbers where a large file holds more than one area. `src/data/engine.ts`, `src/ui/RosterView.tsx` and `src/ui/UnitEditor.tsx` are the likely ones.
- Mark each file more than one piece changes.

### 3. Draft the missing tasks

Draft a task for each piece of the epic no child covers. Skip this step when the children cover the epic. Split the work so that as many tasks as possible can start at once.

| Rule | Because |
| --- | --- |
| A task is one agent's delegation, with one concern | A long agent run pays for its whole context on each turn |
| A task delivers behaviour a test can assert. One that doesn't says so | Tests come first (`.claude/contracts/delegation.md` §3) |
| Two tasks that change one file don't run at the same time. One blocks the other | Two agents editing one file conflict |
| A shared surface gets its own task, which blocks each task that uses it: a type, a helper in `src/data`, a store function | No consumer task owns it, so none builds it |
| A change to a stored format is one task, with its migration and a test using the old shape | Saved lists outlive any release |
| Logic and its screen are separate tasks where they share no file | The logic can be tested alone |
| A task that waits for a person is a decision issue, titled `area: decide …` | An agent can't settle it |

Prefer a thin slice through each layer it needs over a slice of one layer.

### 4. Make the streams

**One stream owns each shared file, or one region of it.** The user gives the maximum number of streams. Use fewer when the issues don't fill them.

- Put the issues that change a file in the stream that owns it.
- Put each stored format change in one stream.
- Order each stream by its blockers, with the critical path first.
- Leave out an issue that waits for work outside the run.

### 5. Show the plan, ask the decisions, then stop

Give the plan as tables:

| Table | Columns |
| --- | --- |
| New tasks, if any | Title, files, blocked by |
| Streams | Worktree name, what it owns, its issues in order |
| Merge points | The issue, its worktree, and what must land before it starts |
| Conflict risks | The shared file or surface, and what keeps the conflict small |

State the critical path as one line of tasks.

Use `AskUserQuestion`. Ask only what changes the order of work:

- Whether the new tasks' sizes and blockers are right.
- A blocker link that holds a stream idle and the tables don't need.
- A blocker in progress outside the run: who lands it.
- Each open choice in a child: an "X, or Y", or a criterion that names no rule. Ask them all now and put each answer in the delegation prompt. An agent that stops on a choice the issue already showed costs a round trip.

State the plan again with the answers applied. Name the first issue of each stream. Then stop.

## Part 2: Run

### 6. File the new tasks

Skip this step when step 3 drafted none.

Read `.claude/contracts/writing.md` and check each title and body before you post. File the tasks in blocker order, so each "Blocked by" names a real issue number.

- **Title:** `area: what changes`, with a verb after the area. Under 72 characters.
- **Body:**

```markdown
## Parent

#<epic>. Read its decisions.

## What to build

<The behaviour, in a few sentences. Name the modules and types.>

## Acceptance criteria

- [ ] <One behaviour a test can assert.>

## Blocked by

#<n>, which <what it builds>. Or: Nothing.
```

Add each task to the epic as a sub-issue:

```bash
id=$(gh api repos/{owner}/{repo}/issues/<task> --jq .id)
gh api -X POST repos/{owner}/{repo}/issues/<epic>/sub_issues -F sub_issue_id=$id
```

Make each "Blocked by" issue a GitHub dependency, after you file the task. The API takes the blocker's `id`, not its number, with one call per blocker:

```bash
blocker=$(gh api repos/{owner}/{repo}/issues/<blocker> --jq .id)
gh api -X POST repos/{owner}/{repo}/issues/<task>/dependencies/blocked_by -F issue_id=$blocker
```

### 7. Set up, once

Do `implement-issue` steps 2b, 2c and 5 for the first issue of each stream. Then sync and cut the streams:

```bash
git fetch origin
git rebase origin/main
git rev-parse --short HEAD                     # the base SHA
mise run format-check && mise run lint && mise run test && mise run typecheck    # the baseline
for w in <stream names>; do
  git worktree add -q -b <w> .claude/worktrees/<w> main
  (cd .claude/worktrees/<w> && mise trust -q && mise run install)
done
```

Claim only the issue a stream is about to start. Claim the next one when it starts.

### 8. Delegate one issue for each stream

Start the first agent of each stream in one `Agent` block, with no `isolation`. The prompt holds what `implement-issue` step 6a lists, plus:

- **The worktree first:** its absolute path and branch. The agent's shell possibly starts in the main checkout, so tell it to `cd` to the worktree in each command and never to write in the main checkout.
- **The base check:** `git rev-parse --show-toplevel`, `git merge --ff-only <SHA>`, `git merge-base --is-ancestor <SHA> HEAD`, and a `grep` for one function the issue edits.
- **The sibling worktrees by name**, with the ban on `git stash`.
- **The region the stream owns** in a shared file, and the region a sibling edits.
- **The scope limits:** what a later issue of the stream builds, so the agent doesn't build it now.

### 9. Land each issue as its agent reports

Do `implement-issue` steps 6b to 6e, in the order they finish, then its documentation pass for that issue. Then:

1. Read the merge points table. If the stream's next issue needs work that hasn't landed, the stream waits. Start the next issue of another stream the landing unblocked.
2. Claim the next issue and start a new agent in the same worktree, after `git -C "$WT" rebase main`. Its prompt names the new SHA and what the stream's earlier issues left behind.

When a landing changes something a running agent's brief names, send the correction with `SendMessage` at once.

Tick a criterion and fast-forward only when the last run of the rebased branch passed. Don't chain them after a pipe: a pipe through `grep` can return success when the tests never ran.

### 10. Finish

When every stream has ended, run `implement-issue` step 8's checks once on `main`. Land nothing while they run. A failure belongs to the landings since the last green SHA: find the one that caused it. Then post each child's completion comment.

Tell the user, and leave the worktrees and branches in place until `review-ok`. Don't push.

## What differs from implement-issue

| implement-issue | This skill |
| --- | --- |
| `isolation: "worktree"` on each `Agent` call | No `isolation`. The prompt names the stream's worktree |
| A worktree lives for one criterion | A worktree lives for the stream |
| The blocker check stops the run | A blocker makes the stream wait, unless the user waived it in step 5 |
| Checks and the completion comment per issue | Checks once, after every stream ends; then the completion comments |
| `review-ok` deletes the issue's worktree | The worktree holds later issues, so delete it after the stream's last issue |

These rules don't change: one fresh agent per delegation, the test-first check on each `test:` commit, the writing check before each landing, `DECISION NEEDED` goes to the user, never poll a running agent, and push only through `review-ok`.
