# Studio autosave and session warning

Scope: Manager Studio editor only; roadmap feat-692. Feedback:
[Lyuba’s DM](https://jfp-digital.slack.com/archives/D050UJWSHL5/p1791548928015299).
Earlier Shorts feedback was delivered under feat-607, feat-628 and feat-630.

## Plan

1. Reproduce audio deletion without Save and expired-session failure in the real
   editor fixture; add deterministic session regressions.
2. Add a disposable debounce scheduler over editor snapshots, preserving single
   in-flight saves and exact retry receipts. Avoid requests on initial load or
   playback and avoid automatic retry loops after failure.
3. Track authentication separately from save state; promote preview HTTP 401 into
   the editor warning. Preserve edits and recovery while signing in separately.
4. Guard document unload and ordinary same-tab link navigation while dirty or a
   save receipt is unresolved. Keep explicit conflict reconciliation.
5. Verify behavior including edits during saves, failure/retry, undo, navigation,
   session recovery and conflict. Compare fixture load/preview timings. Review
   changes and capture durable learnings before opening a PR.

## Acceptance

Audio deletion reaches revision history without pressing Save. Authentication
failure explicitly says edits are not saved when dirty; subsequent edits retain
that warning. Signing in and retrying saves the retained document. Leaving warns
while dirty/saving/failed/conflicted and does not warn for a saved document.
