# Muster

An installable, offline-first army list builder for BattleScribe / New Recruit data (`.gst` / `.cat`).

- Downloads data straight from public GitHub repos (defaults: `Blackjack-AoD/NRData`, `Blackjack-AoD/M40GA`) and keeps it on the phone. Only changed files are re-downloaded.
- Works with no internet once synced: browse units, profiles and rules, and build lists.
- List building: points, model counts, wargear options, force-org slots and min/max limits, with the data's conditions and modifiers applied.
- Lists are stored on the device. Share as text, or back up and restore as JSON.

## Install on a phone
Open the site, then **Add to Home screen** / **Install app** in the browser menu (Safari: Share → Add to Home Screen).

## Develop
```
npm install
npm run dev        # local dev server
npm run build      # production build into dist/
npx tsx scripts/test-engine.ts <data-dir> "<catalogue name>" "<unit>" ...   # engine smoke test
npm run sweep -- <data-dir> ["<army name filter>"]   # add every unit of every army; list crashes and errors
npx tsx scripts/compare.ts <data-dir> <old src dir> <new src dir>         # default points per unit, old engine vs new
```
Set `V=1` before `npm run sweep` to print each problem unit.

Deploys to GitHub Pages on every push to `main` (enable Pages → Source: GitHub Actions in repo settings).

## Screens
- **Games**: pick the game you're playing. Lists, Library and new lists then only show that game (or pick "All games").
- **Lists**: build and edit lists. All squad sizes and wargear choices happen here.
- **Library**: read-only. **Armies** shows each unit's stats, standard loadout, available options with costs, profiles and rules. **Rules** searches every rule in every data file of the chosen game, with differently worded copies of a rule grouped together and labelled by army.
- **Data**: download / update repos, import files, back up lists.

## How the data is read
- Data files can sit in subfolders and can be zipped (`.gstz` / `.catz`). The Data tab can also import a whole repo `.zip` (GitHub's Download ZIP).
- A model group ("5× Veteran") shares its wargear, and that wargear counts once per model for points and limits. **Split 1** separates a model to give it different gear; **Merge** puts it back when its gear matches again.
- Mandatory picks are filled in one at a time and re-checked, because limits often change once a default is taken. Without a usable default, the cheapest option (after modifiers) is picked.
- Options follow the data's `sortIndex` where it's set.
- Rule and profile links honour their own hidden flags and modifiers (e.g. Legion-specific rules, "Duellist's Edge (1)").
- Percentage limits (e.g. "no more than 25% of the army's points") are checked against the current total.

## Not yet covered
Some rare BattleScribe features aren't implemented: per-link `shared="false"` counting, force-count limits on the roster (`forces` constraints), and `self`-scoped constraints.
