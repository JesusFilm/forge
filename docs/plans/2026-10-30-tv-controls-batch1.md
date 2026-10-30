# Watch TV controls and navigation — batch 1

Roadmap: feat-906. Base: `48ad42865`. Branch: `codex/tv-controls-batch1`.
Scope: TV-34, TV-12, TV-13, TV-19. All four remain Todo in refreshed Linear.

## Execution ownership

Root owns baseline devices and native build operations. GPT-6.1 Sol coordinator
assigns separate native-player and Home workers after baseline reproduction.
Workers begin read-only and use isolated worktrees for implementation. The prior
Astra analyses are retained as context; all newly assigned agents use Sol.

Harness run:
`apps/tv/test-results/development-harness/tv-controls-batch1-20261030-bf4f8bbd-a608-4233-b627-956896503b50/`.
Android target: `emulator-5562`, AVD Codex_TV_Feedback_34. Apple target:
`EB58EEAD-0AD3-4EA4-B96E-F3CE887B39F6`, the available 4K tvOS simulator.

## Baseline and acceptance

- TV-34: record hidden/visible playing controls with OK and directions spaced
  about 0.5–1 second apart. Distinguish intended reveal behavior from loss of
  usable focus. Verify key pairing, scrub cancellation, pause/resume and Back.
  Preserve the documented first-OK reveal policy unless evidence and product
  intent justify changing it.
- TV-12: focused Details/Next title stays on the same title for 30 seconds.
  Leaving the hero allows rotation only while Home is active. Selection during
  a visual transition must match the presented film.
- TV-13: Back from a lower rail returns to the top and a visible useful target;
  top-level Back retains platform behavior. Detail/player/modal ownership stays
  distinct from Home Back handling.
- TV-19: record the exact card and rail offset before opening details, immediately
  on return and after shelf reload. Include Continue Watching insertion and
  clipping; do not infer the cause from a native node reference alone.
- Compare relevant cold/warm Home behavior, timing and network work on the same
  targets with matched content/configuration and declared observation bounds.

## Environment preparation

Native preflight initially failed the resource prerequisite: less than 3 GiB
free versus the repository's 12 GiB build budget. The owner explicitly approved
removing the 25 generated Xcode cache directories in the local proposal.
Cleanup completed with about 15.3 GiB free. Source, products, signing, recordings
and device data were preserved. Dependency versions were preserved while moving
the finished shortlist worktree's installation to this batch. Its evidence is
retained under the original checkout's
`.local-tools/completed-tv-reviewed-shortlist-20261030/`.

Start Android from a cold boot with snapshot memory loading disabled. Preserve
the existing user data. Verify the installed package, signing and clock before
judging playback. Earlier snapshot/capture instability remains tracked in
feat-904 and is not a reason to discard fresh application failures.

## Human checkpoint

After combined review and verification, publish a draft PR, tested QA build and
HTML report with screenshots, results and remaining limitations. Present three
to five exact test steps and the choices Approve this batch / Needs changes.
Wait for an explicit response. Approval is required before merging and before
implementing the next batch; silence is not approval. No physical Chromecast
installation, store upload or direct production deployment is authorized.

## Reproduction and repairs

Installed baseline APK SHA-256:
`8825c6672104f67320e31f39ab5d40d058751c44fea768a31dc899bcf181459b`.
Its TV application and dependency inputs match main `48ad42865`. Emulator clock
matched the host after cold boot; existing saved data was retained.

- TV-12 reproduced on Apple: Details stayed focused while a 32-second dwell
  changed JESUS to Stunned. Rotation now pauses for focused actions and inactive
  Home. Focused entry/manual paging presents artwork and copy together without
  replacing native action nodes or ignoring activation.
- TV-13 reproduced on Apple: lower Home Menu exited to the launcher. Attempt 1
  exposed missing native Menu ownership; attempt 2 claims it only while lower
  Home owns Back, releasing at top or blur. Both attempts remain retained.
