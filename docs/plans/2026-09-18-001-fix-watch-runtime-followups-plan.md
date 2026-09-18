---
title: "fix: Verify and resolve Watch runtime follow-ups"
type: fix
status: active
date: 2026-09-18
---

## Scope and decisions

Verify feat-513, feat-516, feat-517 and feat-515 against current production and
merged work. Complete each remaining investigation with a reproduced cause,
minimal correction where justified, normal PR/main deployment, and explicit
production acceptance. Keep each independently reviewable correction scoped.
Do not close an investigation merely because a short repeat is healthy.

The starting revision is `72dc5f792`. Railway reports Admin and worker on
`1a01e09fdb7a45c19bbbec29de4b22f42c0e2a20`, and Web on
`2bf3eba35f996884e2076fc3d60c3331146dfdb4`. SSH confirms Admin's runner flag is
false while the installed queue still starts listeners when enqueueing. No
subsequent merged correction was found for the four ticket entry points.
Recent RUM contains HTML hydration mismatches on desktop and mobile, as well as
a separate text variant. Field LCP has a slow tail; it does not establish the
cause of the historical approximately ten-second local paint observation.

Preserve other agents' branches, worktrees, processes and databases. Use a new
owned local PostgreSQL container. Before Web edits, check concurrent task and PR
ownership again; feat-515 already contains a useful matched baseline study.

## U1: Enqueue without executing in Admin

Origin: `docs/roadmap/platform/feat-513-admin-workflow-enqueue-only-runtime.md`.
Execution note: reproduce first with the pinned Postgres world and real queue.
The existing application startup gate misses the SDK's implicit startup from
`queue()`. Prefer a narrowly maintained dependency correction that honors the
existing explicit false runner setting over duplicating queue serialization,
storage or retry logic. Keep unset/true worker behavior compatible.

Files: dependency patch, root package/lockfile, Admin queue integration tests,
the ticket, and a durable solution. Test separate producer and consumer
processes, durable enqueue, restart, deduplication, failures/retries, wake-up
rescheduling and cancellation behavior. Preserve byte payloads and headers.
Measure request scheduling under matched work before claiming a latency benefit.
Verify both deployed revisions, no Admin listeners and worker consumption.

## U2: Characterize profiler cost

Origin: `docs/roadmap/platform/feat-516-admin-profiler-collection-latency.md`.
Execution note: controlled characterization before proposing a correction.
Use the pinned profiler, an owned production build with matching source maps,
representative allocations/stacks and independent request probes. Separate
first/warm mapping, serialization, encoding and GC. Avoid a second CPU profiler.
Bound any production timing wrappers and restore all temporary state. Preserve
profiling and useful source-mapped error stacks. A negative reproduction needs
explicit coverage and limits; an unmatched replay is insufficient.

## U3: Isolate hydration mismatch

Origin: `docs/roadmap/platform/feat-517-watch-intermittent-hydration-error.md`.
Execution note: capture the actual SSR/client mismatch before editing.
Use exact URL, locale, build/cache and browser conditions, keeping HTML and text
variants distinct. Read the ticket's route, hero and recommendation entry points
and existing hydration learnings. Add a causal regression and compare real
navigation, acknowledgment bodies, recommendation response semantics and page
loading. Do not suppress errors or hydration warnings.

## U4: Explain cold paint variability

Origin: `docs/roadmap/content-discovery/feat-515-watch-cold-paint-preview-verification.md`.
Execution note: extend the existing matched before/after study.
Capture timed screenshots, first paint, heading/poster/media visibility, LCP
element changes and main-thread attribution in fixed cold/warm conditions.
Use field evidence to assess whether the controlled behavior represents users.
Do not change the preview delay or telemetry just to move a metric. Implement a
correction only for a demonstrated causal path and verify page load performance.

## Shared verification and release

Run touched-scope tests, types, lint, build and formatting; real integration
coverage is required for queue behavior. Review correctness, reliability,
security, performance and test adequacy sequentially under the repository's
Compound Engineering tool mapping. Record durable learnings in
`docs/solutions/` and exact observations in `docs/operations/`.

Fetch and incorporate newer main before each merge, rerun relevant checks, then
use normal squash PR/main automation. Verify the exact running revision, not
just Railway build success. Report HTTP failures, semantic delivery fallbacks,
selection aborts, JavaScript errors and page-load results separately. Close each
ticket only when its acceptance evidence is complete.

The authored English Homepage Recommendations Block remains removed and
`forge.watch.homepageRecommendations` stays default off. No Mobile/TV UI,
account-linking, curation republishing, increased deadlines, ambiguous mutation
retries or reduced identity, authorization, attribution, integrity or rate-limit
guarantees.

## Execution state — September 18

- U1: PR #2337 merged and exact Admin/worker revision `9cdb79b13` verified.
  No Admin job listener; the worker processed 1,083 flow and 539 step callbacks
  in the recorded 15-minute window. Runner isolation is complete.
- U2: PR #2339 merged as `c813991ad`; production acceptance remains pending.
  Real production-build controls reproduce 742–815 ms first collections and
  reduce them to 209–215 ms without disabling profiling or losing source maps.
- U3: PR #2338 deployed as `cc5a50565`. The same production autoplay arrivals
  failed before and pass after; real unmuted playback continues. The demonstrated
  mismatch is complete, with older unretained-query/other-variant limitations.
- U4: Current late VIDEO LCP is reproduced even with media blocked; removing
  only the native video poster locally removes that late candidate. The old
  late H1 / missing-paint observation is still unproven. Preserve its open state
  rather than substituting a healthy run or the newer VIDEO explanation.

feat-496 is reopened because a later selection trace actually exceeded the
upstream deadline. The known fixes and later healthy observations remain valid;
none proves all runtime failures absent. See the dated operations record for
separate HTTP, semantic fallback, browser abort, JavaScript and paint evidence.
