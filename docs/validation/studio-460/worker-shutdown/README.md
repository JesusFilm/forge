> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Retained worker bounded shutdown

Fixed review base `0cbddfd2e494b010a38c887b56f4e787eeeace7f` (root equivalent `a144ac95`). Feature460 remains in progress; this change does not resolve the separate generated-code renderer proc boundary or authorize external operations.

## Diagnosis

The unchanged worker image20854aca started directly as Node PID1. Idle health passed, exact host PID/starttime/namespaces/cgroup were captured, and a persistent trace observed TERM. It remained alive after five seconds. The same baked worker as a non-PID1 child exited in about51ms; the same image with a diagnostic explicit PID1 handler exited in about50ms. `worker-lifecycle-command-comparison.json` retains exact controlled command differences. The diagnostic unconditional exit is not the production implementation.

Node22.22.3's SignalExit resets stdio and re-raises its signal; its registration resets the handler. The recorded caught-signal mask loses the TERM bit. Combined with the controlled comparisons, this identifies default signal behavior of namespace PID1, rather than wrong delivery or active-job drain, as the idle failure. See `worker-lifecycle-diagnosis.md` for primary source and harness qualifications. The failed idle process was manually removed; this is not automatic retirement proof.

## Implementation

The production server now owns its queue, HTTP handlers, listener and one idempotent signal-driven shutdown. TERM/INT immediately stop readiness and admission; artifact mutations preserve authentication and are refused both before body processing and immediately before storage writes. Server closure does not replace handler settlement: a disconnected client can still own pending work. Existing authenticated terminal reads do not extend grace.

One absolute five-second service grace covers queue cancellation, actual executor cleanup and HTTP closure/handler settlement. Queued successors cannot start; late success cannot overwrite cancellation. Repeated signals and synchronous abort-listener reentry share the original lifetime. The result is `drained`, `deadline-exceeded` or `failed`; unsuccessful drain exits nonzero. In-memory receipts remain in-memory, and no interrupted operation is described as successful.

Ordinary per-job cancellation/deadline also receives a bounded five-second cleanup window. Late browser opening, raced bundling/selection/encoding, browser closure, legacy rollback and temporary-directory cleanup remain owned. Remotion receives cancellation through its native cancel signal. Unconfirmed or rejected cleanup produces typed cleanup_failed, permanently closes queue admission before pumping, and causes unsuccessful service retirement without another grace. An already-running service shutdown deadline wins. Cooperative normal cancellation remains reusable. Immutable workspace artifacts are never deleted by legacy rollback.

## Failure-first and source validation

- Initial lifecycle tests fail against the baseline's absent shutdown interfaces.
- Synchronous abort-listener reentry originally created a second shutdown promise; red/green preserves shared identity.
- Late browser cleanup and disconnected HTTP handler tests reproduced premature settlement.
- `worker-never-open-unbounded-red.log` is a controlled replay of the preceding unbounded-await behavior by temporarily replacing only the cleanup helper with `await operation`; the final helper was restored. It is not the historical base commit.
- Rollback red confirms a hanging delete outside finally bypassed the cleanup window. The same log's raced-bundle case passed and is not represented as a failure. Final coverage separately asserts late-bundle settlement ownership.
- Final package suite:165 tests in18 files; typecheck and package lint pass. Network guard self-test rejects shared Redis/Postgres/external targets and permits only listeners opened by the test process; final suite uses this guard, empty inherited environment and owned TMPDIR. Earlier tooling-resolution failures are retained outside the repo; no dependency upgrade was needed.

Independent Standards and Spec reviews are clear after the cleanup ownership findings were fixed. Exact-image results are recorded separately below when complete; source tests do not stand in for image acceptance.

## Exact image sequence

The first lifecycle image manifest `06528ade12a4a20f1e160f733637e2b8e693192aa986cdfc15559875a1f33c1c`, config `ab89b87b6f7ea625da5f96e60b98f9c878e88c6fecb338dc4ff226d7ceadc803`, includes the shutdown changes before the public-media path correction. Build logs preserve cached versus executed layers; sampled build executor membership is recorded separately. This is incremental image evidence, not a fresh replay of every cached layer.

