# Watch TV streaming UX implementation

Date: 2026-10-28. Ticket: feat-889. Integration branch: `codex/tv-streaming-ux`.
Base: current `origin/main` at `c46657d0f` (includes the simulator feedback work).

## Authorized scope and decisions

The owner selected four reviewed groups and requested agent implementation and
one combined branch. Preserve the independent English screenshot/checklist
request. Historical proposals about forcing first-result focus, rebuilding the
player, reducing hero size or adding arbitrary chapter numbers are excluded.
Compound Engineering commands are unavailable in this session; follow its
plan/work/review/compound loop using this plan and the existing TV harness.

## Work allocation

- Track A: investigate source/edition semantics of dub switching before fixing.
- Track B: Apple TV detail audio/subtitle search.
- Track C: Apple TV native search card metadata and accessibility.
- Track D: targeted detail/player readability and measured contrast.
- Parent: integration, English screenshot checklist, native verification and
  independent review. One controller per emulator/simulator; agents coordinate
  runtime access through the parent. Every worktree uses an explicit path.

## Acceptance

- A: evidence names the actual source/edition relationship and justifies any
  behavior change; paused/playing state and saved progress stay consistent.
- B: a viewer can search large language lists, select audio or subtitles, turn
  subtitles off, cancel, and return to the invoking control with visible focus.
- C: result title is not announced twice; Film/Episode/Segment information is
  readable where available; Siri/native keyboard and normal focus remain intact.
- D: title/synopsis remain readable over bright or text-heavy frames; the chosen
  audio language can be read in full without disrupting key player actions.
- Checklist: English, real labeled screenshots, initially unchecked selections,
  persistence after reload, and export/copy of selected items.

## Validation and integration

Record individual commits and checks below. Run checks against integrated source,
not only individual task branches. Use the existing 4K Apple simulator and Android
TV emulator, preserving installed data and build identity. Never count screenshots
as audio/interaction proof or a placeholder build script as a native build.

## Execution log

- Scope/ticket were created before implementation. All four tracks are now
  combined locally on `codex/tv-streaming-ux`; application-source HEAD is
  `702978c09`. The original main checkout and its existing edits were preserved.
- Track C: `32b079e6a` uses supported native search props to remove the duplicate
  title overlay and show readable content types. No dependency patch was needed.
- Track B: `402ab5f41` adds native searchable pre-play audio/subtitle pickers.
  Independent review found an ARC transition ownership gap; `183eaeaa1` retains
  the picker through bounded UIKit presentation/dismissal callbacks. The actual
  picker-class probe failed before and passed after, with ownership released.
- Track D: `38d108a5b` adds a detail-only copy scrim and a full selected-language
  focus caption. Measured focused-caption contrast improves 4.00 to 6.19:1;
  Android search placeholder improves 2.14 to 5.33:1. No global palette change.
- Track A: `723c6077e` confirms different JESUS editions and adds native
  Continue/Cancel before known cross-edition choices. `6100a1178` preserves the
  lean-query contract with structural identity-only AST checks.
- Integrated TV typecheck, lint, full Jest and formatting pass. Final native
  Debug builds pass for Apple TV simulator and Android TV ARM64. An additional
  ARMv7 Debug build passes for the physical Chromecast.

## Observed runtime acceptance

- Apple TV: one result title with content type; pre-play Thai search/selection;
  English subtitle selection and visible captions; no-match retains Off;
  cancellation and focus return; known cross-edition Cancel/Continue; same-edition
  no-warning; retained paused 10:40; original audio and Off restored.
- Android emulator: Home/search/detail; full focused audio label; resume/pause;
  warning Cancel preserves query/language/frame/time; Continue preserves paused
  timestamp; same-edition changes apply directly; actual English caption renders;
  return to the original search card. Preferences restored.
- Both targets remain on candidate Metro 8093 Home. Metro 8092 was preserved.
- Exact evidence is under
  `apps/tv/test-results/development-harness/streaming-ux-20261028-4ed0fdba-9368-4270-9a8f-eb43532ca0ad/`.

## Performance and verification limits

Apple launch-to-Home samples on one installed native client, warmed bundles and
preserved data have medians 2.613 s baseline and 2.606 s candidate. This is a
small simulator observation, not release or physical-device equivalence.

Android recording uses visible splash-to-Home milestones at 5 fps. The first
three pairs have equal 12.2 s medians but an unusually fast baseline sample. A
predeclared additional warmed set retains paired candidate-minus-baseline deltas
+1.0, -6.0 and +0.8 s. Across all six samples per source, medians are 11.6 s
baseline and 12.2 s candidate. All samples and separate ActivityManager timing
are retained. Complete native/development-launcher startup is excluded from the
video milestone metric. The result is inconclusive: do not declare the Android
performance gate passed or claim either equivalence or a confirmed regression.
The roadmap stays in progress for this remaining validation.

