# Watch TV reviewed shortlist

## Merge-readiness continuation — 2026-10-29

The owner authorized finishing validation and the normal PR-to-main squash merge.
Latest main `c2f0a0e52` is integrated at `c19459c65`; its retirement of obsolete
recommendation settings is preserved. GPT-6 Astra agents coordinate an independent
diff review and fresh PR-focused checks. Existing bounded UI evidence remains
historical evidence; packaged playback is a separate unresolved check.

Compare untouched main and candidate Release QA builds using the same ARM64
emulator (`emulator-5562`), native sources, debug signing identity, build flags and
TV environment. Preserve the device's existing data in an emulator snapshot before
upgrade installs; restore that snapshot for matched trials. Select the same JESUS
video, audio and saved position. Observe each selection for 60 seconds, retain
screenshots/video/logs, and check Back and retry where applicable. Distinguish media
HTTP errors, decoder failures, native loading and JavaScript handoff from actual
candidate regressions. Failed attempts remain evidence. Physical Chromecast
installation and audible playback are outside this pass.

Completion requires an attached PR, required CI/reviews, verified squash merge,
and an accurately updated HTML checklist without changing personal selections.
The existing full-startup gate in feat-889 is not relabeled by this investigation.

Roadmap: `feat-890`. Base: `30cb5d1da`. Integration branch:
`codex/tv-reviewed-shortlist`.

## Scope and assignments

- Coordinating agent: integration, acceptance, item 4 restart-placement trials,
  item 8 Home-to-Resume comparison, item 19 live recovery tests and repairs.
- Discovery worker (`gpt-6.1-sol`): items 9, 10, 14 and 16; Home destination and
  next-title labels, native search starting points, keyboard action labels.
- Details worker (`gpt-6.1-sol`): item 17 saved-position context and item 18
  authoritative metadata inspection.

The owner requested agents in separate worktrees combined into one branch.
Workers do not control devices or publish. One actor owns each device at a time.
The original checkout's untracked `docs/codex/` remains untouched.

## Acceptance

1. Hero Details opens the same destination; Next title is visible on focus and
   its existing focus node, chevron dimensions and navigation wiring remain stable.
2. Native Apple idle search exposes existing topics/recent queries; selection
   runs the shared search path, retains native text input/dictation, and does not
   add initial artwork requests or typed-query telemetry.
3. Android Space/Search wording fits unchanged key sizes and actions/focus.
4. Saved position appears before Play only for the current video's valid resume
   snapshot. Android retains its chooser and Apple retains native resume.
5. Metadata labels use authoritative fields only. Existing chapter order and
   unsupported sibling duration/ordinal facts are recorded.
6. Scripted restart and Home-to-Resume trials record input counts and actual
   destinations; no confirmation or hero-size change without evidence.
7. Slow/error/retry/cancel native journeys preserve input, dismissibility and
   focus; late completion cannot resurrect cancelled UI.
8. Static checks and representative native smoke pass. Performance evidence
   names its window, target, sample count, cache/build conditions and limits.

## Execution and evidence

Implementation started after creating the roadmap ticket with status
`in-progress`. Existing native binaries include the previous integrated work.
Apple simulator `EB58EEAD-0AD3-4EA4-B96E-F3CE887B39F6` is assigned to the coordinator;
Android `emulator-5562` remains with the parent until explicit handoff. The
coordinator uses isolated Metro 8094; parent Metro 8093 is preserved.

Current status: selected UI implementation and native verification complete.
Final harness acceptance passed with the limits below. Do not update the owner's HTML checklist
until the parent has reviewed combined results.

## Verified findings

- Apple baseline Home initial Search focus reaches Continue Watching with two
  Down presses; Select resumes JESUS directly at the saved position (10:39 in
  this retained-data session). The shelf is already the first rail. Keep hero
  height; this is an operator journey comparison, not a remote-user study.
- Apple Native A Up focuses Start Over; Down/Up/Right/Right reaches Language
  while elapsed time advances normally (11:20 to 11:39). No accidental restart
  occurred in this bounded scripted navigation. Keep the existing immediate action;
  these trials do not estimate real-user accidental-activation incidence.
