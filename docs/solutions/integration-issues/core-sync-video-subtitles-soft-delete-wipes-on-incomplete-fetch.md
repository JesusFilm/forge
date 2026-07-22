---
title: "Core-sync video-subtitles soft-delete wipes valid rows when a run's fetch is incomplete"
date: "2026-07-22"
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
resolution_type: documentation_update
severity: high
related_components:
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

Two parts: the local recovery that was applied here, and the code guard that is **recommended but not
yet applied** (apps/admin is owned by another engineer — surfaced as a hand-off, not fixed in-branch).

**Local recovery (applied).** The soft-delete only sets `deleted_at`, so the over-deletion is reversible.
Restore rows this run wrongly deleted — deleted just now, but `synced_at` predates the run:

```sql
UPDATE video_subtitle
SET deleted_at = NULL
WHERE deleted_at >= '<run start>'
  AND (synced_at IS NULL OR synced_at < '<run start>');
```

**Recommended guard (admin-owned, not yet applied).** The destructive pass is
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

The only guards today are `firstPageWasEmpty` (page 0 only, `:309`) and `errors === 0`. Neither catches a
run that returned _some_ pages but far fewer rows than exist. Gate the delete on a **fetch-completeness
sanity check** — e.g. skip (or hard-fail) the soft-delete when `totalSubtitlesSeen` is implausibly low
versus the current stored `video_subtitle` count (a run that fetched 208 must never delete 10,695). A short
fetch should degrade to "sync nothing" or a loud failure, never a silent mass delete.

**Operational mitigation** for a prod re-sync until the guard lands: watch the `video-subtitles`
phase counts live and kill the run before the delete if `updated` is far below the stored total; or
re-sync subtitles for the specific affected videos rather than a catalogue-wide `--full`.

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
