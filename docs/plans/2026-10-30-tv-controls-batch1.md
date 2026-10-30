# Watch TV controls and navigation — batch 1

Roadmap: feat-906. Base: `48ad42865`. Branch: `codex/tv-controls-batch1`.
Scope: TV-34, TV-12, TV-13, TV-19. Update Linear only after verified merge.

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

The owner explicitly replied **Approve this batch** on 30 October 2026. That
approval persists while the remaining verification is completed; no repeat
approval is required for these expected behaviors. Personal HTML checkboxes are
optional notes and do not determine implementation or approval status.

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
- TV-19 initially passed with an already-present Continue Watching row. A separate
  Android QA user with empty history exposed the condition: natural playback of
  the fourth Happy?: Trailer for 17/57 seconds created the first shelf; Back
  returned focus to the first card. The emulator reproduced wrong identity,
  without the physical report's clipping. Restoration now remembers section/card
  identity and horizontal offset, waits for shelf results and measured layout,
  and focuses the current registered node. Explicit activation and fresh remote
  input supersede pending restoration; Android releases do not cancel it.
  Another isolated user on the corrected canonical APK played 18/57 seconds,
  created a real new shelf, and retained the fourth card at its original viewport
  after Back and the later capture. Deep India end offset, subsequent navigation
  and Search return also passed. No history was injected or cleared.

Home `ac9952523` / `f647f8660` and native `d563d2666` are combined. Independent
Sol review rejected ignored activation and repaired stale key-timeout ownership
before integration.

## Current verification

Final Home JS passed Apple focused Details/Next dwell, rapid immediate matching
selection, lower Menu-to-Search, top platform exit, Search Back and native-player
ownership. Android-only Kotlin changes do not affect native Apple inputs. The
existing Debug client is identified by dylib SHA in the retained provenance and
served this checkout's JS; no packaged Release-JS claim is made for Apple.

Final `c084704df` warmed-Metro process launches using Details readiness measured
baseline 3.280/2.832/2.642 seconds and candidate 3.261/2.630/2.870. No paired
degradation exceeded max(10%, 200 ms). Cold bundling and an obsolete driver
readiness attempt remain excluded setup metrics. This bounded observation does
not close the historical strict startup gate in feat-889. The shared host also
had an unrelated test workload; no isolated-host guarantee is made.

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

The original Android screenshot/OCR and unmatched record-only comparisons
exceeded their observation bound. PNG capture overhead depended on artwork,
and actual APK inspection found different feedback configuration. Five early
control exports failed on workspace resolution; four full logs were overwritten,
with errors retained in the session and failure history. These limits remain
disclosed. Later worker exports passed source-map checks but fresh-user testing
found blank icons: external dependency paths changed generated asset lookup
identifiers. Those signed diagnostic APKs remain preserved and explicitly invalid
for release/performance certification.

The corrected final APK uses the original project's normal Expo/Hermes release
JS stage with unchanged tested native binaries. The old-Home control uses an
isolated dependency clone with the same relative layout. All 27 generated asset
registrations, hashes, numeric scales and native resource lookups match; source
maps and configuration functions identify only the intended Home differences.
Native compressed payloads, certificate, ABI coverage and alignment were verified.

Eight cold and six warm recordings completed with no observer/recorder limits.
Two cold warmups were excluded. All six measured cold captures show JESUS,
61 chapters, matching artwork/copy, rendered icons and Search focus. Old-to-final
branding-to-Details pairs were 1.701 to 1.175, 2.143 to 1.464 and 1.304 to 1.119
seconds; artwork and focus also had zero violations of max(10%, 1 second).
All encoded frames were inspected, retaining timestamp brackets and outliers.
Warm foreground entries were HOT without another Watch loader; intentional hero
rotation and the OS launcher crossfade prevent a controlled warm React-latency
claim. The native cold pair-three 1560 versus 918 ms outlier is recorded separately.
This scoped comparison supports no observed encoded Home slowdown at the declared
bound, not whole-startup or physical-device certification. Earlier failures remain
unchanged.

Final application source: `c084704df82275d20cb41ea61d7382ffc22c70a3`.
Valid canonical QA APK SHA-256:
`d6a31ea1f23e97edd789e7e74d7c544955d4fa9b066a2dd8a8118bf6595ae683`.
It was upgrade-installed with non-incremental delivery and data retained. Final
typecheck, full TV lint/Jest and touched-file formatting passed. The existing
layout-order guard was preserved by computing the pure measurement effect before
the single write, then suppressing scrolling while restoration is pending.

The owner authorized routine future cleanup of generated build caches without
another permission question. Every final tested/diagnostic APK, native product,
signing, source, report, recording and device snapshot remains preserved; only
unsigned/alignment build-stage caches and other rebuildable caches were removed.
Temporary QA users were stopped, and original user-zero history was independently
verified. Both native builds
started above 12 GiB free and stayed above the 2 GiB stop floor.

Finished shortlist and Home worktrees were archived with needed data preserved.
Archiving the earlier runner was refused because another active task uses it;
its original paths were restored. This batch uses an independent copy-on-write
native project and its own dependency installation.
