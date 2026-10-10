---
title: "Series download completion toast: aggregate terminal state can't distinguish a cancel/failure revert from a genuine completion"
module: "apps/mobile — series download completion detection"
date: "2026-07-07"
problem_type: logic_error
category: logic-errors
component: frontend_stimulus
severity: low
symptoms:
  - 'False "Series downloaded" toast fires when re-downloading a fully-saved series (quality/subtitle change) then cancelling'
  - "Same false toast when a re-download's swaps all silently fail and every episode reverts to its old copy"
  - "Falling-edge detector (inProgress -> false AND seriesAllDownloaded) is satisfied in the same render right after a CANCEL"
  - "Naive fix of resetting sawDownloadActivityRef inside cancel fails: the effect re-arms it while the in-flight episode is still reverting (inProgress stays true)"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "apps/mobile/app/series/[slug].tsx"
  - "apps/mobile/src/lib/seriesDownloadAggregate.ts"
  - "apps/mobile/src/contexts/DownloadsProvider.tsx"
tags:
  - react-native
  - expo
  - mobile-downloads
  - state-machine
  - falling-edge-detection
  - terminal-state-aliasing
  - suppression-latch
  - completion-toast
---

# Series download completion toast: a falling-edge detector aliases cancel/failure reverts as completion

## Problem

The series detail page (`apps/mobile/app/series/[slug].tsx`) shows a "Series downloaded" toast when a series finishes downloading. Detection was a falling-edge effect: fire when `downloadState.inProgress` goes false while `seriesAllDownloaded(downloadState)` is true. Re-downloading an already-saved series (to change quality or subtitle) and then **cancelling** — or a re-download whose swaps all silently **fail** — reverts every episode to its still-`downloaded` old copy, so the series reads fully-downloaded again at the exact render where `inProgress` flips false. The detector fired a false "Series downloaded" toast right after a cancel or a failed swap.

## Symptoms

- User re-downloads a saved series, taps Cancel all → a "Series downloaded" toast appears even though nothing new was saved.
- A re-download whose swaps all silently fail reverts to the old copies and produces the same false toast.
- Genuine completion still toasts correctly; a fresh mount of an already-saved series correctly stays silent (that case was already guarded). Only the cancel-revert and failure-revert transitions mis-fire.

## What Didn't Work

- **Naive "reset `sawDownloadActivityRef` inside the cancel handler."** The idea was to disarm the activity latch when the user cancels so the falling edge finds it already false. It fails because cancellation is not instantaneous: the in-flight episode is still reverting, so `inProgress` stays **true** for one or more renders after the handler runs. The effect's `if (downloadState.inProgress) { sawDownloadActivityRef.current = true; return }` branch re-arms the ref on those intermediate renders, so by the time the real falling edge arrives the latch is true again and the toast fires anyway. Resetting the shared triggering-state latch is defeated by the intermediate `inProgress === true`.

