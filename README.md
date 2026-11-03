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
```

Deploys to GitHub Pages on every push to `main` (enable Pages → Source: GitHub Actions in repo settings).

## Not yet covered
Every edge case of the BattleScribe rules engine isn't implemented (e.g. per-model splitting of non-collective entries, some percentage-based limits). Points, limits and the common conditions/modifiers are.