- Idle PID1 health passed. Delivered runc TERM produced native `shutdown result=drained`; original host PID230710 and its own cgroup disappeared in44ms without manual cleanup.
- First active attempt reached rendering but the raw OCI harness lacked `/etc/hosts`; Node's compositor failed resolving localhost. Preserved as `worker-lifecycle-active-*`. Subsequent TERM drained in34ms after the job had failed, not active-shutdown proof. Its process sampler hit a transient ProcessLookupError and did not write membership JSON; the error is retained, and membership is not reconstructed.
- Second attempt used a task-owned read-only loopback hosts file, with the same image/masks/resources/private network. It exposed an actual404 at `/public/bg.mp4`. Preserved separately as `worker-lifecycle2-active-*`. Subsequent TERM drained in33ms after failure, again not active acceptance. The sampler completed and records16 observed processes.

The baked composition sets `remotion_staticBase = "/public"`, and its media uses Remotion `staticFile()`. The old prebundled path copied job assets to the bundle root. The narrow correction creates `public` under the **per-job copied bundle** and copies assets there; it never modifies the shared baked bundle or changes URL behavior. A failure-first public render-entry regression reproduces missing bg.mp4, then verifies copied index/bg/clip availability and shared-bundle preservation. All16 render tests and the affected typecheck pass; both independent reviews cleared the delta. A necessary affected-layer rebuild follows below.

Local fixture provenance: a generated25-second source test pattern with audio and3-second narration tones, canonical retained styles, and a readonly preload that seeds the baked local Storage API. No render/queue/signal/fetch override is used. The production server entrypoint, local source-ref resolution, actual FFmpeg/Chromium and queue are exercised. This is a local lifecycle fixture, not signed Workspace transfer or provider acceptance. Fixture hashes are retained; no bearer, secrets or runtime configuration environment is committed.

## Final corrected image and shutdown result

Final manifest `1faf3e0f99208c95a84cb0b307d8607a5464241c4da55f65b36398935c708add`, config `61a68e53bbe2b57902c3e32cc36cf28996f6add2c9869c23a76976e3606c4c74`; archive SHA is in `worker-lifecycle-public.oci.tar.sha256`. The same Dockerfile was rebuilt only as required by the asset-path correction; dependency/browser/baked-composition cached layers are explicit in the log. Extracted layer/config hashes were checked. Native server startup and actual FFmpeg/Remotion/Chromium execution qualify required runtime resolution despite previously retained packaging warnings.

Final idle host PID261216: health200, delivered TERM, native drained, PID and leaf gone in33ms. Final active host PID262613: actual portrait render reached5%, a second HTTP submission returned queued, then delivered TERM produced native drained in57ms. The queued ID never appears in `job_started`. All seven host cgroup members recorded immediately before TERM were subsequently absent; the leaf disappeared without manual fallback. Neither timed-out launcher completion nor a cancellation flag is used as retirement proof.

`worker-lifecycle3-active-membership.json` records actual process/thread cgroup membership, before/last-live/after controls and bounded ancestors. It contains18 PID/comm observations representing16 distinct namespace PIDs (two processes changed comm), and170 cumulative process/thread identities, **not simultaneous task counts**. Sampled Node, FFmpeg/ffprobe, Chromium and Remotion processes all belonged to the exact runtime leaf. Effective limits remained2CPU,2GiB,no swap,128tasks; no membership violations, OOM or pids-limit events were observed. Last-live memory peak was502,865,920 bytes; CPU usage22,292,028 microseconds with66 throttled periods. After retirement the leaf was absent. Sampling cannot enumerate arbitrarily short-lived children; inheritance and final whole-leaf removal complement the observations.

The first active sampler's transient disappearing-process exception is preserved; the final sampler handles that race and records its complete result. Original OCI masks/read-only paths, private network and capability settings were retained. The additional hosts file supplies loopback names only and remains read-only. No exposure changes or host-policy changes were used.

This proves bounded **idle and active cancellation cleanup** for the retained worker image and this local fixture. The interrupted video is intentionally not a successful full output; no full-video/codec/audio/production-transfer, Studio generated-code render, Railway or paid provider acceptance is inferred. Existing separate acceptance gates remain open. See [renderer decision brief](renderer-decision-brief.md) for the exact next architectural choice.
