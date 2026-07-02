---
title: "Serializing parallel background downloads into an in-memory queue over persisted state: four hazard classes"
date: "2026-07-02"
category: architecture-patterns
module: "apps/mobile"
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - "Serializing previously-parallel per-item background transfers (downloads/uploads) behind an in-memory FIFO queue"
  - "The pump's queue state lives only in memory while queued placeholder records are durably persisted (app relaunch can desync the two)"
  - "A derived aggregate (e.g. batch progress bar) treats a transient per-item state value as steady-state once serialization makes it long-lived"
  - "User-cancelable async gaps (disk probes, URL re-resolution, dir creation) sit between a request and the point of no return"
  - "An occupancy/dedup guard scopes membership across multiple sequential batches without being pruned on cancel, delete, or drain"
symptoms:
  - "Canceled or deleted item mid-batch reappears as a zombie native transfer with an orphaned committed file no UI can see"
  - "App relaunch mid-batch restarts all remaining items in parallel, silently breaking the ordering contract the feature promises"
  - "Pause All never flips to Resume All; the paused slot freezes the pump in an unrecoverable-looking wedge"
  - "A queued item silently vanishes from the UI with no failed or paused record when its deferred start fails"
  - "A paused or manually-retried item from an old batch wedges every future batch via a slug that is never released"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - "react-native-background-downloader"
tags:
  - "download-queue"
  - "sequential-queue"
  - "in-memory-state"
  - "persisted-state"
  - "race-condition"
  - "background-downloader"
  - "cancel-window"
  - "derived-state"
---

# Serializing previously-parallel background work behind an in-memory queue over persisted state

## Context

`apps/mobile`'s series "Download All" originally started every episode's download in parallel via `@kesha-antonov/react-native-background-downloader` — fast, but with no ordering guarantee. The product requirement changed: episodes must complete strictly in series order (1 → 2 → 3), not size-order-first. The naive fix — cap concurrency to 1 inside the existing per-video `startDownload` — doesn't work, because `startDownload` is also the single entry point for manual, swap, and reattach downloads. Those must stay unthrottled; only the _batch_ surface needs sequencing.

The shape of this problem recurs anywhere a system has (a) a per-item action that already works and is reused by multiple callers, (b) a persisted record of item state that survives process restarts, and (c) a new requirement to serialize a _subset_ of callers into "one at a time, in order" without touching the others. Mobile's series batch queue (R14, shipped across `f7da6d02`, `fe898f3e`, `7c75915e`) is a concrete instance. A 9-reviewer pass on the PR found four hazard classes that are generic to this shape, not specific to downloads — they're the checklist for the next person who builds this pattern.

Lineage: the predecessor session (session history) deliberately left the hook this pattern formalizes — the R10 queue-ordering invariant and the pure `runSeriesBatchEnqueue` extraction were built so a later pass could serialize the batch without touching the shared `startDownload`; the same session also rejected adding a React Native render harness in favor of the pure-extraction testing convention this pattern's decision core follows.

## Guidance

### The four building blocks

**1. Pure decision core, no React.** The "what happens next" logic is extracted to a plain function that takes the current persisted state, an in-memory queue, and an occupancy scope, and returns a discriminated-union action. It has zero dependencies on the provider, so it unit-tests without mounting React.

```ts
// apps/mobile/src/lib/batchDownloadQueue.ts
export const BATCH_DOWNLOAD_CONCURRENCY = 1

export type BatchPumpAction =
  | { kind: "empty" }
  | { kind: "wait" }
  | { kind: "drop"; videoSlug: string }
  | { kind: "start"; request: StartDownloadRequest }

export function nextBatchAction(
  records: Readonly<Record<string, OfflineDownloadRecord>>,
  queue: readonly StartDownloadRequest[],
  batchSlugs: ReadonlySet<string>,
  cap: number = BATCH_DOWNLOAD_CONCURRENCY,
): BatchPumpAction {
  if (queue.length === 0) return { kind: "empty" }
  let occupancy = 0
  for (const record of Object.values(records)) {
    if (!batchSlugs.has(record.videoSlug)) continue
    if (record.state === "downloading" || record.state === "paused") {
      occupancy += 1
    }
  }
  if (occupancy >= cap) return { kind: "wait" }
  const head = queue[0]
  const record = records[head.videoSlug]
  if (!isBatchPlaceholderRecord(record)) {
    return { kind: "drop", videoSlug: head.videoSlug }
  }
  return { kind: "start", request: head }
}
```

