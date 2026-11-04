---
name: codereview
description: 'Review one change in Muster with every review check in `.claude/skills/review-*`. Reviews uncommitted working-tree changes by default; `staged` reviews only what is in the index; a commit, tag or date reviews that range. The spec is the issue the change builds, read with the gh CLI, comments included. Runs each check in its own sub-agent, in parallel, and reports one section per check. Use when the user wants to review work in progress, staged changes before committing, unpushed commits, or asks to "review since X".'
---

Run each review check against one change. A check is a skill, `.claude/skills/review-<check>/SKILL.md`.

## Process

### 1. Pin the change and make the input file

Do what `.claude/skills/review-target.md` says, once, here: pin the change, then make `issues.md`. Each sub-agent gets the result, so none repeats it. If you find no spec, skip the `spec` check and say so.

### 2. Pick the checks

List the checks: each directory `.claude/skills/review-*` except `review-ok`. Skip a check when the change touches none of its paths:

| Check | Run it when the change touches |
| --- | --- |
| `ts-smells` | a `.ts` or `.tsx` file |
| `stored-data` | `src/data/engine.ts`, `src/data/catalog.ts`, `src/data/db.ts`, `src/store.ts`, `src/ui/snapshot.ts`, `src/ui/exporter.ts` |
| `security` | `src/`, `index.html`, `vite.config.ts`, `package.json` or `.github/workflows/` |
| `duplication` | a `.ts` or `.tsx` file |
| each other check | anything |

Name each skipped check in the report.

### 3. Start the sub-agents

Send all the `Agent` calls in one message, so the checks run in parallel. Start one sub-agent for each check, and two for each of `tests` and `spec`, combining their findings: those checks judge meaning, and two readers find more than one. Each prompt holds:

- The path of the check's `SKILL.md`, with: *"Do the check from its first `# ` heading. Ignore the text above it: this prompt pins the change."*
- The target: *"In the check, `BASE..HEAD` means this change."* Then the mode, its diff command, and the commit list if there is one. Give the untracked-file list in working-tree mode, and the partially-staged list in staged mode.
- `issues.md`, for the checks that read it.
- The `## Settled` section of `issues.md`, with: *"Do not report a settled decision."*
- A scratch folder of its own, such as `<scratchpad>/<check>-<n>/`, with: *"Write and run scripts only there. Use no shell redirection on a repo path."* Two sub-agents sharing a folder overwrite each other's scripts.
- *"Change no file. Return the check's `body`: the findings in the form its last paragraph gives, or one sentence that says what you checked."*

### 4. Report

Give one `## <check title>` section for each check that found something, with its `body` as the sub-agent wrote it. Don't merge or rerank findings across checks. Where two sub-agents ran one check, give each finding once. Then list the checks that found nothing and the checks you skipped.

End with one line: the number of findings for each check that found something.

### 5. Fix and review again, when the user asks

When the user asks you to fix the findings, or to loop until none is left:

1. Give every finding of the round to one fix agent, in a worktree of its own, following `.claude/contracts/delegation.md`. Name the findings and the settled decisions in its brief.
2. **The fix agent reviews its own diff before it reports**, doing each check that found something on its own commits. A fix that makes a new finding is the main reason a loop takes another round.
3. Land the fix as `implement-issue` step 6e does, after its step 6d checks pass, and review the whole range again. Add each answer the user gives during the loop to `## Settled`.
