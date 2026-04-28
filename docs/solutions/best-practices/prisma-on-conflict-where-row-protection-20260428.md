---
title: "Per-row protection in a bulk INSERT via `ON CONFLICT … WHERE` + RETURNING absence-as-signal"
category: best-practices
date: 2026-04-28
tags:
  - prisma
  - postgres
  - bulk-upsert
  - upsert-protection
  - core-sync
  - admin
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
---

# Per-row protection in a bulk INSERT via `ON CONFLICT … WHERE` + RETURNING absence-as-signal

## Problem

Admin's Core sync needs to never overwrite rows that have been
edited by manager (`source = 'manager'`). The legacy per-row upsert
loop did this with a JS pre-pass:

```ts
const existing = await tx.video.findUnique({
  where: { coreId: video.id },
  select: { source: true },
})
if (existing?.source === "MANAGER") continue
await tx.video.upsert({ ... })
```

Once we collapse the per-row loop into a single bulk
`INSERT … ON CONFLICT DO UPDATE` (see
`docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`),
the JS pre-pass disappears. The bulk statement needs to enforce
the protection itself, AND the dependent code (e.g. the
VideoLocale upsert that follows the Video upsert) needs a way to
tell *which* rows were protected so it can skip the locale update
for those videos.

## Solution

Use Postgres's `ON CONFLICT (target) DO UPDATE … WHERE <cond>`
clause to gate the UPDATE branch, and use `RETURNING` to drive
the dependent step.

```ts
// 1. Bulk INSERT with per-row UPDATE protection.
const writtenVideos = await tx.$queryRaw<
  Array<{ id: string; core_id: string }>
>(
  Prisma.sql`
    INSERT INTO "video" (
      "id", "core_id", "slug", "label", "locked", "no_index",
      "ai_metadata", "primary_language_id", "synced_at", "updated_at"
    )
    VALUES ${Prisma.join(videoTuples, ", ")}
    ON CONFLICT ("core_id") DO UPDATE SET
      "slug"                = EXCLUDED."slug",
      "label"               = EXCLUDED."label",
      "locked"              = EXCLUDED."locked",
      "no_index"            = EXCLUDED."no_index",
      "primary_language_id" = EXCLUDED."primary_language_id",
      "synced_at"           = EXCLUDED."synced_at",
      "updated_at"          = EXCLUDED."updated_at",
      "deleted_at"          = NULL
    WHERE "video"."source" != 'manager'::"SourceTier"
    RETURNING "id", "core_id"
  `,
)

// 2. Dependent step: build a Map<coreId, adminId> from RETURNING.
//    Rows that hit the WHERE-filtered branch are NOT in RETURNING.
const coreIdToVideoId = new Map<string, string>()
for (const row of writtenVideos) {
  coreIdToVideoId.set(row.core_id, row.id)
}

// 3. For dependent rows, look up the parent id in the Map. Absence
//    means "this parent was protected; skip the dependent work."
for (const video of videos) {
  const videoId = coreIdToVideoId.get(video.id)
  if (!videoId) continue // manager-protected; skip locale upsert
  // ... build VideoLocale tuples for this videoId ...
}
```

## Why This Works

- **`ON CONFLICT … WHERE` filters the UPDATE branch only.** When a
  conflicting row fails the WHERE predicate, Postgres's behavior is
  effectively `DO NOTHING` for that row: no UPDATE fires, no row is
  inserted (the conflict already happened), no error is raised, and
  the row is **not** returned by RETURNING. This is documented in
  the Postgres `INSERT` reference under "ON CONFLICT — `conflict_action`":
  https://www.postgresql.org/docs/current/sql-insert.html
- **RETURNING returns only rows actually inserted-or-updated.** For
  ON CONFLICT WHERE-filtered conflicts, the row is silently dropped
  from RETURNING. This gives us a clean signal in the dependent
  step: presence in the Map = "we wrote this row"; absence = "this
  row was protected (or, exotic edge case, missing from the page
  entirely)."
