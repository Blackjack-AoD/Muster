# Check your words before they leave

Run `mise run format` first. Do this before each commit and each `gh` command that posts text. A quick read doesn't find these: count, and search.

## How to write

Everyday words, active voice, present tense. Say what happened, not how hard it was. No marketing words, and no em dashes.

## The commit message

You can't correct a message after it lands, so keep it short. The body holds only what no other place holds:

- Why the change is being made, if the diff doesn't show it.
- What it deliberately doesn't do, and what was filed as an issue instead.

1. **Count the subject's characters.** 72 or more: shorten it.
2. The subject is `area: what changed`, in lower case. Areas: `engine`, `catalog`, `parser`, `setup`, `sync`, `store`, `ui`, `sweep`, `ci`, `docs`, `tooling`. A test commit is `test: what it pins`.
3. **Count the body's lines.** More than 15: it's an argument, so move it to the issue.
4. Delete from the body:

   | Delete | Looks like |
   | --- | --- |
   | A verification result | a test count, _passes_, _a review found nothing_ |
   | How the work went | _the next commit_, _this commit holds no red_ |
   | A count of items | _its two readers_, _the three checks_ |

5. Keep the attribution lines the session asks for.

## The prose a commit adds

Read `git diff --cached`. Look at each comment, test name and Markdown line it adds or changes.

- Search for a number word (_two_, _three_). A count of a collection goes stale, so remove it unless the number is the fact.
- A sentence you edit is yours, all of it, including a count that was already in it.
- Count comment lines against the limits in `.claude/contracts/delegation.md` §2.
- `src/` and `scripts/` cite no GitHub issue.

## Text posted with `gh`

An issue comment follows the same word rules. Evidence belongs here: a test count is right in a comment and wrong in a commit body.

An issue title says what the work builds, or what a bug fix corrects:

| Issue | Write | Not |
| --- | --- | --- |
| Feature | _engine: support the replace modifier_ | _engine: modifiers_ |
| Bug | _engine: fix lists that won't open without a force entry_ | _engine: force entry is broken_ |
| Refactor | _ui: move limit logic out of UnitEditor_ | _ui: UnitEditor is too long_ |
| Decision | _engine: decide how to treat floor and ceil_ | _floor and ceil_ |

1. It's `area: what changes`, with a verb after the area: _add_, _fix_, _use_, _remove_, _decide_.
2. A bug title starts with _fix_.
3. It names what's done when the issue closes, not only the problem.
4. **Count its characters.** 72 or more: shorten it.

## Commits someone else wrote

Before landing an agent's commits, run this check on them: count each subject, read each body in full, and read each added prose line. A breach goes back to the agent before it lands.
