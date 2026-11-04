# Delegation contract

Binding on any delegated implementation work in this repo. A delegation prompt names this file, and you read it in full before your first edit. `.claude/agents/senior-ts-dev.md` holds the coding rules. This file holds the escalation rules, the test-first sequence, and what your report contains.

*Criterion* means the unit of work you were handed: an acceptance criterion, a bug fix, a task.

## 1. Escalation

Build the smallest thing that satisfies the criterion. Generality comes from several real cases, never from one.

If you hit a decision that the issue, its epic, the README or the agent file does not settle, **do not decide it.** Stop, leave the worktree as it is, and end your report with this block:

```
DECISION NEEDED
Question: <one sentence>
Context: <why the documents do not settle it>
Options:
  A. <option> - <cost>
  B. <option> - <cost>
Recommendation: <A or B, and why in one sentence>
Blocked: <what you cannot finish until this is answered>
```

You may return several. Returning one is a successful outcome: a wrong decision made silently costs far more than a question. Do not build one option "for now" and mention it in passing.

**Narrating a decision is not escalating it.** If you write *"worth a reviewer's eye"*, *"flagging this"*, *"the spec doesn't say, so I chose"* or *"I went with X but Y is defensible"*, you have found a `DECISION NEEDED` block and written it in the wrong shape. Undo that part and return the block.

The test isn't "can I justify this?", because you can justify almost anything. The test is "did a document decide this, or did I?"

**These are decisions too:**
- A constant nobody wrote down: a default, a threshold, a timeout, a limit, an ordering. Reusing one this repo already has is fine: say where it comes from.
- Choosing between two of the repo's own precedents that point different ways. The tell is *"X does it this way, but that doesn't apply here because…"*.
- What a BattleScribe or New Recruit feature means, when the data doesn't settle it. Look at how real data uses it. If it's still open, escalate. Don't invent semantics to make a test pass.
- A place for code when the rule's place can't take it, such as `src/data` needing something from `src/ui`.

**Escalate rather than decide when you're about to:** add an abstraction with one caller; add a module or dependency nothing named; change a stored format (`Roster`, `Force`, `Sel`, `Opt.key`, `Snapshot`, the backup file); deviate from the issue, or find it silent or wrong; narrow what the criterion means in order to satisfy it; or fix something outside the criterion because you were passing through.

## 2. Comments

A comment says why the code is the way it is, when the code can't. It doesn't argue for a decision: that's a `DECISION NEEDED` block.

Limits on what you write or edit: 5 lines of doc comment on a function, 3 consecutive `//` lines. `src/` cites no GitHub issue, because issues close and change. A decision is recorded by the test that pins it, and the completion comment gives it in one line.

Existing files can stay as they are. Trim what you're already editing and start no sweep.

Read `.claude/contracts/writing.md` before your first commit.

## 3. Test first

**Before you write any code, list every test this criterion needs, and put the list in your report.** Name each one and what it pins. This pause is the mechanism. The usual failure looks like diligence: the core behaviour gets a real red, then the other tests get written after the code, because by then the code exists. Listing them first means you can still write all of them first.

If the list grows while you work, add the test to the list and write it before the code it covers. Mark it a late addition. A test in the tree that wasn't on the list is the tell.

**The first file you create or edit must be a test file.** A list someone handed you doesn't count: restate it as your own first.

Then, for each behaviour:

1. Write the test and run it: `mise exec -- npx vitest run <file>`.
2. Make it fail for the right reason. `x is not a function`, or a suite that won't load, only proves the code doesn't exist yet. Add a stub with no behaviour until the test fails on its assertion, with a message you'd want to see if someone broke this in a year.
3. Write the least code that passes.
4. Refactor only from green.

**A known bug already has its red.** Where a test is marked `it.fails`, your test commit changes it to `it`.

**Never break working code to watch a test fail.** If you find yourself commenting out a function or inverting a condition to prove a test is real, the test was written in the wrong order. Write the next test first. Reconstructing a red costs more and proves less than one real red.

**Commit the red.** You work in a worktree of your own, so your commits reach nobody until they're reviewed. Make two per criterion, in this order:

1. `test: <what it pins>`: the tests, plus only the stubs they need to fail on assertions. No behaviour.
2. The implementation.

More than one `test:` commit is fine where you drove behaviours in turn. Write the stub, commit the pair, then implement. Where the stub and the code share a file, you'd otherwise commit both together.

**Check out each `test:` commit and run it before you report. It isn't the red until it runs.**

```bash
git add -A && git commit -q -m wip      # if anything is uncommitted
git checkout <test-sha>
mise exec -- npx vitest run <file>
git checkout -                          # then `git reset --soft HEAD~1` to undo the wip
```

Read the summary and the failure messages. The summary must show a failure for each test the commit adds, and no failed suites. `Failed Suites` means a file didn't load, so none of your reds exist at that commit. A test that passes here pins nothing: sharpen it, or name it as a mutation check.

**The summary alone doesn't prove a red.** Vitest counts `TypeError: x is not a function` as a failed test, the same as an assertion. Each failure must be an `AssertionError`, unless the error is itself the bug being fixed, such as a crash. Both slips usually mean a stub went in with the code, not the tests.

**Never run `git stash`, in any form.** `refs/stash` is one stack across every worktree, so another agent's `pop` takes your work. Use the `wip` commit above.

**One exemption, with two conditions.** A criterion can ask you to prove that code elsewhere behaves a certain way when reached through your path. There's nothing to write, so no red exists. It's exempt only if the test exercises a file your diff doesn't touch, and you claimed it on your list before any code, as `no red available - <file>`. "The code is already correct" doesn't qualify.

Under both conditions, run a **mutation check**: first confirm the test passes, then change the expectation to what a broken version would produce, watch it fail, and revert. Report both results.

**Your finish line:** every test on your list green, `mise run format` run, and `mise run format-check`, `mise run lint`, `mise run test` and `mise run typecheck` pass in your worktree with no new lint warnings, your commits made, and your report written. Do not push.

## 4. Report

Your report is read beside the diff, not instead of it. Anything the diff shows is a second copy that can be wrong.

Before you report, review your own diff against `.claude/skills/review-tests/SKILL.md`, and any other check your brief names.

Include, in this order:

1. The test list you wrote before any code, marking late additions.
2. Your commit SHAs, test commit first. Against each `test:` commit, the Vitest summary line from its own run, and the first line of each failure. Or the mutation check, labelled as one.
3. What surprised you: a wrong document, a test that passed when you expected a red, a behaviour you had to work around. Nothing else can recover this.
4. Any `DECISION NEEDED` blocks, last.

Leave out the files you changed, a walkthrough, a restatement of the criterion, and any paragraph justifying a call you made. That last one is a `DECISION NEEDED` block in the wrong shape.
