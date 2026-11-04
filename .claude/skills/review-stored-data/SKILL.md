---
name: review-stored-data
description: 'Review check "Stored data": report changes that could break saved lists, backups or share links already on phones. Reviews uncommitted work by default, the index with `staged`, or a ref or date. Use when the user asks for a stored data review or runs /review-stored-data.'
---

Pin the change under review from the argument, as `.claude/skills/review-target.md` says. With no argument, it is the uncommitted work. In the check below, `BASE..HEAD` means that change. Change no file. Give the user the findings that the check's last paragraph describes as `body`.

# Stored data

Report changes that break data already saved. Lists live in IndexedDB, in backup files and in share links, and the phone holds the only copy. Old copies live forever, and no test fails when a release can't read them, unless one was written with the old shape.

**Read all of the change, and report every instance.** Read the diff of every file this check covers, one file at a time, to its end. Do not cut the output with `head`, `tail` or a line limit. When you find one instance of a problem, search the whole change for the same pattern. A review that reports a sample makes another round find the rest.

Read `git diff BASE..HEAD -- src/data/engine.ts src/data/catalog.ts src/data/db.ts src/store.ts src/ui/snapshot.ts src/ui/exporter.ts`.

| Problem | Report it when |
| --- | --- |
| Roster shape | A field of `Roster`, `Force` or `Sel` is renamed, removed, retyped or made required, with no migration |
| Option keys | How `Opt.key` is built changes (`buildOptions` in `catalog.ts`). Keys are saved on each selection, so existing lists stop matching their units |
| Share links | A field of `Snapshot` changes without keeping old links readable, or without moving `v` and still reading version 1 |
| Backups | The backup file's shape changes, or `importRosters` stops accepting an older file |
| Database | `VERSION` or an object store changes in `db.ts` without an upgrade path for existing data |
| Reading old data | New code assumes a field is present that older saved lists don't have |
| Silent loss | A path that overwrites or deletes a saved list without the player asking |
| No old-shape test | A stored format changes with no test that feeds in the old shape |

Do not report a type-only change that doesn't alter what's stored, or a new optional field that old data simply lacks and the code handles. Write `body` as a table: file and line, the problem, what happens to a list saved by an older release, and the fix in one sentence.
