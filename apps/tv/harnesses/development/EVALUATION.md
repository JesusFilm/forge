# TV harness evaluation

Evaluate the **harness implementation** separately from a **TV task executed through it**. Fixture success proves the helper's behavior; it does not prove a TV build, playback or release.

## Evaluate the helper

```bash
node --test apps/tv/harnesses/development/scripts/harness.test.mjs
```

Tests use temporary Git repositories and synthetic task/evidence files. Process-routing cases use a fake Corepack executable with explicit synthetic output. They perform no device resets, installs, network calls, uploads, credential changes or source cleanup. Only their own temporary fixture directories are removed.

| Case                                                           | Observable expected result                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Completed logic task                                           | Real helper commands/evaluation produce a passed report with command results and named evidence judge |
| Existing unrelated dirt                                        | Preserved bytes do not fail scope; changing those bytes fails scope                                   |
| New outside-scope edit, deletion or commit                     | Failed scope gate; no automatic revert                                                                |
| Changed source after passing checks                            | Prior results are blocked as stale; rerun is required                                                 |
| Changed documentation after format check                       | Formatting result becomes stale independently of runtime source                                       |
| Missing runtime evidence or wrong device                       | Required gate is not-run/blocked; overall result cannot pass                                          |
| Manual record pretending to be a unit result                   | Cannot replace a required command-exit result                                                         |
| Evidence file absent, empty, escaping the run or changed later | Rejected/blocked/failed; never silently accepted                                                      |
| Low disk, wrong TV target or unauthorized Android device       | Blocked preflight before a native action                                                              |
| Command-like objective or path traversal                       | Text never executes; unsafe paths fail before writes outside the run                                  |
| Secret-like child output                                       | Raw output is absent from checkpoints/reports                                                         |
| Repeat failed check                                            | Initial attempt plus two repairs maximum; further attempts are blocked                                |
| Resume unchanged passing inputs                                | No redundant command execution; source/instructions and live prerequisites are rechecked              |

Oversized JSON input is also rejected before loading the payload or creating run state; artifact hashing uses a bounded buffer.

## Evaluate a TV task

`evaluate` requires all mandatory gates. `failed` dominates; any blocked or not-run gate prevents a passed result. Machine gates are scope, instruction consistency, live preflight and recorded static command outcomes. Runtime, performance, native-build and task-specific behavior are **judge attestations** with source digest, exact target, observations and existing nonempty evidence files. Evidence hashes are pinned on first evaluation; retain old evidence and use a new filename for a retest.

The evaluator checks records and artifact integrity. The human or agent named in `judge` must actually inspect them; filenames, screenshots of controls and process exit alone do not establish the claimed behavior. Do not supply a passed attestation for an unobserved case.

| Runtime case         | Required observation and evidence                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup              | Cold and warm entry reach Home; intended startup effect completes; one loader; focus is visible. Compare timing against a suitable baseline.                            |
| Search Back          | Open search, enter a query, press remote Back and observe the expected previous page without exiting the app.                                                           |
| Playback             | Show distinct moving frames and advancing time, test pause/play and remote Back. Confirm the intended native/React player and listen separately when audio is in scope. |
| Saved progress       | Record a real initial position, leave, resume and compare the resulting position; do not inject fake watch history.                                                     |
| Audio/subtitles      | Separate menus, alphabetical choices and typed search; change audio while retaining position and inspect actual rendered subtitles.                                     |
| My List              | Save/remove the requested item and verify state after navigation/relaunch as applicable.                                                                                |
| Feedback             | Open QR from affected pages/players, preserve Back destination; prove phone form/upload only within authorized scope. Report test submissions separately.               |
| Apple Top Shelf      | Show eligible system Home content, focus actual Play/More Info controls, verify cold/warm destinations and real resume. Check app/extension version parity.             |
| Google Home          | Validate SDK availability/metadata and actual launcher placement independently; a successful API call is insufficient.                                                  |
| Native build         | Record tool output, exact build/source/target identity and artifact path; simulator/development/store signing are separate outcomes.                                    |
| Missing prerequisite | Retain the failure evidence, mark blocked and identify the missing tool/device/credential/space; never convert it to passed.                                            |

For visual/design tasks, the judge records three anchored assessments in the attached review: **0** = missing/unusable, **1** = visible but materially wrong, **2** = matches the required behavior/design. Assess remote focus/navigation, legibility/layout, and loading/error/recovery. Each required dimension must reach 2; this score cannot override a failed deterministic gate. Compare against the relevant Figma design where applicable.

## Report and delivery

The helper records Git HEAD, source/harness digests, Node and pinned package-manager versions, declared model, check durations, repair counts, statuses, judge and evidence hashes. Include Xcode/ADB/OS versions and build identifiers in the runtime evidence document. Redact tokens, account identifiers and private payloads before attaching logs.

State fixture results, live command results and runtime verification separately. Report every unavailable required gate as blocked/not-run. A passed TV development run does not authorize merging or releasing it.