- Chapter relations explicitly select `children.order` in both video and series
  queries. `normalizeVideo.ts` sorts it before dedupe and the own-child rail
  assigns chapter/episode numbers. Parent siblings select no order, duration or
  ordinal; active-dub duration cannot describe another video. Add no fabricated
  duration or sibling episode labels.
- Apple candidate Details and focused Next title render with visible focus.
  Saved at 12:07 appears after authoritative video identity resolves; native
  playback resumes at 12:08. The sublabel uses the existing secondary 15-unit
  font. No real hour-plus saved snapshot was available; do not claim that live
  layout case from formatter tests alone.
- Apple idle search reuses persisted recents and existing categories. Selecting
  Bible Stories issued exactly one `WatchSearch` request after five seconds;
  the native field displayed `bible stories`. No initial artwork fetch was
  added. Native input/dictation affordance remains; simulator cannot prove
  physical Siri microphone behavior.
- A live injected `WatchSearch` GraphQL failure reproduced the native false
  No results found state. The repair shows Try again with unavailable context.
  Retry preserved `jesus`, displayed Searching during a seven-second delay,
  issued one request, and returned actual JESUS/Feature Film results.
- Back during delayed `family` search returned to Home with Search focused and
  remained there after the late result. This proves navigation/visibility, not
  cancellation of the underlying transport.
- Android candidate Search and Space text fit existing key sizes; paced remote
  traversal reaches focused Search with a white fill and readable dark text.
  UIAutomator could not obtain idle state on the animated search screen; retain
  the screenshot and do not claim a hierarchy pass.

## Review repairs

The independent details worker found two native search edges: retry after an
edited failed query could submit the old query, and index-based recent IDs could
change meaning after reorder. Both are repaired with the current-field submit callback and generation-scoped
action IDs. Real hook/stale-event regressions pass; independent re-review found
no additional actionable defect.
The initial native action cards showed generic photo placeholders; an opaque
full-height title overlay now produces intentional text tiles using existing
native props, with no native source changes or extra artwork requests.

## Evidence location and limits

Coordinator evidence is under the ignored integration `.local-tools/ui-driver/`
and `apps/tv/test-results/development-harness/reviewed-shortlist-20261029-c2efb930-2289-4891-833b-c28a5e806210/`.
The first XCTest driver run failed to type after grouped Menu/Select because no
keyboard held focus; its failure log is retained. Restarted driver operations
separate navigation from typing. No product fix is attributed to that tool race.
Android release-performance measurement belongs to the parent agent and is
excluded from concurrent coordinator performance work.

- Parent review identified that saved-position accessibility text would create
  timestamp-based automatic Play action names. The Play Pressable now overrides
  `dd-action-name` with the existing stable `Play` name while retaining the saved
  position in its accessibility announcement.
- The Details copy changes the primary CTA intrinsic width; the next-chevron
  target remains 62 units with the same focus wiring. Do not claim identical
  absolute action-row positions after changing the label.
- Live `GetVideoDub` failure on a newly selected Afrikaans dub showed the native
  subtitle error with Off/Try again. A delayed retry kept typed English filtering
  through the loaded English/Pidgin results, and Menu returned focus to Subtitles
  Off. Original English, North American Indigenous audio was restored and the
  temporary runtime fetch wrapper removed.

## Final recovery repairs

- The cold seeded Apple detail query failure was reproduced: a seed poster and
  enabled Play remained after `GetVideoBySlug` failed; Select did nothing. The
  shared data-state helper now governs both platforms. Apple keeps its seed
  poster/title with inert Loading Play while waiting and shows focused Retry
  over a static poster on failure. Retry recovered metadata and saved progress;
  focus stayed on Language, Left reached Play, and Menu returned to Home.
- Android's existing detail Retry recovered a real temporary failure to actual
  Saved at 18:45. Play opened the native chooser with Resume from 18:45,
  Start over and Cancel. Final screenshots were opened and inspected; earlier
  Home/loading captures are retained and are not detail evidence.
- The Android old-query retry edge was reproduced using the actual rendered
  keyboard and Retry callbacks during debounce. Failed `jesus`, edited `jesusb`
  sent `[jesus, jesusb]`. Binding the existing current-field submit callback
  yielded only `[jesusb]` in a SearchScreen-scoped callback retest. This is live
  callback-driven evidence, not a physical remote timing study.
