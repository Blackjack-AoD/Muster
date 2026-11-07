# Muster

An installable, offline-first army list builder for BattleScribe / New Recruit data (`.gst` / `.cat`).

- Downloads data straight from public GitHub repos (defaults: `Blackjack-AoD/NRData`, `Blackjack-AoD/M40GA`) and keeps it on the phone. Only changed files are re-downloaded.
- Works with no internet once synced: browse units, profiles and rules, and build lists.
- List building: points, model counts, wargear options, force-org slots and min/max limits, with the data's conditions and modifiers applied.
- Lists and saved units are stored on the device, never in the data files. Share a list as text, or back up and restore lists and saved units as JSON.

## Install on a phone
Open the site, then **Add to Home screen** / **Install app** in the browser menu (Safari: Share → Add to Home Screen).

## Develop
Tools and tasks are managed by [mise](https://mise.jdx.dev), which installs the Node version set in `mise.toml`. Tasks install npm dependencies when needed. Run `mise trust` once after cloning, then `mise install`.
```
mise tasks                                 # list every task
mise run dev                               # dev server, open on the network
mise run test                              # unit tests
mise run coverage                          # unit tests with a coverage report
mise run format                            # format the code with Prettier
mise run format-check                      # check formatting without changing anything
mise run lint                              # type-aware lint with oxlint
mise run typecheck                         # type-check src/ and the tests
mise run build                             # type-check and build into dist/
mise run preview                           # build, then serve dist/
mise run e2e                               # build the site and run the Playwright journeys at phone size
mise run sweep <data-dir> ["<army name filter>"]   # look for unit test cases in real data
mise run clean                             # remove dist/ and node_modules/
mise exec -- npx tsx scripts/test-engine.ts <data-dir> "<catalogue name>" "<unit>" ...   # engine smoke test
mise exec -- npx tsx scripts/compare.ts <data-dir> <old src dir> <new src dir>           # default points per unit, old engine vs new
```

## Testing
Unit tests sit next to the code as `*.test.ts`. They're written as BattleScribe XML (see `src/test/fixture.ts`), run through the real parser, so a test reads like the data it stands for. A deploy stops if they fail. They cover the data layer, storage, backups, share links, `src/update.ts` and the share and download helpers.

Screen tests cover each screen's main journey and the app shell. A screen test is a `*.test.tsx` file that calls `renderScreen` from `src/test/screen.ts`. It renders on the real store with seeded data and lists, and resets the store after each test. A test that needs a browser, as every screen test does, starts with `// @vitest-environment jsdom`. Every other test runs in node.

The Playwright journeys in `e2e/` download data and build a list, reopen a list offline, and open a share link. Run them with `mise run e2e`. They use a small fixture repo with a faked GitHub, and run at phone size against the built site. They don't run in the deploy, so run them by hand before pushing a change to the app shell, the service worker or the build.

`it.fails` marks a known bug: the test states the right behaviour and passes while the bug exists. Fixing the bug turns it red, and it then becomes a normal `it`.

The sweep finds new cases and never fails a build. It adds every unit of every army in a data folder to a 2,000-point list with its set-up in place, skipping hidden force entries and any entry the set-up already added, then prints the problems it hit with the smallest example of each, and the shapes of condition, repeat, constraint and modifier in that data that no unit test mentions. A problem marked `SET-UP` comes from the set-up alone and counts once per army. Turn what it finds into small unit tests.

Deploys to GitHub Pages on every push to `main` (enable Pages → Source: GitHub Actions in repo settings).

## How we work
Work is trunk-based: it lands on `main`, with no feature branches or pull requests. **Pushing `main` deploys to players**, and the deploy stops if the format check, lint or tests fail. Run those locally first, because a failed deploy still leaves the commit on `main`.

Planning and building run through [Claude Code](https://claude.com/claude-code), using the agent and skills in `.claude/`. You'll also need the `gh` CLI, signed in. Run a skill by typing its name, such as `/implement-this add a filter to the rules search`.

```
Planned work:   /write-the-epic  →  /implement-epic  →  /review-ok
Quick changes:  /implement-this  →  /review-ok
```

| Skill | What it does |
| --- | --- |
| `/write-the-epic` | Interviews you until each decision is settled, then files an epic as a GitHub issue. It records the decisions, and which screens and saved data change. |
| `/implement-epic <n>` | Splits an epic into small sub-issues where it needs them, plans parallel streams so agents don't edit the same files, and stops for your go-ahead. Then it files the issues and builds each one in a worktree, test first, reading each diff and landing the work on local `main`. It never pushes. Run it again on a finished epic to fix `BUG:` and `MISSING:` comments. |
| `/implement-this <change>` | Makes a change you describe, with no issue needed. It works test first in the main checkout, runs the checks and commits to local `main`. It never pushes. Name an issue instead to build a single one. |
| `/review-ok [n]` | Run this once you've approved the work. It pushes `main` and watches the deploy. Given an issue, it also closes it and cleans up worktrees. Nothing else pushes. |

`implement-issue` is the procedure `/implement-epic` follows for each sub-issue. It isn't a command you run.

**`senior-ts-dev`** is the agent that writes the code. `.claude/agents/senior-ts-dev.md` holds its TypeScript, testing and Muster rules, and it's a good summary of how code should look here even if you're writing it by hand.

Two contracts sit behind the skills:
- `.claude/contracts/delegation.md` binds any delegated work. Tests come first, with the failing test committed before the code. An agent stops and asks rather than making a decision no document settled.
- `.claude/contracts/writing.md` sets the rules for commit messages, issue titles and comments.

## Screens
- **Games**: pick the game you're playing. Lists, Library and new lists then only show that game (or pick "All games").
- **Lists**: build and edit lists. All squad sizes and wargear choices happen here.
- **Unit options**: each section of options on a unit page is a box showing what's chosen. Tapping it opens the options in a sheet, which closes on a pick-one choice unless that choice has options of its own. A box short of a required choice turns red and says **Not chosen**. On/Off switches and options outside a section stay on the page.
- **Library**: browse units and rules, and manage saved units. **Armies** shows each unit with two tabs: **Profiles** (stat line fitted to the screen width, standard weapons, wargear) and **Rules** (its special rules). **Rules** searches every rule in every data file of the chosen game, with differently worded copies of a rule grouped together and labelled by army. An army's page lists its unique units first, each with rename and delete, then its preconfigured units, each with delete.
- **List building**: a new list (or detachment) starts with its mandatory set-up already in place. For Horus Heresy that's the Legion (hidden, since there's nothing to choose), Allegiance set to the Legion's side in the lore (tap Loyalist / Traitor to change it), Rite of War, and Expanded Army Lists with every switch On. Swipe a unit left to delete it (with Undo), or right to duplicate it. A unit's warnings show on its row and its page. A detachment type or unit gone from the data shows as a warning in the list check.
- **Names and saved units**: the pencil on a unit page names the unit, or a model that can differ from the rest of the squad: a sergeant, a special weapon model, or a model split off the squad's main group. The tick beside the name saves it; closing the sheet keeps the old name. Naming a model in a group splits it off as its own row. **Save updates** keeps the unit's build for its army file: a named unit as a **unique unit**, which a list holds at most once, and an unnamed one as a **preconfigured unit**, which a list holds any number of times. Edits to a copy stay in its list until Save updates, which takes them to the saved unit and every copy in every list, over any changes of their own. Adding a saved unit rebuilds it against today's data and leaves out any option the data no longer has, with a toast saying how many. Deleting a saved unit turns its copies into normal units without the name.
- **Adding saved units**: each category's add sheet has 2 tabs, the category and **Preconfigured**. The category tab lists the data's units under the category's unique units. Preconfigured lists the category's preconfigured and unique units, with their wargear and how many copies the list holds. Swipe right to add one. Swipe left to take the last copy out of the list, with Undo, or, when the list holds none, to delete the saved unit after asking. The **Preconfigured** button beside the points switches the list to every saved unit of its armies, where swipes work the same way, and **Force organisation** switches back. There a unit goes into the only detachment with room, or the one you pick, and one with no room shows greyed out. On that page and in each Preconfigured tab, the search also finds plain units of the data: tap one to set it up on a page of its own, outside the list, and **Save updates** keeps it as a preconfigured unit, or a unique one if you named it.
- **Detachments**: a list with more than 1 detachment shows a delete button in each one's header, which asks first.
- **Failed saves**: an edit that doesn't save shows a toast with **Retry**. The toast doesn't time out. A new or duplicated list that fails to save shows the reason and isn't kept. While the Retry toast shows, it stays up in place of Restore's count and a failed Duplicate list's reason.
- **A list that can't open**: when its data or army isn't on the phone, the list shows the reason and offers **Delete list**.
- The phone's back button steps back one screen at a time and closes any open pop-up first.
- **Army sheet** (list menu → Army sheet): every unit with points, wargear, stats and rules, plus a rules reference. **Print / save PDF** uses the phone's print dialog (choose "Save as PDF"). **Share link** sends a link (WhatsApp etc.) that opens a read-only copy of the list in any browser, no Muster data needed. Very long lists leave the rules reference out of the link to keep it short. A link that unpacks past 5 MB, holds more than 2,000 units, or holds more than 10,000 gear lines on one unit doesn't open.
- **Updates**: the app checks for a new version once a week (when opened with a connection) and restarts into it. While a list has an edit that hasn't saved, it holds off: the weekly check waits, and a new version restarts the app once the edit saves, or on the next open. Data tab → App → **Check for updates** does it on demand; **Reload a fresh copy** fixes a stuck update and keeps lists and data as stored. With an unsaved edit, both ask first: Check for updates says the update waits until the edit saves, and **Reload a fresh copy** says the reload loses the edit.
- **Data**: download / update repos, import files, back up lists and saved units. A failed download shows its reason on the repo's card and in a toast. **Restore** says how many lists and saved units it restored and how many it skipped, and keeps any edit that hasn't saved. It stores only the fields a list or saved unit has, so anything else in the backup file is dropped. A restored copy whose saved unit is neither in the file nor on the phone becomes a normal unit without the name. Older backups, which hold only lists, still restore.

## How the data is read
- Data files can sit in subfolders and can be zipped (`.gstz` / `.catz`). The Data tab can also import a whole repo `.zip` (GitHub's Download ZIP).
- A model group ("5× Veteran") shares its wargear, and that wargear counts once per model for points and limits. **Split 1** separates a model to give it different gear; **Merge** puts it back when its gear matches again, and **Undo split** puts it back with the main group's gear. A named model is always a row of 1 and never merges.
- Mandatory picks are filled in one at a time and re-checked, because limits often change once a default is taken. Without a usable default, the cheapest option (after modifiers) is picked.
- Options follow the data's `sortIndex` where it's set. Without one, options numbered in their names, like `2) Melee Options`, go in number order among the places they hold, and the rest stay in file order.
- Rule and profile links honour their own hidden flags and modifiers (e.g. Legion-specific rules, "Duellist's Edge (1)").
- Percentage limits (e.g. "no more than 25% of the army's points") are checked against the current total.
- A rule on the points in the whole list, such as one Lord of War point per 4 points or one Master of the Legion per 1,000 points, counts the list's points limit. A list with no limit counts its current total.
- A pick-one group that holds a group of its own, such as a bolter or one of the squad's special weapons, offers everything inside it as one choice.

## Tested data
The sweep adds every unit the app offers in every army, with its set-up in place, without a crash in: Blackjack-AoD/NRData, Blackjack-AoD/M40GA, BSData/horus-heresy-2nd-edition and BSData/wh40k-10e. That shows the app copes with the data, not that its points are right; that's what the unit tests are for.

## Not yet covered
- **Child forces** (forces inside forces, e.g. Age of Sigmar 4's regiments inside an army). AoS data loads, but lists can't be built properly yet.
- Muster doesn't implement some BattleScribe features: per-link `shared="false"` counting, force-count limits on the roster (`forces` constraints), `self`-scoped constraints, a min scoped to an entry id, and the `add` modifiers on `error`, `warning` and `info` that show a player a message.
- Muster doesn't implement New Recruit's extensions: modifiers that reach other entries (`affects`, used by 10th edition wargear that changes stats), the `replace`, `floor` and `ceil` modifier types, and scopes such as `root-entry` and `model`.