- TV-34's historical repeated-OK failure was not reproduced with normal-paced
  inputs on JESUS, Who Makes You Happy?, or reentry. Two OK presses approximately
  0.8 seconds apart paused, and directions/seek worked. After explanation and a
  visual, the owner explicitly selected first-hidden-OK pause. Native Select now
  toggles once and owns the matching release/repeats across focus transfer.
  Error handling and visible child controls retain their behavior. This product
  decision is not batch merge approval.
- TV-19 was not reproduced in baseline cases on either target. Fourth Happy
  trailer detail/player return and deep horizontal card return preserved the
  selected card and placement. No new-row insertion was fabricated or proven.
  No speculative focus repair was made; the physical report remains open.

Home `ac9952523` / `f647f8660` and native `d563d2666` are combined. Independent
Sol review rejected ignored activation and repaired stale key-timeout ownership
before integration.

## Current verification

Final Home JS passed Apple focused Details/Next dwell, rapid immediate matching
selection, lower Menu-to-Search, top platform exit, Search Back and native-player
ownership. Android-only Kotlin changes do not affect native Apple inputs. The
existing Debug client is identified by dylib SHA in the retained provenance and
served this checkout's JS; no packaged Release-JS claim is made for Apple.

Three warmed-Metro process launches using Details readiness measured baseline
3.280/2.832/2.642 seconds and candidate 2.639/2.616/2.620. No repeated paired
degradation exceeded max(10%, 200 ms). Cold bundling and an obsolete driver
readiness attempt remain excluded setup metrics. This bounded observation does
not close the historical strict startup gate in feat-889.

Current harness typecheck, full TV lint/Jest and touched-file format passed.
The combined Android Release QA build succeeded with 20 native unit tests,
including three gesture sequence tests. Existing debug signing was verified;
ARMv7 and ARM64 core libraries are present. Source `d563d2666`, APK SHA-256:
`692cbaf447de183da8338acb5427cbed0acff3c11106a516a43d108a0a21b7f7`.
Upgrade install on `emulator-5562` succeeded with data retained. Packaged Android
pause/resume, shell longpress, seek commit/cancel, focused hero dwell, matching
selection, ambient rotation and Home Back passed. Real saved progress survived
exit/reentry at 4:39 and advanced to 4:40. Controlled 5-second network latency
provided a real loading window: Back returned to details with Play focused;
normal latency was restored. Earlier unobserved and recorder-timeout attempts
remain retained with their limits.

A fresh Apple Debug native build from this integration succeeded using Xcode
27.1 and the selected 4K simulator destination. Debug skips JS bundling: this is
native compilation proof, not a self-contained Release package. Before building,
two stale absolute paths in the copied generated Pods autolinking shell script
were rebased to this checkout. Project/lockfile inspection alone missed them.

The first Android screenshot/OCR performance metric exceeded its bound in two
pairs. PNG capture overhead depended on artwork completion. A separate
record-only comparison still exceeded its loader-to-Details bound in two pairs:
baseline 1.527/1.767/1.176 seconds versus candidate 2.985/1.227/2.237. Source
attribution remains unresolved. Actual APK inspection found matching GraphQL
endpoint/token, recommendation enablement and native executable code, but
different feedback configuration. A control export with current configuration
and only the two Home files restored to baseline was blocked by Metro resolving
workspace packages through the reused installation. No control APK or Hermes
bundle was produced. The capped failed attempts and exact preparation remain
retained. Repair the experiment's dependency resolution before another measured
comparison; no application optimization is justified by an assumed cause.
Preserve these failed measurements; no performance pass or merge readiness is
claimed. Human review of the implemented behavior can proceed while this remains
a merge blocker. TV-19's asynchronous insertion and physical case stay open.

The owner authorized routine future cleanup of generated TV build caches
without another permission question. Tested APK/native products, signing,
source, reports, recordings and device data remain preserved. Both native builds
started above 12 GiB free and stayed above the 2 GiB stop floor.

Finished shortlist and Home worktrees were archived with needed data preserved.
Archiving the earlier runner was refused because another active task uses it;
its original paths were restored. This batch uses an independent copy-on-write
native project and its own dependency installation.
