---
title: "A cancel flag keyed to the episode cannot stop the run that outlives it"
date: "2026-09-14"
category: logic-errors
module: "apps/mobile"
problem_type: logic_error
component: raw-file-export
severity: high
framework_version: "expo 57.0.22 / react-native 0.86.3"
symptoms:
  - "Stop on an in-progress series export does not stop the run, and later episodes keep writing into the photo library"
  - "A cancel set during episode 2 is gone by episode 3, because the session deletes each per-target entry as that episode finishes"
  - "An episode reports saved after the viewer pressed Stop, because the cancel landed during the long library write and was never re-read"
  - "The series control returns to its idle Download all state in both the broken build and the fixed build, so the interface cannot show the difference"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - "apps/mobile/src/lib/seriesExportProgress.ts"
  - "apps/mobile/src/lib/exportSession.ts"
  - "apps/mobile/src/lib/rawExportRun.ts"
  - "apps/mobile/src/lib/rawExportAdapter.ts"
  - "apps/mobile/app/series/download.tsx"
  - "apps/mobile/app/series/[slug].tsx"
tags:
  - raw-file-export
  - react-native
  - expo
  - cancellation
  - state-lifetime
  - sequential-queue
  - photo-library
  - device-verification
---

# A cancel flag keyed to the episode cannot stop the run that outlives it

## Problem

Pressing Stop on an in-progress series export did not stop the run. Episodes kept
downloading, and kept landing in the device photo library, after the viewer
stopped the export. The work is in `apps/mobile` on the raw file export feature
("Save to Photos"). It sits on PR #2232, which is open and not merged to `main`
as of this writing.

## Symptoms

- The viewer pauses a series export and presses "Stop Download". The sheet
  promises "Stopping ends the whole series export." (`apps/mobile/app/series/[slug].tsx:353`).
- New videos keep appearing in the photo library after the stop.
- The episode in flight reports the outcome `"saved"` when the stop lands during
  its library write.
- The next episode starts normally, as if no stop happened.
- The series control returns to its idle look at once — in both builds.

## What Didn't Work

**The per-target cancel flag on its own.** The export session keeps one entry per
export target, and `requestCancel(target)` sets `cancelRequested` on that entry.
The run loop asked whether a cancel was pending by scanning the session snapshot
for an entry of this series with the flag set. That scan cannot answer the
question, because the session deletes each entry in the `finally` of that
target's own export (`apps/mobile/src/lib/exportSession.ts:452`). A flag set
during episode 2 no longer exists when episode 3 starts. The run loop reads an
empty scan and continues.

**A cancel check placed only before the long await.** Inside one episode,
`writeToLibrary` is a long await (`apps/mobile/src/lib/rawExportAdapter.ts:342`).
The adapter checked for a cancel before that write (`:332`) and not after it. A
cancel that landed during the write was never seen, so the episode returned
`"saved"`. The run loop reads that outcome to decide whether to start the next
episode, so a `"saved"` outcome kept the run alive.

**Reading the user interface.** A screenshot of the series control cannot tell
the broken build from the fixed build. The control's label comes from
`seriesDownloadLabel`, which reads only the count of completed OFFLINE copies
(`apps/mobile/src/lib/seriesDownloadAggregate.ts:235`). An export writes to the
photo library and creates no offline record, so the label stays "Download all"
for the whole run either way. The control is structurally incapable of reporting
this operation.

## Solution

Four changes, all in the review-fix commit on PR #2232.

**1. A run-scoped cancel latch**, in `apps/mobile/src/lib/seriesExportProgress.ts`,
keyed by the `runId` the progress store already publishes:

```ts
const cancelledRuns = new Set<string>() // :88

export function requestSeriesExportCancel(seriesSlug: string): boolean {
  const run = bySeries[seriesSlug] // :92
  if (!run) return false
  cancelledRuns.add(run.runId)
  return true
}

export function isSeriesExportCancelled(runId: string): boolean {
  return cancelledRuns.has(runId) // :99
}
```

The run's own lifecycle releases the latch:
`publishSeriesExportProgress(slug, null)` deletes the entry when the run ends
(`:57`). The episode's lifecycle no longer controls it.

**2. Stop sets the run latch first** — `stopAll` in
`apps/mobile/app/series/[slug].tsx:346` calls `requestSeriesExportCancel(...)`
at `:349`, before the per-episode `store.requestCancel(slug)` loop at `:350`.

**3. The run loop reads both surfaces** (`apps/mobile/app/series/download.tsx:433`):

```ts
isCancelRequested: () =>
  isSeriesExportCancelled(run.runId) ||                        // added
  Object.values(getExportSessionStore().getSnapshot().byTarget).some(
    (entry) => entry.seriesSlug === seriesSlug && entry.cancelRequested,
  ),
```

**4. The adapter re-checks after the library write**
(`apps/mobile/src/lib/rawExportAdapter.ts:354`), immediately after the `:342`
await. The earlier check at `:332` stays. The two checks guard different windows
of the same episode.

**The run latch is an added axis, not a replacement.** The per-target entries are
not dead, and deleting them would break three other things: the per-episode
transfer abort (`onCancel`), the cancelled-versus-failed outcome discrimination,
and the disambiguation of a pause from a real cancel. Both axes stay.

## Why This Works

