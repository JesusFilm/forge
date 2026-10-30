# Watch TV shortlist validation — 29 October 2026

Initial candidate application: `c19459c65`; comparison main: `c2f0a0e52`.
The owner's Android Back issue is repaired and verified at `d0377137` (feat-903).
The valid cold-runtime packaged comparison is complete; the earlier degraded
snapshot experiments are retained below and in feat-904. Main `786902d4d` is
integrated; its later changes affect no TV application or dependency inputs.
PR #2961 contains the combined work. GitHub is authoritative for final CI and
merge state; no physical-device or store-release certification is claimed.

## Static checks and review

An independent GPT-6 Astra reviewer found no actionable defect in the final
shortlist diff. After merging current main, TV strict lint (`--max-warnings=0`),
typecheck, all 194 Jest suites / 2,440 tests, and formatting of every PR file
passed. The merge hooks also passed full-repository formatting. Local Node was
24.22.0, one patch below the repository's 24.22.1; pinned pnpm was 9.12.3.

Exact commands and the audit of 27 earlier evidence artifacts are retained in
the integration worktree's `.local-tools/merge-readiness-review.json`.
The earlier development harness passed bounded native UI/performance checks;
it is historical evidence, not a new whole-source runtime certification.

## Packaged Android comparison

Both APKs were built from their recorded Git revisions using the same generated
native project, Release configuration, Hermes, ARM64 target, environment and
existing debug signing certificate. Every packaged native library matches
byte-for-byte. These are QA APKs, not store distribution builds.

| Build     | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| Main      | `a1d8b24265b6ca78079f3976034ba6161dd5d927840a5b2af30d5fdf83dbe127` |
| Candidate | `8e1f042af366a85511545542424528c38c79768a7ae4b174b4693f4b05d6a282` |

Target: Google TV ARM64 Android 14, `emulator-5562`. An emulator snapshot preserved
the same existing data/cache before each upgrade install. Both used JESUS,
English North American Indigenous, subtitles Off, and the existing 22:41 saved
position. Each observation window was 60 seconds. Recordings decoded successfully
at 60.050 and 60.007 seconds respectively; fresh screenshots were captured at
5, 15, 30 and 60 seconds. No UIAutomator hierarchy was used as playback proof.

- Both builds reached moving video within the observation window. Neither
  captured application log contains a playback exception, HTTP 503, decoder
  initialization failure or fatal application exception during that trial.
- Main paused at 24:04 without advancing across two captures, then advanced to
  24:09 after Play. Remote Back from visible controls returned to details.
- Candidate paused at 24:06 without advancing, then advanced to 24:12. Remote
  Back returned to details with Saved at 24:12; its chooser showed Resume from
  24:12, and selecting it subsequently reached moving playback at 24:18.
- Candidate's 30-second sample contains a rectangular duplicated/scaled video
  frame, also present in the decoded recording. Baseline sampled frames do not.
  Its exact driver/capture origin remains unresolved. The subsequent controlled
  cold-runtime comparison below separates it from a demonstrated app regression.
- The earlier HTTP 503, emulator decoder and preparation/failure captures remain
  retained. They were not reproduced in this first matched pair. No application
  fix or confirmed root cause is claimed from a successful retry alone.

Raw APKs, recordings, screenshots, scripts, logs and build comparison are retained
in the owned build worktree at
`/Users/up/.codex/worktrees/tv-streaming-ux/tv-app/.local-tools/merge-readiness-20261029/`.
The original unverified universal APK remains separately identified; the new
ARM64 result does not certify that older artifact or physical Chromecast playback.

## Android Back repair

The owner reported both exit paths. The agent reproduced hidden remote Back
only revealing controls and focused on-screen Back disappearing after 3.5 seconds.
The repair dismisses on one remote Back, consumes both key events, and keeps the
focused exit control visible. Scrub cancellation and dialog behavior remain.

The rebuilt Release QA APK has both ARMv7 and ARM64 libraries and preserves the
existing signing certificate. Its JavaScript is byte-identical to the earlier
candidate; only native Back behavior changed. Source `cd8e5dfbc` has the same Git
tree as integration `d0377137`. SHA-256:
`8825c6672104f67320e31f39ab5d40d058751c44fea768a31dc899bcf181459b`.

- 17 native unit tests and 16 relevant existing Jest checks passed.
- One remote Back from hidden controls returned to details; reentry offered the
  saved 27:08 position after the previous 26:49 start.
- During active playback, Back remained visibly focused while time advanced
  27:17 to 27:32 across a wait longer than six seconds. Select then returned to
  details with Play focused.
- An independent review confirmed scrub Back still cancels the preview before
  exit and native dialogs retain their own Back handling. Those paths were not
  newly exercised after this repair.

A later QA failure was traced to emulator clock drift after snapshot restoration:
OCSP certificate validation rejected an out-of-date response. Synchronizing the
emulator clock to the host restored playback with the same unchanged candidate;
certificate checks were never bypassed. This explains that specific later failure,
not every earlier HTTP 503 or decoder error.

## Cold-runtime comparison and retained environment failures

The restored-snapshot experiments later showed 20–27-second screenshot stalls
on both main and candidate. Those trials are retained as degraded environment
evidence, not valid matched-sampling proof. Neither a successful retry nor
identical native source alone was used to dismiss the observation.

The follow-up restored the same original user data, then cold-booted the actual
emulator with snapshot memory loading disabled and synchronized its clock.
Candidate ran first and unchanged main second, both starting from the observed
22:41 position with the same film, language, configuration and 60-second window.
Neither trial used screen recording. All 24 fresh screenshots were inspected,
including the corresponding film scene around the earlier anomaly. Each met
the five-second sampling schedule; maximum capture times were 0.915 and
0.944 seconds. Both showed normal full-frame playback without duplication.

A further cold-boot candidate control used the original 1280×720 recording size
without concurrent screenshots. Its 60.11-second video decoded successfully;
all 24 inspected frames, including every second from 18 through 36, were clean.
These results clear the packaged playback comparison in a valid environment.
They do not claim that an application fix repaired the old snapshot artifact,
nor identify its exact graphics-driver cause. Feat-904 retains that operational
observation for follow-up; feat-889 remains open for strict whole-startup work.
Cold-boot intervention and transient host load cannot be perfectly separated in
this local diagnosis; these are bounded observations, not a universal stability
or performance guarantee.

Formal evidence: `frame-artifact-assessment.json` in the build-workspace evidence
directory above, with 71 artifact hashes and exact timing/recording details.
SHA-256: `ebaeb0e11e81f92730ea9f07a845c252bc38f8131591d789819f16629d937496`.
The post-Back user state was restored and cold-booted; the final installed APK
matches `8825c667…1459b`, host/guest clock delta was zero, and details showed
Saved at 27:44. No physical Chromecast installation occurred.

## UI examples

Apple screenshots below come from the earlier native simulator checks of the
unchanged shortlist UI. Android examples come from the current packaged build.

![Apple TV recent searches and topics](apple-search-starting-points.png)

![Apple TV search retry after an injected failure](apple-search-retry.png)

![Android saved position after returning from playback](android-saved-progress.png)

![Android native resume choice](android-resume-chooser.png)

## Limits retained

Physical Chromecast installation is deferred. Audible playback, physical Siri,
screen-reader speech, and hour-plus saved-position live layout were not checked.
Bounded prior UI measurements do not close the strict whole-startup gate in
feat-889. Restart placement, hero height and unsupported metadata labels retain
their reviewed existing behavior.