This is not the first time a series-level signal read from aggregate/terminal record state failed to tell a genuine completion from a reverted or still-saved copy. The predecessor "Download All" work (PR #1435) hit and fixed the same class repeatedly — always by distrusting the aggregate and classifying per record: **(session history)**

- **Aggregate-derived "paused" wedged under the sequential queue.** The batch bar could never show "Resume all" because the aggregate counted `queued` episodes as "downloading"; the sequential queue's steady state is exactly 1 paused + N queued, so `pausedAggregate` never flipped. Fixed by reclassifying `queued` in the aggregate.
- **`startDownload` checked record state before, but not after, its ~10s network await**, so a cancel that landed mid-await aliased into a completion — a deleted record's task re-registered as a zombie after the await. Fixed with an explicit `"canceled"` result reason plus post-await re-checks of the record.
- **The pump silently discarded `startDownload` failures**, so a mid-batch failure erased the episode instead of marking it failed — a failure-revert that vanished rather than reporting.
- **The header's "All downloaded" counted records without comparing dubs**, so a swap to a new language still read "All downloaded" while only the old copy existed on disk. This was named verbatim and deliberately deferred — it is the direct antecedent of the toast bug documented here.

## Solution

Add a **separate one-shot `cancellingRef` latch** that the cancel handler sets and the effect consumes on the falling edge — independent of the activity latch that the intermediate `inProgress === true` keeps re-arming. Also reset the activity latch on **any** activity-end (not only on completion) so a stale latch can't suppress a later genuine completion.

Before:

```tsx
const [seriesSnackbar, setSeriesSnackbar] = useState<string | null>(null)
const sawDownloadActivityRef = useRef(false)

useEffect(() => {
  if (downloadState.inProgress) {
    sawDownloadActivityRef.current = true
    return
  }
  if (!sawDownloadActivityRef.current) return
  // BUG: any inProgress→false that lands fully-downloaded toasts —
  // including a cancel-revert or a failed-swap revert to the old copies.
  if (seriesFullyDownloaded) {
    setSeriesSnackbar("Series downloaded")
  }
}, [downloadState.inProgress, seriesFullyDownloaded])
```

After:

```tsx
const [seriesSnackbar, setSeriesSnackbar] = useState<string | null>(null)
const sawDownloadActivityRef = useRef(false)
const cancellingRef = useRef(false)

useEffect(() => {
  if (downloadState.inProgress) {
    sawDownloadActivityRef.current = true
    return
  }
  if (!sawDownloadActivityRef.current) return
  // Activity ended: consume both latches; toast only a genuine completion.
  sawDownloadActivityRef.current = false // reset on ANY activity-end, not only completion
  const wasCancelling = cancellingRef.current
  cancellingRef.current = false
  if (!wasCancelling && seriesFullyDownloaded) {
    setSeriesSnackbar("Series downloaded")
  }
}, [downloadState.inProgress, seriesFullyDownloaded])
```

The cancel handler arms the dedicated latch synchronously before dispatching the per-episode cancels:

```tsx
const cancelAll = () => {
  // Cancelling reverts episodes to their saved copies (series reads
  // fully-downloaded again) — suppress the false completion toast.
  cancellingRef.current = true
  ;(series?.episodes ?? []).forEach(
    (episode) => void cancelDownload(episode.slug),
  )
}
```

Why the `cancellingRef` has to be separate rather than reusing/resetting `sawDownloadActivityRef`: the cancel path passes through one or more `inProgress === true` renders while episodes revert, and the effect re-arms `sawDownloadActivityRef` on each of those. A latch that is only **read** at the falling edge (never re-armed by the in-progress branch) is immune to that intermediate churn.

## Why This Works

At the record level a cancel-revert and a failure-revert are **indistinguishable** from a genuine completion — all three land with every episode in the `downloaded` terminal state and `pendingSwapSlugs` cleared, so `seriesFullyDownloaded` is true and `inProgress` is false in the same render. A falling-edge "`inProgress`→false + `allDownloaded`" detector therefore **aliases three different transitions** (finished, cancelled-revert, failed-revert) into one predicate. You cannot recover which transition occurred from the aggregate terminal state alone.

The terminal state is ambiguous _by design_: the quality/subtitle swap is deliberately **non-destructive** — the old saved copy is kept on disk until the new one verifies, and a cancel or failure reverts to it. **(session history)** That safety rule (an earlier P1 was that cancelling a swap _deleted_ the old copy) is exactly what makes a revert look like a completion: afterward every episode genuinely is `downloaded`, just at the old quality. The distinguishing fact — "did _this_ run finish it?" — exists only at the moment of the transition, so it must be carried out-of-band.

The fix restores that missing information: the cancel handler is the only place that _knows_ a revert (not a completion) is coming, so it records that fact in `cancellingRef`, and the detector consumes it on the same falling edge to suppress the toast. Resetting `sawDownloadActivityRef` on any activity-end (rather than only on the completion branch) covers the remaining non-completion transitions for free:

- **Fresh-download cancel** — episodes are removed, so the series is no longer fully-downloaded and `seriesFullyDownloaded` is false → no toast, and the latch is cleared so it can't leak into a later run.
- **Partial failure** — some episodes end failed (not in `downloadedSlugs`, not in-progress), so `seriesFullyDownloaded` is false → no toast.
- **Stale-latch prevention** — clearing both latches at the edge means a suppressed cancel can't leave `cancellingRef` armed to swallow the _next_ genuine completion.

## Prevention

- **Do not infer "operation succeeded" from aggregate terminal state when a cancel or a failure reverts to that same terminal state.** Reverts alias completions. Any predicate of the form "everything is now in the done state" answers "is it done?" — never "did _this_ run finish it?"
- **Trust per-record terminal events; distrust series-aggregate inference.** **(session history)** Every fix in this subsystem's history made the same move: stop reading series state from a naive aggregate count and classify per record instead (reclassify `queued`, re-check the record after an await, surface a failed record, carry a `pendingSwapSlugs` marker). The per-episode signal is trustworthy; the series-aggregate signal is where the ambiguity lives.
- **Prefer an out-of-band success signal over a falling-edge predicate over derived state.** If the download layer can emit an event only on a real finalize/`onDone`, key the toast off that. When you can't (here the toast is driven purely by derived aggregate state), add an **explicit suppression latch for each known non-completion transition** and consume all of them on the same edge as the success check.
- **Watch for the "reset the shared ref in the handler" trap.** If the state that triggers the effect (`inProgress`) can still be momentarily active while the handler runs, an effect that re-arms a ref inside its `if (triggering) { ref = true; return }` branch will re-arm whatever the handler just reset. Use a **separate one-shot latch that is only read at the decision point**, never written by the triggering branch.
- **Reset every latch on any activity-end, not only on the success branch** — otherwise a suppressed non-completion can leave a latch armed and swallow a later genuine event.
- **Same class of bug as the sibling `pendingSwapSlugs` progress-ring fix on this branch.** There, a re-download swap kept episodes in the `downloaded` state so the ring read ~full during a re-download; the fix was to count pending swaps as 0 units so the ring fills from scratch. Both are the same root principle: **aggregate terminal record state cannot distinguish a saved/reverted copy from a freshly completed one** — you must carry the distinguishing signal (`pendingSwapSlugs` for the ring, `cancellingRef` for the toast) explicitly.

## Verification

- `tsc --noEmit` clean, `eslint` clean.
- Full jest suite passes (573 tests).
- Live-verified on the iOS simulator (dev client `org.jesusfilm.forgewatch`; downloads never work in Expo Go):
  - Genuine series completion → "Series downloaded" toast shows.
  - Re-download then Cancel all → no toast.
  - Fresh mount of an already-saved series → no toast.

## Related Issues

- `docs/solutions/architecture-patterns/strict-sequential-batch-queue-over-persisted-state-pattern.md` — the sequential batch queue (R14) pattern doc for this same derived-aggregate seam. This completion-toast bug is enumerated there as **Hazard 5**, the terminal-state twin of Hazard 3's pause-affordance fix.
- `docs/solutions/runtime-errors/series-download-setconfig-cancels-inflight-20260624.md` — an adjacent "you cannot read intent from terminal record state" bug in the same `DownloadsProvider`.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md` — the sim verification methodology (reading download records from the app container) for reproducing swap/completion races.
- `apps/mobile/src/lib/seriesDownloadAggregate.ts` — `deriveSeriesDownloadState`, `seriesAllDownloaded`, and the `pendingSwapSlugs` handling this detector reads.
