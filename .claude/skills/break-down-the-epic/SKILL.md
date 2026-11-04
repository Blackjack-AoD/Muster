---
name: break-down-the-epic
description: Break a Muster epic into small child issues that agents can build at the same time. Split the work so that tasks share no file, put each shared surface in a task of its own, and file each task as a sub-issue with its acceptance criteria and blockers. Use when the user says "break down the epic", "split epic N into tasks", "file the child issues", or after write-the-epic. The next step is implement-epic.
---

# Break down the epic

Takes an epic number. Files the tasks that `implement-epic` runs. A task is small, has one concern, and shares no file with a task that can run at the same time.

## 1. Read the epic

```bash
gh issue view <epic> > $S/epic.md && grep -n '^#' $S/epic.md
gh issue view <epic> --comments > $S/comments.md
```

`$S` is your scratchpad. Take the decisions. If the epic has sub-issues already, list them and break down only what they don't cover.

## 2. List the files of the work

For each piece of the epic, find the files it changes, tests included. Use `grep -n` for the functions and types. Note each file more than one piece changes, and the line range where a large file holds more than one area. `src/data/engine.ts`, `src/ui/RosterView.tsx` and `src/ui/UnitEditor.tsx` are the likely ones.

## 3. Draft the tasks

Split the work so that as many tasks as possible can start at once.

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

## 4. Show the breakdown

Give the user one table:

| # | Title | Files | Blocked by |
| --- | --- | --- | --- |

Below it, give the tasks that can start at once, and the critical path as one line of task numbers. Ask with `AskUserQuestion` whether the task sizes and blockers are right. Change the breakdown until the user approves it.

## 5. File the tasks

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

## 6. Report

Give each task's number and title, the tasks that can start at once, and the critical path. The next step is `/implement-epic <epic>`, or `/implement-issue <n>` for a single task.
