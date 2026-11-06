---
name: write-the-epic
description: Write a Muster epic as a GitHub issue. Interview the user until each decision is settled, check each decision against the code and real BattleScribe data, name the screens and stored formats that change, and file the epic in the repo's format (Goal, Decisions, Screens, Stored data, Child issues). Use when the user wants to plan a feature, write an epic, write a PRD or a spec, or says "write the epic". The next step is implement-epic.
---

# Write the epic

An epic says what to build and records each decision. It doesn't list tasks: `implement-epic` does that. It holds no user stories and no file paths.

This repo has no `adr/` folder, so the epic is where a decision is recorded.

## 1. Get the problem

Ask the user to describe the problem and any ideas for the solution, unless the request already does. Ask once, in full sentences. Don't start with a list of questions.

## 2. Read the repo

Check each claim the user made against the code. Read only what the epic needs.

- `README.md`: what Muster is, and "Not yet covered".
- Open and closed issues on the same nouns: `gh issue list --state all --search '<noun>'`. Save a long issue to the scratchpad and read its headings first.
- The code the change touches.

**Where the epic depends on what a BattleScribe or New Recruit feature means, look at real data.** Shallow-clone the repos named in the README into the scratchpad, and count and read how the feature is used. `mise run sweep <data-dir>` also shows which shapes the data uses. Don't settle the meaning from memory.

## 3. Interview until each decision is settled

Walk the decision tree one branch at a time. Settle a decision before the decisions that depend on it. Use `AskUserQuestion`, with your recommendation first, and up to four questions at a time.

- Ask only what changes what gets built. Don't ask what the code or an earlier issue already answers. Name the source instead.
- Stop when you can state each decision as one line a developer can act on.

## 4. Name what the change reaches

**Screens:** list each screen the epic adds or changes. An epic that changes none says so.

**Stored data:** say whether the epic changes `Roster`, `Force`, `Sel`, `Opt.key`, `Snapshot` or the backup file. Lists on phones, in backups and in share links outlive any release. If it does, record how old data keeps working as a decision.

## 5. File the epic

Read `.claude/contracts/writing.md` and check the title and the body before you post.

- **Title:** `area: what changes`, with a verb after the area. Under 72 characters.
- **Label:** `epic`. Create it once with `gh label create epic` if it doesn't exist.
- **Body:**

```markdown
## Goal

<What is true when the epic is done, and why it matters to a player.>

## Decisions (<YYYY-MM-DD>)

- **<The decision.>** <One or two sentences: what it means for the build.>

## Screens

<Each screen that changes, or "None".>

## Stored data

<What changes and how old lists keep working, or "No change".>

## Child issues

Filed as sub-issues of this epic.
```

```bash
gh issue create --title "<title>" --label epic --body-file <scratchpad file>
```

## 6. Report

Give the epic's link and its decisions in one line each. The next step is `/implement-epic <n>`.
