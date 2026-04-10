---
status: complete
priority: p2
issue_id: "021"
tags: [code-review, manager, mux, enrichment, data-integrity]
dependencies: []
---

# Stop requiring CMS playback IDs for direct Mux asset reuse

The new direct-reuse materialization path currently rejects any source variant
whose CMS-linked `muxVideo` row has an `assetId` but no `playbackId`. That is
too strict for the new production mode, because the Mux asset itself is now the
source of truth and playback IDs can be recovered from Mux at runtime.

This turns stale or partially synced CMS rows into hard "No reusable Mux asset"
failures even when the underlying asset is still reusable.

## Findings

- `apps/manager/src/services/stageClone.ts:167-171` returns `null` for direct
  reuse unless both `assetId` and `playbackId` exist in CMS.
- `apps/manager/src/services/stageClone.ts:297-314` then maps those rows to the
  unsupported reason `no_reusable_mux_asset`.
- `apps/manager/src/services/transcription.ts:193-204` already retrieves the
  authoritative playback ID from the live Mux asset during transcription.
- `apps/manager/src/services/mux.ts:195-205` already has a `getMuxAsset()`
  helper that can recover a playback ID from the live asset before job
  creation.
- Local CMS evidence:
  `select count(*) from mux_videos where asset_id is not null and asset_id <> '' and (playback_id is null or playback_id = '');`
  currently returns `244`.

## Proposed Solutions

### Option 1: Recover missing playback IDs from Mux during direct materialization

**Approach:** Allow direct candidates with an `assetId` only, then call
`getMuxAsset(assetId)` (or equivalent) to populate the playback ID before
creating the job.

**Pros:**

- Treats Mux as the real source of truth in production-direct mode
- Avoids false "unsupported" errors from stale CMS rows
- Reuses an existing manager helper

**Cons:**

- Adds one more Mux API call in the direct path when CMS data is incomplete
- Needs clear error handling for assets that truly lack playback IDs

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Background backfill CMS playback IDs first

**Approach:** Keep the strict runtime requirement, but add a separate CMS sync
or repair step that fills missing playback IDs before operators can enrich.

**Pros:**

- Keeps runtime logic simple
- Improves CMS data hygiene

**Cons:**

- Does not solve immediate operator failures
- Couples enrichment availability to a separate sync pipeline

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 3: Fall back to clone mode when playback ID is missing

**Approach:** If the asset ID exists but playback ID is missing in CMS, skip the
direct path and use the existing clone flow instead.

**Pros:**

- Restores job success without waiting on CMS repair
- Minimizes live-asset introspection

**Cons:**

- Reintroduces duplicate assets
- Hides CMS drift instead of fixing it

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

Allow direct-reuse candidates with only a CMS `assetId`, then recover the
playback ID from live Mux state during materialization before job creation.

## Technical Details

**Affected files:**

- `apps/manager/src/services/stageClone.ts`
- `apps/manager/src/services/mux.ts`
- `apps/manager/src/app/api/enrich/route.ts`
- `apps/manager/src/services/stageClone.test.ts`

**Related components:**

- CMS `mux_videos` sync integrity
- direct-reuse job creation
- job detail playback links

**Database changes:**

- No required schema change

## Resources

- Plan:
  `docs/plans/2026-04-09-feat-gate-mux-clone-enrichment-by-environment-plan.md`
- Local DB table:
  `public.mux_videos`

## Acceptance Criteria

- [x] Direct-reuse candidate resolution no longer rejects assets solely because
      CMS playback ID is blank
- [x] Job creation can recover a playback ID from Mux when the CMS row is stale
- [x] Unsupported direct-reuse errors are reserved for truly unusable assets
- [x] Automated tests cover the asset-id-present / playback-id-missing case

## Work Log

### 2026-04-09 - Review finding capture

**By:** Codex

**Actions:**

- Reviewed the direct-reuse source selection logic in `stageClone.ts`
- Verified that transcription/runtime playback handling already reads from live
  Mux asset state
- Queried the local CMS database for `mux_videos` rows with missing
  `playback_id`

**Learnings:**

- The local CMS snapshot currently contains 244 rows with `asset_id` present but
  blank `playback_id`
- The new direct-reuse path will misclassify those rows as non-reusable unless
  it recovers playback IDs from Mux at runtime

### 2026-04-09 - Fix implemented

**By:** Codex

**Actions:**

- Updated `apps/manager/src/services/stageClone.ts` so direct-reuse candidates
  only require `assetId` up front
- Reused `getMuxAsset()` to recover a missing playback ID from live Mux state
  before job creation
- Added regression coverage in `apps/manager/src/services/stageClone.test.ts`
  for the asset-present / playback-missing case
- Ran `pnpm --filter @forge/manager test`
- Ran `pnpm --filter @forge/manager lint`
- Ran `pnpm --filter @forge/manager typecheck`

**Learnings:**

- The live Mux asset is the correct source of truth for playback IDs in the new
  production-direct mode
- CMS drift should not force a false `no_reusable_mux_asset` result when the
  underlying asset is still valid

## Notes

- This is not theoretical data drift; the current local snapshot already
  contains affected rows.