A sibling gate, `canQueueBatchDownload`, decides _acceptance_ at enqueue time (reject if a live non-placeholder record already owns the slug, or the slug is already queued). Keeping accept-time and pump-time decisions as two separate pure functions — rather than one stateful blob — is what let the fix for hazard #4 (below) land without touching hazard #1's code path.

**2. Provider-owned FIFO over persisted records, woken by the records' own mutations.** The provider keeps three in-memory refs the pure core doesn't know about:

- `batchQueueRef` — the FIFO of not-yet-started requests.
- `batchSlugsRef` — the occupancy _scope_: which slugs count toward the cap.
- `batchPumpingRef` — a single-flight guard so concurrent wakeups don't double-pump.

`pumpBatchQueue` drains in a `while (true)` loop, re-deriving the next action from live state on every iteration (never trusting a stale snapshot across an `await`):

```ts
// apps/mobile/src/contexts/DownloadsProvider.tsx (~line 932)
const pumpBatchQueue = useCallback(() => {
  if (batchPumpingRef.current) return
  batchPumpingRef.current = true
  void (async () => {
    try {
      while (true) {
        const action = nextBatchAction(
          recordsRef.current,
          batchQueueRef.current,
          batchSlugsRef.current,
        )
        if (action.kind === "empty") {
          /* release scope, return */
        }
        if (action.kind === "wait") return
        if (action.kind === "drop") {
          dropFromBatchQueue(action.videoSlug)
          continue
        }
        dropFromBatchQueue(action.request.videoSlug)
        const result = await startDownload(action.request)
        // ... resurface pump-time failures (hazard #4)
      }
    } finally {
      batchPumpingRef.current = false
    }
  })()
}, [startDownload, dropFromBatchQueue, writeRecord])
```

The wakeup source is a plain React effect over the persisted `records` state:

```ts
useEffect(() => {
  if (!isReady) return
  pumpBatchQueue()
}, [records, isReady, pumpBatchQueue])
```

This works because _every_ download terminal transition (downloaded, failed, canceled) is itself a write to `records` — there's no separate "download finished" event to wire up. The queue can never miss a wakeup because the thing it's waiting on and the thing that triggers re-evaluation are the same state.

**3. Durable placeholders, adopted one at a time.** The pump doesn't create a `downloading` record when it starts an episode — it _adopts_ one. The caller (the "Download All" sheet) persists a bare `queued` placeholder for every episode up front, before any of them run, via the pre-existing `queueBatchRecords` path. This is what makes waiting episodes show a `queued` badge in the grid and be coverable by "Cancel All" while they haven't started yet. `startDownload` recognizes its own placeholder and drives it forward instead of reporting `exists`:

```ts
// apps/mobile/src/contexts/DownloadsProvider.tsx (~line 806)
const isOwnPlaceholder = isBatchPlaceholderRecord(existing)
if (isLiveDownloadRecord(existing) && !isOwnPlaceholder) {
  return { ok: false, reason: "exists" }
}
```

**4. Occupancy is scoped and lifecycled, not a global counter.** `batchSlugs` is not "how many downloads are active app-wide" — it's "which slugs belong to _this_ batch run." A paused batch episode still counts toward occupancy (deliberately — see Why This Matters), but a paused _unrelated_ download never blocks the batch. The scope is populated on enqueue, pruned on cancel/delete, and — critically — cleared when the queue drains with nothing left in flight, so a later manual download of a once-batched slug doesn't inherit a stale reservation.

### The four hazard classes (checklist for the next implementation)

**Hazard 1 — Serialization widens a cancel window that used to be safe.** Before batching, `startDownload`'s awaits (`freeDiskBytes`, `ensureVideoDir`, the ~10s `reresolveMediaUrl`) were cheap because most calls started immediately. Under the batch queue, "immediately" can mean minutes into a wait. Nothing had ever re-checked whether the record was still there after those awaits, because the gap used to be too small to matter. Once episodes serialize, a cancel that lands mid-gap can: get overwritten by the state write that runs after the gap (resurrecting a record cancel just deleted), start a native task that isn't yet in the task registry when cancel looks for it (unstoppable), or let `finalize` move a completed file to disk against a record that no longer exists (an orphan no UI path can delete).

