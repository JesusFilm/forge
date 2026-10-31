---
title: "FGE-225 current-main bootstrap integration"
date: "2026-10-30"
status: in-progress
---

Integrate incoming PR #2647 (`bf22fc125f86fc28580ee9d377ff8c17178fabb6`,
`codex/fge-225-batch-watch-bootstrap`) with exact main
`a3a8f8796a8c25749c4cd02432397772dbf93cef` in the assigned isolated checkout,
without a commit. The original W-028 audit counted four mount reads; only
account and progress survive current main. The owner confirmed this scope
correction after inspection of feat-667 and the current Web guide.

1. Rename only the incoming bootstrap feat-630 ticket to reserved feat-918,
   set it in-progress before executable changes, and preserve unrelated IDs.
2. Merge exact main into the offered lineage. Retain beta signup and profile
   retirement, current flags/timeouts, GA/Datadog, public language routes,
   account auth return destinations, per-user progress and persisted writes.
3. Keep one private/no-store bootstrap flight shared by account/progress;
   remove beta DTO/parser work and the idle helper used solely by the retired
   profile POST. Keep a 1.5 s abort on bootstrap progress reads. The shared
   response still waits for progress; no measured latency improvement is claimed.
4. Reconcile focused tests, then run Web typecheck, touched package/root
   lint/format, and roadmap advisory checks. Use two test workers and one
   foreground heavy command. No build, installation or browser acceptance.
5. Self-review and freeze the staged tree with merge parents, index copy,
   source hashes, main-relative diff and source-preservation proof in the
   parent evidence directory. No commit, push, host update or deployment.

R4-2647-1 remains parent-owned and unresolved: valid partial account/progress
or compatibility-auth failure envelopes remain document-cached. The parent
will add bounded recovery and meaningful mounted compatibility/partial-success
red/green tests, followed by a fresh independent review. Whole HTTP failures
already retry; ordinary healthy anonymous caching is valid.

Runtime acceptance remains necessary: compare matched initial request counts,
waterfall, hydration/main-thread cost, LCP/CLS and media first frame; verify
signed-in/out identity, remount recovery after the parent repair, private cache
headers and account-scoped storage. Source absence and unit request counts do
not certify loading performance or production readiness.

## Integration review and retained learning

The focused integration run passed 105 tests. Web typecheck passed after copying
matching Admin dependency links needed by existing Web block-type imports;
no package installation was needed. Touched Web/root lint and formatting passed.
The README change is one owned index row; inherited aggregate counts remain.

Retain the producer's current scope when integrating an old performance patch:
current main's deleted consumer and retirement ticket take precedence over the
historical request count. A shared response couples section arrival to its
slowest awaited read; the 1.5 s progress abort bounds only that read. Neither
source deletion nor a unit single-flight assertion measures page-load benefit.
R4 recovery, independent review and runtime/loading acceptance remain pending.

## Parent Recovery Repair

The parent added a session availability read for bootstrap: upstream failures or
malformed bodies return unavailable, while a verified anonymous response remains
a guest. The existing auth-session API preserves its anonymous failure behavior.
The shared client keeps healthy sections, checks identity continuity before
carrying them into a retry, and permits one flight per five-second cooldown when
a later consumer loads an incomplete response. It creates no retry timer.
Progress keeps unavailable auth unknown and releases its completed flight, so
a later consumer can participate in recovery rather than staying anonymous.

Mounted JSDOM regressions compose the real route, compatibility verifier, parser,
loader and consumers against controlled upstream boundaries. Initial server-env
proxy interference was isolated before capturing six meaningful red failures.
Healthy guest, sibling retention, concurrency and subject-change controls remain
required. Fresh independent review, current candidate CI and actual browser/
loading acceptance are separate gates; local recovery does not close the ticket.
