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
mise run typecheck                         # type-check src/
mise run build                             # type-check and build into dist/
mise run preview                           # build, then serve dist/
mise run sweep <data-dir> ["<army name filter>"]   # add every unit of every army; list crashes and errors
mise run clean                             # remove dist/ and node_modules/
mise exec -- npx tsx scripts/test-engine.ts <data-dir> "<catalogue name>" "<unit>" ...   # engine smoke test
mise exec -- npx tsx scripts/compare.ts <data-dir> <old src dir> <new src dir>           # default points per unit, old engine vs new
```
Set `V=1` before `mise run sweep` to print each problem unit.

Deploys to GitHub Pages on every push to `main` (enable Pages → Source: GitHub Actions in repo settings).

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
Every unit of every army has been added and checked (`npm run sweep`) in: Blackjack-AoD/NRData, Blackjack-AoD/M40GA, BSData/horus-heresy-2nd-edition and BSData/wh40k-10e.

## Not yet covered
- **Child forces** (forces inside forces, e.g. Age of Sigmar 4's regiments inside an army). AoS data loads, but lists can't be built properly yet.
- Some rare BattleScribe features aren't implemented: per-link `shared="false"` counting, force-count limits on the roster (`forces` constraints), and `self`-scoped constraints.