- Native topic actions now omit exact trim/case-insensitive duplicates of
  displayed recents while retaining original topic IDs. The final retry caption
  is shortened to Search unavailable so it fits its action tile.
- The expected injected-error Debug LogBox banner was acknowledged through its
  existing clear action for the clean native retry screenshot. The original
  banner screenshot and failure logs are retained; no product error state or
  logging configuration was changed.
- Source-string wiring assertions added during the pass were removed. Meaningful
  hook/state regressions and actual native before/after recovery evidence remain.

## Performance observations

Apple: three alternating warmed Debug Home observations gave baseline
2.650/2.576/2.741 seconds and candidate 2.685/2.748/2.735 seconds. Paired differences
were +0.036/+0.171/-0.006 seconds, within the predeclared max(10%, 200 ms)
observation bound. This is simulator launch-to-existing-action evidence, not
physical-device or release equivalence.

Android: the first Search-mount root-commit diagnostic used different non-token
TV configuration flags and showed slower candidate samples. Retain all results;
no code cause is inferred. Auto-fitting is now limited to the Search action,
where the longer word needs it; other keys retain their original text sizing.
An exact baseline TV env copy and own-Metro restart preceded a final three-pair
comparison. Baseline root-commit totals were 781.9/788.5/654.8 ms; candidate
855.7/427.6/1123.0 ms, with +73.8/-361.0/+468.2 ms paired differences. The single
large candidate observation is retained. No repeated violation of the
predeclared max(10%, 10 ms) diagnostic bound occurred; medians were 781.9 and
855.7 ms (+9.4%).

These values sum one React-root actualDuration per commit during a nominal
2-second Search-mount window; they include variable background commits and are
not isolated CPU measurements. Window fetch counts were baseline 0/0/0 and
candidate 1/0/0, so exact request-count equality is not established. The custom
Android search network call graph is unchanged. Native Apple topic/retry
selections each issued one observed WatchSearch request. Do not turn this
bounded observation into a whole-startup or release-equivalence claim. The
historical strict startup gate remains tracked under feat-889.

## Final integration result

- Current main `8af6da18e` is merged; conflicts kept final Search behavior and
  main's prior plan/ticket889 publication record. Application source matches
  `327c57a1d`; later changes remove redundant label-only test assertions.
- Fresh post-merge harness:
  `apps/tv/test-results/development-harness/reviewed-shortlist-final-20261029-76a129f6-c1db-4c84-abb4-677c4dcdaf7d/`.
  Typecheck, lint, full TV Jest, formatting and acceptance pass. Runtime source
  digest: `9c1fa912f4f811e42179adc8c8088c5b892dbcf5cb878b8f058141e877029e98`.
- Final matched Apple Home pairs after explicit baseline warmup: baseline
  2.6443/2.6271/2.6664 seconds; candidate 2.6155/2.6347/2.6613 seconds. Paired
  differences -0.0288/+0.0076/-0.0051 seconds. Offline-baseline and expired-driver
  attempts remain unavailable setup evidence and are not comparison samples.
- The Android diagnostic counter is all global fetch calls, despite the legacy
  raw key `consumerRequests`. The summary names it `globalFetchCount`; no exact
  consumer-fanout equality or isolated CPU claim is made.
- Parent review accepts the bounded Android no-repeated-slowdown observation.
  Historical whole-startup equivalence remains open separately. Parent built a
  bundled universal QA APK, but packaged Release playback is unverified and the
  APK is not declared ready for installation. No physical Chromecast install.
- Source-only wiring tests and redundant label-only assertions were removed;
  state/hook regressions and native before/after evidence remain. No source
  changes weakened a failed test. The new branch remains local for review.

## Owner-reported Android Back follow-up

Feat-903 is repaired and verified at `d0377137`: one remote Back exits hidden
controls and a focused on-screen Back remains available past the hide timeout.
The new native QA build and 17 native unit tests pass; focused runtime proves both
reported paths and saved-position retention. See the validation report under
`docs/validation/tv-reviewed-shortlist-20261029/`. Merge remains on hold for the
separate sampled duplicated-frame investigation; earlier failures remain retained.
