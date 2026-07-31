---
title: "Core-sync video-subtitles soft-delete wipes valid rows when a run's fetch is incomplete"
date: "2026-07-22"
last_updated: "2026-07-31"
category: integration-issues
module: apps/admin/src/services/core-sync/phases/sync-video-subtitles.ts
problem_type: integration_issue
component: service_object
symptoms:
  - "A local --full core-sync left only ~208 live video_subtitle rows out of ~10,700; the video-subtitles phase reported updated=10901, softDeleted=10695, errors=0"
  - "birth-of-jesus and the other JESUS segments lost their English (languageId 529) subtitle rows even though the upstream Core gateway returns them"
  - "Production admin returns englishSubs=0 for the JESUS-segment editions while the Core gateway has the English VTTs"
  - "The TV showcase sentence-aware hop feature is silently data-gated to 1 of 6 centerpieces (only my-last-day has a reachable English VTT in prod)"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - apps/admin/src/services/core-sync/phases/video-subtitle-reconciliation.ts
  - apps/admin/src/services/core-sync/phases/sync-video-images.ts
  - apps/tv/src/lib/showcaseMode/sentenceTimingSource.ts
  - apps/tv/src/components/showcaseMode/ShowcaseScreen.tsx
tags:
  - core-sync
  - admin
  - video-subtitles
  - soft-delete
  - data-loss
  - sync-phase
  - graphql
---

# Core-sync video-subtitles soft-delete wipes valid rows when a run's fetch is incomplete

## Problem

The core-sync `video-subtitles` phase ends every full run by soft-deleting each
`video_subtitle` row it did not re-fetch that run. Its inline bulk fetch can come
back **silently incomplete** (fewer subtitles per video than the video actually has),
and the soft-delete then wipes the missing-but-valid rows — reporting `errors: 0` the
whole time. This is the likely mechanism by which production admin lost the JESUS-segment
English VTTs, which in turn data-gates the TV showcase sentence-aware hop feature.

## Symptoms

- A local `--full` sync (`pnpm --filter @forge/admin core-sync:run --full --scope=…,video-subtitles`)
  left **~208 live `video_subtitle` rows out of ~10,700**. The phase log:
  `event=core-sync.phase.complete phase=video-subtitles created=0 updated=10901 softDeleted=10695 errors=0`.
- birth-of-jesus (`1_jf6102-0-0`) ended with 2 live subtitles (Croatian), and its English (529)
  row — `synced_at` from a prior 2026-05-25 sync — was flipped to `deleted_at` by this run.
- Production admin: `videoBySlug("birth-of-jesus").preferredPlayableDub("english").videoEdition.subtitles`
  returns `[]`, while the Core gateway `videos(where:{ids:["1_jf6102-0-0"]}){ subtitles }` returns 102
  subtitles including 2 English (ot + jl editions) with fetchable VTTs.
- Downstream: the reel falls back from sentence-aware hops to the fixed 10s grid for every centerpiece
  with no reachable English VTT — 5 of 6 in prod. Only `my-last-day` stays sentence-aware.

## What Didn't Work

- **"The video just has no English subtitle."** The first read of the prod GraphQL (`subtitles: []`)
  looked like a genuine content gap. It is not: the Core gateway (source of truth) returns the English
  VTT for birth-of-jesus, and the file `.../ot/subtitles/1_jf6102-0-0_ot_529.vtt` has 33 real cues.
- **"A fresh sync will restore it."** Running the sync locally to prove that made it _worse_ — the run's
  bulk fetch returned a tiny fraction of the catalogue's subtitles and the soft-delete then wiped the rest,
  including the English rows a prior good sync (2026-05-25) had correctly populated. The local damage was
  recovered by un-soft-deleting the run's over-deletion (see Solution), not by re-running the sync.

## Solution

**Durable resolution (2026-07-31).** The historical ratio guard and manual
recovery notes below are superseded as production guidance. Core PR #9425
defines a protected, versioned subtitle manifest with a stable snapshot,
catalogue root, per-video buckets, and snapshot-bound details; Core must deploy
it before Forge enables this consumer. Admin reproduces checksum version 1
from every active Core-owned subtitle row. Equal roots are a zero-detail,
zero-write result; only unequal video buckets request details.

Admin validates the complete requested detail set before writing. Each repair
transaction is fenced by the current sync-lock row, restores or upserts the
exact Core records for one video, and may soft-delete only Core-owned rows for
that same video that are absent from the validated detail. A changed snapshot,
malformed response, missing or ambiguous relationship, Manager-owned Core-ID
collision, or lost lock fails closed without a delete. A final checksum match is
the only state that can be published as in parity.

