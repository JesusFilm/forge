# Top Shelf fresh content and closed-app refresh assessment

## Scope

Follow feat-753 on `codex/tv-selected-improvements`, starting at
`14f4804a1c6c618a650416829b1e99ff605712b5`. Preserve the earlier interception
evidence and all existing local documentation changes. Fix stale foreground
content without user cache resets or fabricated history. Assess, but do not
implement or deploy, the additional native/backend work for closed-app updates.

## Implementation direction

- Revalidate real resume/editorial metadata during the existing bounded Top Shelf
  synchronization instead of reusing a whole-day persistent catalogue. Preserve
  real history, identity/destinations, language eligibility, cancellation and the
  last unexpired native snapshot on transport failure.
- Refresh the Home model used by Journey when Apple TV returns from background
  and when the beta selector explicitly requests new content. Keep the Home
  screen visible during refresh, avoid duplicate initial work and preserve the
  Android data path.
- Separate native/OS title caching from application data caching; do not claim
  that fresh API data alone proves visible system Home updates.
- Document supported Apple extension/network and notification mechanisms using
  official sources, their delivery limits, repository gaps and required real-device
  verification. No APNs credentials, admin publishing, schema change or deployment.

## Verification

Use the existing isolated QA Apple TV 4K simulator and local fixture proxy,
with separate artifacts under `.local-tools/top-shelf-refresh/`. Confirm the
emitted QA endpoint and actual requests. Compare unchanged/candidate launch timing
and request counts with the same installed native binary and retained real history.
Exercise warm Journey copy, warm/cold Continue metadata, authoritative removal,
transport failure/recovery and cancellation. No manual cache reset may be used
to obtain the candidate result. Run TV static checks and regression tests, inspect
actual system Home, and restore normal endpoint/Metro while leaving QA shut down.

Owner clarification during execution: subsequent testing must use local fixtures
or interception only, with **no production API calls**. The forwarding proxy was
stopped immediately, and a fail-closed local replay was prepared from already
captured public catalogue/Home data. Earlier read-only baseline measurements are
retained with their original provenance; they must not be relabelled offline.
The owner explicitly excluded Push testing. No APNs or simulated-push test is
authorized for this run.

## Closed-app implementation assessment

The native provider currently reads the App Group snapshot and bundled fallback;
it does not fetch an API. Apple's system can invoke a Top Shelf extension while
the containing app is closed, and its provider may fetch asynchronously. The
next implementation should give the extension a small, validated public content
feed and an expiring local fallback, with its endpoint configured natively through
the existing Expo plugin. React Native's Metro environment does not configure the
extension. See [TV Services](https://developer.apple.com/documentation/tvservices)
and Apple's [provider example](https://developer.apple.com/videos/play/wwdc2019/211/).

Keep public editorial metadata separate from app-owned personal progress. An
extension result must not overwrite newer real progress, language/profile changes
or privacy retirement. If both processes write the same file, atomic replacement
alone is insufficient: add cross-process coordination and revision/generation
checks. Existing App Group capability is reusable; current app-private SecureStore
identities do not automatically become shared extension credentials.

tvOS controls when the extension runs; this is not an immediate-update guarantee.
Optional later APNs work would require native registration/background callback,
provisioning, token lifecycle and an authenticated server-side provider. Background
pushes can be delayed/throttled, and force-quit limits automatic app wakeup. This
run does not implement or test that optional path. See Apple's
[background-push constraints](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).

## Result

Implemented and verified on October 20 (Pacific/Auckland). All 21 fully local UI
runs passed. Continue metadata and Journey copy refresh on foreground return
without manual cache clearing, app restart or style reselection. Same-film artwork,
Collection order/removal, authoritative removals and metadata error recovery also
passed on actual system Home. The genuine 159-second progress entry remains.

Background and terminated observations lasted 60.567 and 60.561 seconds with no
request or snapshot change. Normal reopening refreshed automatically. This records
the current closed-app limitation; it does not implement native extension fetching.
Push was not run, as explicitly requested. Actual admin publishing, physical TV,
full player controls and the earlier Spotlight accessibility-title limit remain
outside the confirmed results.

TV typecheck, lint, 185 suites / 2,291 tests and formatting pass. Proxy v4 passes
11 tests covering 16 modes with zero outbound API fetches. Independent review
identified and repaired top-up query ownership, confirmed-removal filtering and
post-await retirement fencing. The existing selector source guard was updated
from unconditional publication to requiring fresh, error-free data; its initial
failure remains archived.

Matched earlier Debug launch smoke averaged 3,215.5 ms before and 2,958.8 ms after
(two samples each). No observed launch regression; no statistical speedup claim.
Those measurements used read-only catalogue traffic before the later local-only
instruction and are explicitly labelled separately from the offline verification.

Evidence: `.local-tools/top-shelf-refresh/runtime-results.md`, `results.json`,
`performance-review.md`, `deliverables/index.html`, and the separate `cleanup.json`.
The harness run is
`apps/tv/test-results/development-harness/top-shelf-fresh-content-720be102-d88a-4fd4-88a4-fc879bf0ffab`,
using QA source/environment digest
`965ca3107f2d240486154597a3893d00985e1233720a5f4ec593f163a24e6144`.
Original endpoint bytes are restored during cleanup, with normal Metro deliberately
kept stopped under the local-only instruction. No commit, push, release or deploy.
Broader feat-630 remains in progress.