Fix: after every await, re-check the _live_ record before each point of no return — before the state write, and before the native start — and bail with a new `"canceled"` result reason instead of proceeding:

```ts
// after freeDiskBytes/ensureVideoDir, before writeRecord
if (isOwnPlaceholder && !recordsRef.current[videoSlug]) {
  return { ok: false, reason: "canceled" }
}
// after reresolveMediaUrl, before starting the native task
if (recordsRef.current[videoSlug]?.state !== "downloading") {
  return { ok: false, reason: "canceled" }
}
```

The swap path needs the _same_ guard, but checking a different invariant — `swapFrom` must still be present, or a cancel's revert-to-old-copy has already run and starting now would clobber it:

```ts
const midSwap = recordsRef.current[videoSlug]
if (midSwap?.state !== "downloading" || !midSwap.swapFrom) {
  return { ok: false, reason: "canceled" }
}
```

Generic lesson: when you add a queue in front of an existing async function, every await inside that function gets a longer effective cancel window than it was built for. Audit each one, not just the new queueing code.

**Hazard 2 — Persisted state outlives the in-memory queue.** On relaunch, `batchQueueRef` and `batchSlugsRef` are empty (they're refs, not persisted), but the `queued` placeholders written to disk survive. Launch reconciliation (`reconcile()` in `downloadReconciliation.ts`) used to restart every surviving record directly — which, applied to a pile of `queued` placeholders, fanned them all out as concurrent native tasks. The ordering contract silently vanished exactly on the longest, most-likely-to-be-interrupted batches.

Fix: the reattach effect special-cases batch placeholders and re-seeds them into `batchQueueRef` instead of restarting them, rebuilding the request from persisted identity (no persisted media URL, so the request URL is set to `""` — it fails `validateActionUrl` only if `reresolveMediaUrl` also fails, otherwise the fresh URL wins; a genuine failure surfaces as a `failed` badge, which is an acceptable outcome for a scenario that's already "app was killed mid-batch"):

```ts
// apps/mobile/src/contexts/DownloadsProvider.tsx (~line 700)
if (record && isBatchPlaceholderRecord(record)) {
  batchQueueRef.current = [
    ...batchQueueRef.current,
    {
      videoSlug: record.videoSlug,
      title: record.title,
      dubDocumentId: record.dubDocumentId,
      rendition: {
        documentId: record.renditionDocumentId,
        quality: record.qualityLabel,
        size: record.totalBytes > 0 ? String(record.totalBytes) : "",
        url: "", // startDownload re-resolves
      },
      subtitleLanguageSlug: record.subtitleLanguageSlug,
      subtitleUrl: null,
      posterUrl: null,
      allowCellular: !wifiOnlyRef.current,
    },
  ]
  batchSlugsRef.current.add(record.videoSlug)
} else if (record) {
  await restartDownload(record)
}
```

Because a pure-requeue reconcile action may not touch `records` at all, the records-effect wakeup from block 2 won't fire on its own here — the reattach path calls `batchPumpRef.current()` explicitly at the end.

Generic lesson: any in-memory queue sitting in front of persisted state needs an explicit reconciliation path that re-seeds the queue on cold start. If you only reconcile the persisted records and assume "restart what's incomplete" is correct for everything, you'll silently break every invariant the queue was built to enforce, and only on exactly the runs that got interrupted.

**Hazard 3 — Derived UI assumed the old state distribution.** `seriesDownloadAggregate.ts`'s `deriveSeriesDownloadState` originally treated any `IN_PROGRESS_STATES` member (`queued`, `downloading`, `paused`) as equally "active," because under parallel starts `queued` was a transient microstate nobody could observe. Once the sequential queue made `queued` the _steady state_ for every waiting episode, that assumption broke concretely: "Pause All" only paused the one active episode (the rest were still `queued`, not `downloading`, so nothing else could be paused), the action bar never flipped from "Pause All" to "Resume All" (because `inProgress` stayed true from the queued episodes), and the paused slot held the pump's occupancy — the batch looked permanently wedged from the UI even though the pump was correctly waiting.

Fix: narrow which states count as "actively transferring" for the pause-affordance decision. Only `downloading` drives `anyDownloading`; `paused` drives `anyPaused` separately; `pausedAggregate` (which flips the bar to "Resume All") is `anyPaused && !anyDownloading`:

```ts
// apps/mobile/src/lib/seriesDownloadAggregate.ts (~line 55)
if (record.state === "paused") anyPaused = true
else if (record.state === "downloading") anyDownloading = true
...
pausedAggregate: anyPaused && !anyDownloading,
```

This was verified live on a 61-episode batch, not just in the unit tests for the aggregate function.

Generic lesson: any derived/aggregate view built before the queue existed encoded an assumption about which states are transient vs. steady. Adding a queue changes that distribution — audit every place that branches on "is this state in the active set" once a formerly-fleeting state becomes normal.

**Hazard 4 — Deferred execution breaks enqueue-time reporting and stale occupancy blocks unrelated work.** Two related failures from the same root cause (the pump runs _later_ than acceptance):

- The "Download All" sheet buckets outcomes ("5 started, 1 skipped") at the moment it calls `queueBatchDownload`, which only validates _acceptance_ into the FIFO. The actual `startDownload` call — where disk space, URL resolution, or the native engine can fail — runs minutes later inside the pump loop, whose result was originally discarded. A pump-time failure silently removed the placeholder record with no failed badge, no summary update, nothing visible.
- `batchSlugsRef` only ever grew during the original implementation. A paused episode from an earlier, unrelated series, or a later _manual_ (non-batch) download of a slug that had once been batched, would occupy the cap-1 slot forever and wedge every future batch for the rest of the session.

Fix for the first: the pump resurfaces non-`exists`/non-`canceled` failures by writing a fresh `failed` record rebuilt from the request's own identity, so the badge and Library both reflect reality:

```ts
if (
  !result.ok &&
  result.reason !== "exists" &&
  result.reason !== "canceled" &&
  !recordsRef.current[action.request.videoSlug]
) {
  await writeRecord({ ...rebuiltFromRequest, state: "failed" })
}
```

Fix for the second: the slug set is pruned on cancel/delete (`batchSlugsRef.current.delete(videoSlug)` inside `cancelDownload`) and reset to empty when the queue fully drains with nothing left active:

```ts
if (action.kind === "empty") {
  const stillActive = Object.values(recordsRef.current).some(
    (r) =>
      batchSlugsRef.current.has(r.videoSlug) &&
      (r.state === "downloading" || r.state === "paused"),
  )
  if (!stillActive) batchSlugsRef.current = new Set()
  return
}
```

Generic lesson: when acceptance and execution are separated in time by a queue, (a) execution's result must be plumbed back to wherever acceptance reported success, not silently dropped, and (b) any occupancy/reservation scope that execution reads must have an explicit release path — "only ever grows" is a slot leak waiting for the next unrelated caller to collide with it.

### Two intentional non-fixes worth naming

- **Swaps and language-switches bypass the queue entirely.** The ordering guarantee is scoped to _fresh_ downloads inside a batch; `swapDownload` calls `startDownload` directly when there's no existing copy, and otherwise runs its own non-destructive swap flow. This is deliberate, not an oversight — don't "fix" it by routing swaps through the batch queue.
- **A connectivity blip auto-pauses the active episode, which holds the slot and halts the whole unattended batch.** This is an accepted tradeoff, not a bug: the alternative (auto-resume, or letting the queue advance past a paused head) risks resurrecting hazard classes 1 and 3.

The pump loop itself is `try/finally`-wrapped around the `while` body specifically so a thrown error inside `startDownload` (already hardened per commit `8a8f634c`) can't leave `batchPumpingRef` stuck `true` forever, permanently wedging the single-flight guard.

## Why This Matters

Each hazard class independently produces a _silent_ failure — nothing crashes, nothing throws a visible error, the app just quietly stops honoring a contract the user was told existed ("episodes download in order," "cancel means gone," "pause all means the bar says resume"). That's what made a 9-reviewer pass necessary: unit tests on `nextBatchAction` and `canQueueBatchDownload` prove the pure core's branch shape is correct, but none of the four hazards live in that pure core — they live in the _timing_ seam between the provider's persisted writes, the in-memory refs, and React's effect scheduling, which only a review built around "what can happen during this await" or "what does state look like after a cold restart" surfaces. Mocked/unit coverage proves the decision function is right for a given snapshot; it doesn't prove the snapshot can't change underneath a caller mid-flight, or that state accumulated in one session behaves the same on the next launch. This is the second consecutive review round on the same feature to prove the point: the previous round (session history) caught three timing bugs after a fully green 533-test suite — cancel-of-a-language-switch deleting the old downloaded copy, cancel-all deleting an episode that completed while the confirm dialog was open, and a double-tap resume double-starting through a ~10s re-resolve window. Green unit suites on the pure cores are necessary but structurally incapable of catching this class.

## When to Apply

Reach for this pattern — and re-run this exact hazard checklist — whenever you're adding an in-memory queue in front of an _existing_, already-shipped, per-item async action, where:

- The per-item action is reused by multiple callers and only a subset need serialization (don't throttle the shared function itself).
- Item state is persisted and must survive app/process restarts, but the queue that orders pending items is not persisted.
- The action has one or more awaits whose duration was previously short relative to typical cancel/interrupt timing, and the queue will make some of those waits arbitrarily long.
- There's a derived/aggregate UI view that was built assuming today's state distribution (which states are transient vs. steady) — before the queue existed.
- Acceptance (validating and enqueueing a request) and execution (actually running it) are going to happen at different times, and something reports outcomes at acceptance time.
- Occupancy/concurrency is tracked via a scope (a set of ids) rather than a single incrementing counter — check it has both a grow path and a release path.

## Examples

**Unit-testable core, no timing hazards visible from tests alone:**

```ts
nextBatchAction(records, queue, batchSlugs, cap)
// => { kind: "empty" | "wait" | "drop", videoSlug } | { kind: "start", request }
```

This is fully deterministic and cheap to test with plain object fixtures — see `apps/mobile/src/lib/batchDownloadQueue.test.ts` and the R10 ordering guard added alongside `runSeriesBatchEnqueue` extraction (commit `1312bb77`). But passing these tests proves nothing about hazards 1, 2, or 4 — those require simulating an await-interleaved cancel, a cold-restart reconciliation pass, and a deferred pump-time failure respectively.

**Before (hazard 3, wrong):**

```ts
const IN_PROGRESS_STATES = new Set(["queued", "downloading", "paused"])
// any of these => inProgress = true, used directly to decide "show Pause All"
```

**After (hazard 3, fixed):**

```ts
if (record.state === "paused") anyPaused = true
else if (record.state === "downloading") anyDownloading = true
// pausedAggregate (drives "Resume All") checked BEFORE inProgress in the label fn
pausedAggregate: anyPaused && !anyDownloading,
```

**Before (hazard 1, wrong — implicit in the pre-batch code):** `startDownload` wrote the `downloading` record and started the native task with no recheck between the two long awaits.
**After (hazard 1, fixed):** two explicit live-record rechecks, each returning a new `"canceled"` result reason rather than falling through to the state write or native start.

## Related

- `docs/solutions/runtime-errors/series-download-setconfig-cancels-inflight-20260624.md` — Same subsystem (DownloadsProvider + @kesha-antonov/react-native-background-downloader) and the direct precedent the new queue pump builds on.
- `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md` — Canonical reserve-then-release slot contract for background dispatch; the new doc's hazard #4 (occupancy slug-set that only grew because deferred start failures escaped enqueue-time reporting) is a fresh cross-domain instance of exactly the leak pattern this doc catalogs (slot reserved before dispatch, never released on a throw that doesn't hit the normal completion path).
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md` — Verification methodology (reading AsyncStorage/queue records straight from the iOS sim app container when console.
- `apps/mobile/src/lib/batchDownloadQueue.ts` — pure decision core (`nextBatchAction`, `canQueueBatchDownload`, `BATCH_DOWNLOAD_CONCURRENCY`).
- `apps/mobile/src/contexts/DownloadsProvider.tsx` — `pumpBatchQueue` (~line 932), `queueBatchDownload` (~line 1003), post-await rechecks in `startDownload` (~lines 806-925) and `swapDownload` (~lines 1025-1140), reattach reseed effect (~lines 690-793).
- `apps/mobile/src/lib/seriesDownloadAggregate.ts` — `deriveSeriesDownloadState`'s `anyPaused`/`anyDownloading` split (~line 55).
- Commits: `595941eb` (initial parallel batch enqueue), `f7da6d02` (strict-sequential queue introduced), `8a8f634c` (engine-start throw hardening), `fe898f3e` (9-reviewer hardening pass: cancel races, relaunch ordering, pause affordance), `1312bb77` (pure-core extraction + R10 ordering guard test).
- Memory note: `project_mobile_download_all_completion` — v1.1 plan context, size-gate relaxation, background-downloader terminal-event dedup by slug id.