The normal scheduled/manual Core Sync is the repair path for JESUS video
`1_jf-0-0`; no direct production SQL patch is required. Existing Watch manifest
invalidation publishes the restored transcript through the normal data path.

The SQL below records how the disposable local database was recovered during
the original investigation. It must not be used as the production repair path.

**Local recovery (applied).** The soft-delete only sets `deleted_at`, so the over-deletion is reversible.
Restore rows this run wrongly deleted — deleted just now, but `synced_at` predates the run:

```sql
UPDATE video_subtitle
SET deleted_at = NULL
WHERE deleted_at >= '<run start>'
  AND (synced_at IS NULL OR synced_at < '<run start>');
```

**Superseded historical proposal.** The destructive pass was
`sync-video-subtitles.ts:319-329`:

```ts
// Runs on a full sync (!since) whenever no page threw. Deletes EVERY CORE subtitle
// whose syncedAt predates this run — i.e. everything the run did not re-touch.
if (!since && stats.errors === 0) {
  const result = await prisma.videoSubtitle.updateMany({
    where: {
      source: "CORE",
      deletedAt: null,
      OR: [{ syncedAt: null }, { syncedAt: { lt: phaseStartedAt } }],
    },
    data: { deletedAt: new Date() },
  })
  stats.softDeleted += result.count
}
```

The former idea was to gate the global delete using a fetched/stored ratio. That
would catch spectacular coverage collapses, but it would not prove that any
specific row was removed from Core. It was therefore rejected as a deletion
authority in favor of the snapshot-bound per-video invariant above.

## Why This Works

The soft-delete implements "prune rows Core no longer has" by deleting everything the current run did not
stamp with a fresh `synced_at`. That is only safe if the run's fetch is **complete** — every row Core still
has was re-fetched and re-stamped. The phase's own header comment already records the first incarnation of
this trap (`:4-7`): an old top-level `videoSubtitles` query "silently returned empty pages and the soft-delete
pass wiped every synced subtitle." The current inline `videos { subtitles }` query fixed _that_ empty-page
case, but the **soft-delete's unconditional trust in fetch completeness is unchanged** — any cause of a short
fetch (rate limiting, gateway list truncation on the nested resolver, an unauthenticated/degraded run) re-arms
the same wipe. `errors: 0` is not evidence of completeness: a `200 OK` page carrying fewer subtitles than the
video has is not an error the loop sees.

Honest scope note: the exact reason _this_ local run's fetch was so incomplete was not isolated — it ran
**unauthenticated** (no `CORE_API_TOKEN`) against the public gateway, so rate-limiting or nested-list
truncation are plausible and prod (authenticated) may fetch more reliably. The durable, code-provable
learning is not the specific fetch failure but the **soft-delete's lack of a completeness guard**, which
turns any incomplete fetch into silent data loss.

## Prevention

- **A checksum mismatch identifies work; only authoritative detail authorizes
  mutation.** Aggregate counts and ratios can alert, but cannot prove a
  particular record is absent from Core.
- **Scope absence-based deletes to the exact parent and snapshot that was
  validated.** Never turn an incomplete catalogue response into a global
  cleanup.
- **Fence validation and mutation with the sync-lock row.** A preflight lock
  check outside the transaction is not enough because ownership can change
  before commit.
- **Persist execution, freshness, and data parity independently.** A workflow
  can succeed while residual videos remain out of parity; stale or malformed
  evidence must render unknown, never healthy.

- **Never let a "delete everything not re-fetched" pass run destructively without a fetch-completeness
  gate.** Any soft-delete/prune-after-sync (this phase, and any sibling that mirrors the pattern) must
  compare what it fetched against what it is about to delete and bail on an implausible ratio. This is the
  space-axis cousin of the mocked-vs-real discipline: `errors: 0` proves no page threw, not that the data
  is whole.
- **A partial upstream read is a first-class failure, not a no-op.** Treat "fetched far fewer rows than
  stored" as a reason to abort the run, the same way a thrown page is.
- **Cross-check destination coverage after a sync** for phases with a delete pass — a coverage collapse
  (here: live subtitle count) is the signal, and it is cheap to assert.
- Related core-sync coverage trap (different phase, same "the bulk query returned less than expected"
  family): `docs/solutions/integration-issues/admin-core-sync-flat-vs-nested-image-query-coverage-gap-20260519.md`.
- TV-side manifestation: the showcase reel degrades to the fixed grid when no English VTT is reachable
  (`apps/tv/src/lib/showcaseMode/sentenceTimingSource.ts` returns `reason: "no-subtitle"`, and
  `ShowcaseScreen.tsx` rebuilds without timing) — correct behaviour, but it silently masks the missing data.