- **Atomic protection at the SQL layer.** Unlike the JS pre-pass
  which had a TOCTOU window (manager could mutate the row between
  the findUnique and the upsert), the WHERE clause evaluates
  against the conflicting row's current state at UPDATE time —
  same SQL statement, same MVCC snapshot. The protection is
  guaranteed.
- **Constant cost regardless of protection rate.** The legacy JS
  pre-pass cost N findUnique queries per page even when zero rows
  needed protection. The SQL WHERE clause is evaluated as part of
  the existing INSERT — zero additional round-trips.

## Constraints

- **The protection only fires on UPDATE, not INSERT.** A new row
  (no conflict) is always inserted. This is correct for admin's
  MANAGER use case: only existing rows can have `source = 'manager'`,
  so the protection only matters at UPDATE time. If you need to
  protect against INSERT too (e.g. don't insert if a "parent
  blocked" flag is set elsewhere), use a Postgres trigger or a
  pre-INSERT filter on the row tuples.
- **Absence-from-RETURNING isn't only "protected" — it's also
  "never wrote".** If the bulk INSERT errored, none of the rows
  are in RETURNING. The dependent code's "skip" path conflates
  both cases (correctly, since there's nothing to do dependent-
  on-something-that-doesn't-exist). Worth a comment in the
  dependent code so future readers don't assume RETURNING is a
  protection-only signal.
- **Dependent FK rows for protected parents must use the existing
  parent id**, not a freshly-minted one. Easy to get wrong: don't
  generate a `newRowId()` for dependent rows referencing a
  protected parent — they'd reference a parent id that doesn't
  exist. The Map-lookup-and-skip pattern above handles this
  correctly because absence-from-Map → skip the dependent row
  entirely. Don't try to "use the existing video's id from the
  page" — the page only has the Core-side id, not admin's
  internal id; the only way to get admin's id is via RETURNING,
  and protected rows aren't in RETURNING.

## Prevention

- **Always test the protection at the SQL layer, not just the JS
  layer.** A test that mocks `$queryRaw` and stubs RETURNING to
  omit the protected row proves the JS handles the omission
  correctly. It does NOT prove the SQL `WHERE` clause actually
  filters in Postgres. Either (a) add an integration test that
  inserts a manager-source row and asserts the bulk upsert
  leaves it untouched, or (b) at minimum lock the SQL invariant
  via the byte-equality pattern from
  `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  so a typo in the WHERE clause forces a deliberate snapshot
  update.

- **Never rely on absence-from-RETURNING without enumerating the
  failure modes.** A row can be absent because:
  - The WHERE filtered the UPDATE branch (the protection case).
  - The bulk INSERT errored before reaching that row.
  - The row was an INSERT (not a conflict) and the INSERT branch
    has a separate WHERE — Postgres allows `WHERE` on the
    conflicting row but a parallel `WHERE` on the inserting row
    requires a different syntax.
  Document which case "absence" means in your dependent code.

- **Use this pattern when the protection is per-row + content-
  dependent.** If the protection is page-wide ("don't run this
  whole sync if X"), short-circuit at the workflow boundary
  instead. If it's per-row but content-independent (e.g. a hard
  deny-list), filter the row tuples in JS before binding.

## Related

- `docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`
  — the bulk-upsert idiom this pattern extends.
- `docs/solutions/database-issues/prisma-transaction-timeout-wrong-tool-for-per-row-bulk-20260428.md`
  — why the legacy JS pre-pass became a problem at scale.
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  — how to lock the WHERE clause against drift via byte-equality
  SQL invariants.
- Postgres reference — `INSERT ... ON CONFLICT`:
  https://www.postgresql.org/docs/current/sql-insert.html
- PR #846 in JesusFilm/forge — admin's `sync-videos.ts` and
  `sync-dubs.ts` use this pattern.
