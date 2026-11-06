---
name: implement-this
description: Make a change to Muster straight from a prompt, with no GitHub issue. Work in the main checkout, test first, run the checks and commit to local main. Use when the user says "implement this", runs /implement-this with a description, or asks for a small change or bug fix without filing an issue.
---

# Implement this

Takes a description of a change. Builds it on local `main` and commits it, with no worktree or subagent unless the user asks for one. Nothing needs an issue, but if the prompt names one, read it with `gh issue view <n>` as the description, and `/review-ok <n>` closes it.

**Pushing `main` deploys to players, so this skill never pushes.** `/review-ok` does, when the user asks.

## 1. Sync

```bash
git status --short
git fetch origin
git rebase origin/main
```

If uncommitted work is in the way, don't stash or discard it: ask.

## 2. Check the change

Read the code the change touches. Stop and ask with `AskUserQuestion` if:

- The prompt leaves a choice open that changes what gets built.
- The change touches a stored format: `Roster`, `Force`, `Sel`, `Opt.key`, `Snapshot` or the backup file. Lists on phones, in backups and in share links outlive any release, so agree the migration first. A stored format change needs a test using the old shape.
- It depends on what a BattleScribe or New Recruit feature means. Look at real data first, as `write-the-epic` step 2 says.
- It's too big for one sitting. Suggest `/write-the-epic`.

## 3. Build it, test first

Follow the coding rules in `.claude/agents/senior-ts-dev.md`.

1. Write the test and run it: `mise exec -- npx vitest run <file>`. A bug fix starts with a test that reproduces the bug.
2. See it fail on its assertion, not on a missing function.
3. Write the least code that passes.

A change with nothing to assert, such as docs, tooling or a style tweak, needs no test.

## 4. Check it

```bash
mise run format
mise run format-check && mise run lint && mise run typecheck && mise run test && mise run build
```

If the change touches `src/ui`, run it with `mise run dev` and look at it, or say plainly that you didn't.

If the change made `README.md` wrong, correct it.

## 5. Commit

Run the check in `.claude/contracts/writing.md`, then commit to `main`, with tests and code together. Stage paths by name.

## 6. Report

Say what changed, in a line or two, and name any choice you made. The next step is `/review-ok`, which pushes and confirms the deploy.