Audible sound and screen-reader speech were not checked; visible subtitles do
not establish speech synchronization. Timing-sensitive detail Back sometimes
needs another press, as already observed in the baseline review; see feat-749.
No production deployment, store upload, push or merge to main was performed.

## English review checklist

The owner-facing HTML is at
`/Users/up/Codex/Local/tv-app/apps/tv/test-results/ux-review-retest-2026-10-27/checklist.html`.
It has 20 English recommendations, real before/after screenshots, locally saved
checkboxes, shortlist filters, image enlargement, clipboard copy and text export.
Desktop/mobile, keyboard, persistence, clear/undo, export and clipboard checks
pass; the HTML is an ignored local review artifact, not application source.

## Chromecast delivery

The plugged Chromecast HD initially received the latest current-main development
build 1.0.0 (2), with populated Home and remote focus verified. The combined
integration ARMv7 APK is also built and signing/ABI verified, but the Chromecast
is now absent from ADB. The owner chose to leave its replacement APK ready for later; no further install
is required in this run. No uninstall or data clearing was attempted. The prepared APK is
`/Users/up/Codex/Local/tv-app/apps/tv/test-results/chromecast-install-2026-10-28/integrated/integrated-armeabi-v7a-debug.apk`.
It is a development client requiring the Mac and Metro connection.

## Publication follow-up — 2026-10-29

The owner authorized pushing and merging after errors are resolved. The original
feat-888 identifier was independently allocated on main to mobile release checks;
this TV ticket is now feat-889. Historical runtime and performance evidence is
retained. The Android performance gate remains open pending targeted verification
of the affected detail-loading path; no passing result is inferred from noisy
development-launcher startup samples.

### Targeted Android detail-load follow-up

The same Android 14 ARM64 emulator and installed native client ran three
alternating baseline/candidate pairs through the actual Hermes/Apollo path. Each
read used `GetVideoBySlug`, `locale: en`, `slug: jesus`, `fetchPolicy: no-cache`,
and returned 2,309 dubs. Each payload was normalized ten times from distinct raw
objects, outside the WeakMap cache. Runtime-only CDP probes restored the fetch
wrapper after each measurement; application source was unchanged.

| Measurement                                | Baseline                          | Candidate                         |
| ------------------------------------------ | --------------------------------- | --------------------------------- |
| Query durations                            | 1,189.68 / 1,932.51 / 1,597.39 ms | 1,259.66 / 1,301.23 / 2,981.25 ms |
| Fresh normalization median (30 per source) | 5.390 ms                          | 6.104 ms                          |
| Consumer requests per query                | 1 / 1 / 1                         | 1 / 1 / 1                         |
| Full decoded response                      | 1,247,888 bytes                   | 1,428,023 bytes                   |
| Full response, local gzip                  | 273,632 bytes                     | 276,560 bytes                     |

The added median normalization work is 0.715 ms. The slow third candidate query
spent 2,954.70 ms in transport; the remaining query work was 26.55 ms versus
25.23 ms for its paired baseline. There was no repeated query slowdown above
the predeclared max(10%, 200 ms) threshold. The full Apollo query adds 2,928
compressed bytes (1.070%); its `__typename` fields differ from the earlier
minimal payload experiment. The exploratory under-1% payload expectation was
**not met** by 0.070 percentage points and is not relabeled passed. Canonical
edition identity is required for the warning; no data is removed to fit that
exploratory expectation.

The primary agent and independent GPT-6.1 Sol coordinator consider this
satisfactory bounded evidence for the changed data path with a known payload
cost. It does not prove whole-startup equivalence or change the original
inconclusive startup result. The historical harness remains unpassed; no
checkpoint was edited to hide that result. Source/current-main TV files match
the earlier baseline and native-code build evidence remains applicable.

Raw plans, probes, all samples, and exact byte counts are retained beneath the
original harness `android-runtime/detail-perf-20261029/` directory.

### Publication checks

The branch was synchronized with `origin/main` at `23ac5d040`. TV typecheck,
ESLint with zero warnings, and all 192 Jest suites / 2,425 tests passed again.
Generated local Codex chat exports are excluded from formatting while their
contents are preserved. The shell account lacks repository write access; the
connected GitHub account has maintain/push access. PR #2954 was created through
that connection and its fetched tree was verified byte-identical to local
`65b1b0a637bc57a782683076049782fb55563aaf`. GitHub CI and the merge decision
remain separate from the historical startup/performance limitation.
