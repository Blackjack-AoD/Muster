# Muster

An installable, offline-first army list builder for BattleScribe / New Recruit data (`.gst` / `.cat`).

- Downloads data straight from public GitHub repos (defaults: `Blackjack-AoD/NRData`, `Blackjack-AoD/M40GA`) and keeps it on the phone. Only changed files are re-downloaded.
- Works with no internet once synced: browse units, profiles and rules, and build lists.
- List building: points, model counts, wargear options, force-org slots and min/max limits, with the data's conditions and modifiers applied.
- Lists are stored on the device. Share as text, or back up and restore as JSON.

## Install on a phone
Open the site, then **Add to Home screen** / **Install app** in the browser menu (Safari: Share → Add to Home Screen).

## Develop
Tools and tasks are managed by [mise](https://mise.jdx.dev), which installs the Node version set in `mise.toml`. Tasks install npm dependencies when needed. Run `mise trust` once after cloning, then `mise install`.
```
mise tasks                                 # list every task
mise run dev                               # local dev server
mise run test                              # unit tests
mise run coverage                          # unit tests with a coverage report
mise run format                            # format the code with Prettier
mise run format-check                      # check formatting without changing anything
mise run lint                              # type-aware lint with oxlint
mise run typecheck                         # type-check src/ and the tests
mise run build                             # type-check and build into dist/
mise run preview                           # build, then serve dist/
mise run sweep <data-dir> ["<army name filter>"]   # look for unit test cases in real data
mise run clean                             # remove dist/ and node_modules/
mise exec -- npx tsx scripts/test-engine.ts <data-dir> "<catalogue name>" "<unit>" ...   # engine smoke test
mise exec -- npx tsx scripts/compare.ts <data-dir> <old src dir> <new src dir>           # default points per unit, old engine vs new
```

## Testing
Unit tests sit next to the code as `*.test.ts`. They're written as BattleScribe XML (see `src/test/fixture.ts`), run through the real parser, so a test reads like the data it stands for. A deploy stops if they fail. They cover the data layer, storage, backups and share links; the UI screens and `src/update.ts` aren't covered yet.

A screen test is a `*.test.tsx` file that starts with `// @vitest-environment jsdom` and calls `renderScreen` from `src/test/screen.ts`. It renders on the real store with seeded data and lists, and resets the store after each test. Every other test runs in node.

`it.fails` marks a known bug: the test states the right behaviour and passes while the bug exists. Fixing the bug turns it red, and it then becomes a normal `it`.

The sweep finds new cases and never fails a build. It adds every unit of every army in a data folder to a 2,000-point list with its set-up in place, then prints the problems it hit with the smallest example of each, and the shapes of condition, repeat, constraint and modifier in that data that no unit test mentions. A problem marked `SET-UP` comes from the set-up alone and counts once per army. Turn what it finds into small unit tests.

Deploys to GitHub Pages on every push to `main` (enable Pages → Source: GitHub Actions in repo settings).

## How we work
Work is trunk-based: it lands on `main`, with no feature branches or pull requests. **Pushing `main` deploys to players**, and the deploy stops if the format check, lint or tests fail. Run those locally first, because a failed deploy still leaves the commit on `main`.

Planning and building run through [Claude Code](https://claude.com/claude-code), using the agent and skills in `.claude/`. You'll also need the `gh` CLI, signed in. Run a skill by typing its name, such as `/implement-issue 12`.

```
/write-the-epic  →  /break-down-the-epic  →  /implement-epic or /implement-issue  →  /codereview  →  /review-ok
```

| Skill | What it does |
| --- | --- |
| `/write-the-epic` | Interviews you until each decision is settled, then files an epic as a GitHub issue. It records the decisions, and which screens and saved data change. |
| `/break-down-the-epic <n>` | Splits an epic into small sub-issues with acceptance criteria and blockers, so agents can work at the same time without editing the same files. |
| `/implement-issue <n>` | Claims an issue and builds each acceptance criterion in its own worktree, test first. It reads each diff, lands the work on local `main`, corrects stale docs and comments on the issue. It never pushes. Run it again on a finished issue to fix `BUG:` and `MISSING:` comments. |
| `/implement-epic <n>` | Plans parallel streams of an epic's sub-issues and stops for your go-ahead, then runs each issue the way `/implement-issue` does. |
| `/codereview` | Reviews a change with every check below, each in its own sub-agent. It covers uncommitted work by default, or `staged`, a ref or a date. Ask it to fix what it finds if you want that too. |
| `/review-ok <n>` | Run this once you've approved the work. It pushes `main`, watches the deploy, closes the issue and cleans up worktrees. Nothing else pushes. |

The review checks can also be run alone:

| Check | What it reports |
| --- | --- |
| `/review-spec` | Work the issue asked for that wasn't built, and code nothing asked for |
| `/review-tests` | Tests that would still pass with the code broken |
| `/review-ts-smells` | Unsafe or unidiomatic TypeScript, and over-complex code |
| `/review-stored-data` | Changes that could break lists saved on phones, in backups or in share links |
| `/review-duplication` | Code the repo already has, and code left unreachable |
| `/review-security` | Ways a data file, share link or backup could harm a player |
| `/review-prose` | Commit messages, comments and docs that break the writing rules |

**`senior-ts-dev`** is the agent that writes the code. `.claude/agents/senior-ts-dev.md` holds its TypeScript, testing and Muster rules, and it's a good summary of how code should look here even if you're writing it by hand.

Two contracts sit behind the skills:
- `.claude/contracts/delegation.md` binds any delegated work. Tests come first, with the failing test committed before the code. An agent stops and asks rather than making a decision no document settled.
- `.claude/contracts/writing.md` sets the rules for commit messages, issue titles and comments.

## Screens
- **Games**: pick the game you're playing. Lists, Library and new lists then only show that game (or pick "All games").
- **Lists**: build and edit lists. All squad sizes and wargear choices happen here.
- **Library**: read-only. **Armies** shows each unit with two tabs: **Profiles** (stat line fitted to the screen width, standard weapons, wargear) and **Rules** (its special rules). **Rules** searches every rule in every data file of the chosen game, with differently worded copies of a rule grouped together and labelled by army.
- **List building**: a new list (or detachment) starts with its mandatory set-up already in place. For Horus Heresy that's the Legion (hidden, since there's nothing to choose), Allegiance set to the Legion's side in the lore (tap Loyalist / Traitor to change it), Rite of War, and Expanded Army Lists with every switch On. Swipe a unit left to delete it (with Undo), or right to duplicate it.
- The phone's back button steps back one screen at a time and closes any open pop-up first.
- **Army sheet** (list menu → Army sheet): every unit with points, wargear, stats and rules, plus a rules reference. **Print / save PDF** uses the phone's print dialog (choose "Save as PDF"). **Share link** sends a link (WhatsApp etc.) that opens a read-only copy of the list in any browser, no Muster data needed. Very long lists leave the rules reference out of the link to keep it short.
- **Updates**: the app checks for a new version once a week (when opened with a connection) and restarts into it. Data tab → App → **Check for updates** does it on demand; **Reload a fresh copy** fixes a stuck update without touching lists or data.
- **Data**: download / update repos, import files, back up lists.

## How the data is read
- Data files can sit in subfolders and can be zipped (`.gstz` / `.catz`). The Data tab can also import a whole repo `.zip` (GitHub's Download ZIP).
- A model group ("5× Veteran") shares its wargear, and that wargear counts once per model for points and limits. **Split 1** separates a model to give it different gear; **Merge** puts it back when its gear matches again.
- Mandatory picks are filled in one at a time and re-checked, because limits often change once a default is taken. Without a usable default, the cheapest option (after modifiers) is picked.
- Options follow the data's `sortIndex` where it's set.
- Rule and profile links honour their own hidden flags and modifiers (e.g. Legion-specific rules, "Duellist's Edge (1)").
- Percentage limits (e.g. "no more than 25% of the army's points") are checked against the current total.

## Tested data
Every unit of every army has been added without a crash in: Blackjack-AoD/NRData, Blackjack-AoD/M40GA, BSData/horus-heresy-2nd-edition and BSData/wh40k-10e. That shows the app copes with the data, not that its points are right; that's what the unit tests are for.

## Not yet covered
- **Child forces** (forces inside forces, e.g. Age of Sigmar 4's regiments inside an army). AoS data loads, but lists can't be built properly yet.
- Some BattleScribe features aren't implemented: per-link `shared="false"` counting, force-count limits on the roster (`forces` constraints), and `self`-scoped constraints.
- New Recruit's extensions aren't implemented: modifiers that reach other entries (`affects`, used by 10th edition wargear that changes stats), the `replace`, `floor` and `ceil` modifier types, and scopes such as `root-entry` and `model`.