The cancel flag's lifetime was shorter than the operation it had to cancel. A run
outlives every one of its episodes. The flag lived on the episode's session entry,
and the session deletes that entry the moment the episode finishes. The flag
therefore disappeared in exactly the two windows where the stop mattered: the gap
between two episodes, and the library write inside one episode. The fix moves the
flag to the run's own scope, and the run's own end releases it.

The two mechanics this uses are already documented, and are not restated here:
re-check the live record after every await before a point of no return
(`../architecture-patterns/strict-sequential-batch-queue-over-persisted-state-pattern.md`,
hazard 1), and key a guard to a durable identity rather than a transient marker
(`../design-patterns/lifecycle-protection-keyed-to-transient-marker-dies-with-marker.md`).
What is new is the trigger question that selects them, below.

## Prevention

**The trigger question.** Before writing a cancel path, ask: _what unit is this
flag keyed to, and what unit does it have to cancel?_ When the answer differs,
the flag is wrong however correct each read of it looks. Scope it to the
longest-lived unit of the operation, re-check it after every long await inside
the sub-units, **and release it with that same unit**. The symmetric bound
matters: an unreleased run-scoped latch is the mirror defect and is worse,
because the next run starts already cancelled, silently, for the rest of the
session.

**The oracle.** When the change is an external side effect, assert on that side
effect. Do not assert on the interface that reports it — it reads the same state
the defect corrupts, so it can show success in exactly the broken case. Here the
control read "Download all" in both builds. Count the photo-library inserts
instead:

```
xcrun simctl spawn <udid> log show --last 6m --style compact \
  --predicate 'processImagePath CONTAINS "forgewatch"' \
  | grep -c 'performChanges: completed.*success: YES'
```

Measured 2026-09-14 on the iPhone 17 simulator: a five-episode run was stopped
after three episodes. The count read 8 at the stop, and still 8 thirty seconds
later. The absolute number is not the evidence; the fact that it stops advancing
is. The same counter proved a second property on the single-video path — a pause,
then a resume, then a completion produced exactly one insert, so the resume did
not save a duplicate. The absence of an error message would not have shown that.

**Naming a row as unverified is not a control.** The PR body already listed
"series ordering and cancel" among its open rows. The defect sat inside a row the
PR had itself named as unproven, and was still found only by pressing Stop.

**The fix has no test, and that was falsified, not assumed.** As of this writing
no test imports `requestSeriesExportCancel` or `isSeriesExportCancelled`, and
`rawExportWiring.guard.test.js` pins other raw-export call sites by source token
but neither cancel call site. The adapter's existing cancel test cancels during
the transfer, which the decider maps to a `"cancelled"` outcome
(`apps/mobile/src/lib/rawExport.ts:172`), so the adapter returns at its
`staged.outcome` check on line 313 and reaches neither `:332` nor `:354`. Removing
`isSeriesExportCancelled(run.runId) ||` from
`apps/mobile/app/series/download.tsx:434` — the whole fix — typechecks cleanly
and leaves 224 suites / 3617 tests passing (measured 2026-09-14). Three
assertions close the gap:

1. A run-loop test where the cancel arrives BETWEEN two episodes, with no live
   session entry. The run must stop, and the next episode must not start.
2. An adapter test where the cancel arrives DURING `writeToLibrary`. The outcome
   must be `"cancelled"`, and the asset must stay in the library (R22 keeps it).
3. A release test: a run ends, a new run starts for the same series, and the new
   run is not cancelled.

Falsify each one before trusting it.

## Known Limit

`completeStagedExport` (`apps/mobile/src/lib/rawExportAdapter.ts:419`) is the
deferred-resume path that finishes a library write a killed or backgrounded
process never ran. It rebuilds its `runId` from persisted JSON, and
`cancelledRuns` is an in-memory module-scope `Set`, so the latch holds no entry
for a run cancelled before the process died. A staged note from a cancelled run
can still complete after relaunch. This is a different path with a different
trigger, and it is bounded to one already-staged file — but it is the one place
the run latch cannot answer the question.

## Related Issues

- `../architecture-patterns/strict-sequential-batch-queue-over-persisted-state-pattern.md`
  — the offline download queue's five hazard classes. Its hazard 1 is the
  re-check-after-await law this applies at a second queue in a different module.
  Its checklist has no hazard for a cancel signal keyed to a shorter-lived unit.
- `../design-patterns/lifecycle-protection-keyed-to-transient-marker-dies-with-marker.md`
  — nearest sibling in shape. Difference worth naming: there a separate rule
  cleared the marker; here the operation's own ordinary per-episode completion
  releases it, so no second rule is needed to arm the bug.
- `../architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
  — the same family one level up: a control reaches only as far as the lifetime
  of the thing it governs.
- `../best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`
  — a contrast, not a restatement. That law is about state released too late or
  never; this is state released on time for its own unit and too early for the
  unit that needed it.
- `../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home for the oracle rule. An assertion read off the series control
  is vacuously green: no fixture could fail it.
- `../mobile/raw-export-device-pass-2026-09.md` — same feature and PR. Its series
  cancel row is where this defect's device evidence belongs.
- `../runtime-errors/series-download-setconfig-cancels-inflight-20260624.md`
  — adjacent cancel semantics on the same screen, in the opposite direction:
  there a spurious cancel destroyed in-flight episodes; here a real cancel was
  lost.
- `../logic-errors/series-download-completion-toast-terminal-state-ambiguity.md`
  — same screen, same reason aggregate state is a poor oracle after a cancel.
