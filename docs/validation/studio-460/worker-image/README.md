# Retained devotional worker exact-image smoke

The unchanged reviewed worker Dockerfile at `bb6ed63f30b326f468fd7eb8cdf866a022db8ffe` built successfully with the same pinned local BuildKit0.33.0, ordinary OCI sandbox/native snapshotter and full subordinate mappings. No worker application, dependency or image recipe was changed. This evidence follows the separately reviewed codec/image qualification commit `258f786f97ab0fd27f9457ee2d06756d72a37729`.

## Result and limit

**Exact-image build, production-mode startup, seven HTTP checks, Node module resolution and real Chromium composition stills passed.** This is not full-video, output codec/audio, signed production workspace transfer, deployed Railway or provider acceptance. It does not resolve the separate Studio execution image's fresh-proc failure.

- OCI manifest: `sha256:20854aca5ebd7ad6f8335bc1b2396f309a5154a8ff89ea7caabc19b3a5d09961`.
- OCI config: `sha256:afc4a8985a8a30c1a1e6de06c20df23d467232dec337bbb7c273ad6265c1de04`.
- Archive digest: `worker-image-archive.sha256`. `unpack-worker-image.log` independently verifies each layer and config before extraction.
- Actual image entrypoint `docker-entrypoint.sh`, command `node dist/server.js`, working directory `/app/apps/shorts-worker`, Node22.22.3. Image default root user maps to the task's unprivileged host user; this trusted retained worker is not the generated-code execution service.

The image was started in its own user/PID/mount/network namespaces with the existing OCI masks/read-only paths, no effective capabilities, no_new_privs, readonly rootfs, bounded `/tmp`, and a read-only cgroup mount. **The first launch mounted the wrong cgroup and was not bounded by the intended controls**; `worker-oci-config-unbounded-sanitized.json` preserves it. The corrected second launch sets explicit cgroupsPath/resources and mounts its actual bounded leaf (`worker-oci-config-bounded-sanitized.json`). Both replace the task-only bearer in recorded config. All endpoint/S3 values are deliberately unusable local fixture values; no real account credentials were supplied. The private network has no external connection. The HTTP client enters only the owned network namespace. No source/provider/workspace request was submitted.

## HTTP and dependency evidence

`worker-http-smoke.json` and `.log` record: health200; unauthenticated job401; authenticated retired prepare400; authenticated retired render400; unknown retained job404; malformed devotional job400; health still200. These are actual server responses from the exported image, not an injected route implementation. They establish retained/retired admission behavior without claiming a successful devotional job.

`worker-module-smoke.log` records source-shipped schemas resolving outside node_modules at `/app/packages/devotional-workspace/src/index.ts` and `/app/packages/shorts-compositions/src/devotional/styles.ts`. Node's actual type stripping succeeds, both schema parsers are functions, and packaged Debian ffmpeg5.1.9 starts. The retained worker's Debian codec is separate from Studio's exact BtbN codec. Chromium discovers `devotional`1080×1920 and `devotional-wide`1920×1080, both30fps; both render PNGs from the baked bundle.

`worker-devotional.png` and `worker-devotional-wide.png` are from the first, incorrectly bounded run at frame120, showing the intro/date/logo/mute layout. They were visually inspected. Frame30 was also rendered (logo intro); `worker-module-intro-smoke.log` preserves that first success and its original PNGs remain in owned external evidence. This is composition-still qualification, not narration, source-video playback or complete card/content validation.

## Preserved qualification failures and budgets

The first still fixture omitted required `renderConfig`; Chromium correctly raised `/inputs/render/styles.json: render configuration is required`. `worker-module-fixture-red.log` preserves it. The corrected harness supplies the canonical repository `apps/mastra/devotional-workspace/inputs/render/styles.json` through inputProps. No image or application change was needed. An initial frame choice showed the logo intro; the final captured date frame is labeled precisely rather than represented as full content proof.

Configured build-driver scope profile:2CPU,2GiB, no swap,512tasks. Actual executor membership was not captured during this worker build; whole-build enforcement is unverified. Native snapshot copies took roughly50–144seconds; the build was allowed to finish without restart or changed limits. Preserve the existing npm audit/deprecation output in `worker-build.log`; no speculative dependency update was made. The first `worker-runtime-budget.json` describes the wrapper scope, not the image process, and cannot establish runtime bounds. Actual membership in `runtime-membership-red.json` demonstrates the unbounded sibling. The corrected second-run evidence is described below. There was no concurrent heavy renderer build or render.

The task-owned daemon was stopped after export. The harness requested a600second outer timeout, but the final process inventory found the older OCI Node instances still alive beyond it. That timeout is not demonstrated OCI retirement. These limits describe this local smoke, not the retained worker's production capacity or Studio's900second execution deadline.

## Corrected runtime membership observation

After the mismatch, the local OCI configuration set actual cgroupsPath plus2CPU/2GiB/no-swap/128task resources. The second startup and repeated seven HTTP checks passed. `worker-module-bounded.log` records actual namespace-relative self membership and limit reads before schema loading and the two still renders. `worker-membership-bounded.json` records host-side membership, ancestors, before/after events and24 sampled namespace processes, including Node and Chromium, with no sampled process outside the bounded leaf. Actual peak memory was341,512,192bytes; CPU usage was6,265,827microseconds; OOM and PID-limit events remained zero. Sampling is not a claim to observe every arbitrarily short-lived task; descendant enforcement follows the configured kernel ancestor and the readonly cgroup view, with no effective capabilities.

The second-run PNG files were created and sized but were not copied during that run. An earlier draft incorrectly inferred they were lost through timed cleanup. Final process inventory found Node108997 still alive and both PNGs accessible under its root; runtime-retirement-check.json preserves this correction. The second run proves the recorded module/still operations and sampled membership; the separately captured third-run PNGs provide independent bounded-run pixel inspection. The execution image's fresh-proc failure and final full feature acceptance remain open.

## Hook qualification for preceding code commit

The fresh worktree lacked Husky's generated launcher; the first unpublished commit attempt consequently did not execute hooks. It was replaced locally, not offered as the reviewed commit. Restoring the normal launcher then exposed missing fresh-worktree commitlint configuration after lint-staged and full formatting passed. The configuration was resolved from this task's existing owned tooling. `image-commit-hooks-final.log` preserves that rejected attempt; `image-commit-hooks-complete.log` records all normal hooks passing for the final `258f786f` commit. No hook bypass is accepted as validation.

## Reproduction and ownership

Harnesses are task-local examples tied to `/home/tataihono/.cache/forge-studio-460-image-runtime`; create new owned keys/storage/ports and substitute the actual owned cgroup leaf for another run. Do not reuse another task's active namespace or credential. The full OCI archive and unpacked rootfs remain outside git. The checked-in sanitized config is evidence, not a deploy-ready secret/config artifact. No push, upload, deployment, remote runner or paid provider operation occurred.

## Final bounded still capture

A third instance of the same immutable worker image repeated the seven HTTP cases and module/still operations with explicit actual cgroupsPath/resources and unchanged masks. `worker-oci-config-final-sanitized.json`, `worker-http-final.log`, and `worker-module-final.log` identify this run. Both frame120 PNGs were copied before cleanup: `worker-bounded-devotional.png` and `worker-bounded-devotional-wide.png`, with sizes/hashes in `worker-bounded-images.json`. Both were visually inspected and show the Dec25 date, logo and mute marker. This supplies bounded-run visual evidence without replacing the first-run images. The earlier missing-copy/assumed-loss explanation is corrected above.

`worker-membership-final.json` records 24 sampled processes and 219 process/thread identities, including Node and Chromium, all under the same actual bounded leaf with no sampled mismatch. Peak memory was329,633,792bytes and cumulative CPU usage6,603,432microseconds. CPU throttling occurred; OOM and PID-limit events remained zero. No full-video/audio/output-codec or production-transfer acceptance is inferred. This final small still capture overlapped renderer image packaging; it is not performance evidence.

The final monitor retained its old generic outside output filename. Its contents identify `studio460-worker-image3` and include thread observations; these were copied to the explicit final filename. The second-run record had already been preserved in this directory and remains unchanged. The final monitor script is retained verbatim to disclose this naming issue.

## Observed manual cleanup, not automatic retirement

`worker-before-manual-cleanup.json` preserves each exact old host PID, parent runc command, and membership. `runtime-retirement-check.json` records that all three remained alive; the first two were already beyond the requested outer timeout. Before cleanup, the accessible second-run images were copied as `worker-second-recovered-devotional.png` and `worker-second-recovered-devotional-wide.png`, with distinct provenance; they are not relabeled third-run images.

After explicit cleanup authorization, runc state confirmed each exact owned instance running. `worker-manual-cleanup.json` records a successful TERM delivery followed by a five-second wait for each; none exited in that interval. The fallback wrote only that verified owned instance's cgroup.kill. All three original host PIDs and cgroup leaves were then absent, with no remaining leaf members. This is bounded manual cleanup and a failed graceful-stop observation, not automatic timeout/retirement proof or a product fix. No sibling/shared process or cgroup was targeted. The retained worker's lifecycle acceptance remains limited accordingly.

Both independent fixed-base review axes read this final correction and found no remaining actionable issues. The first normal-hook attempt overlapped the final README correction and failed its full formatting check; no commit was created. The corrected document was formatted and the normal hooks rerun.
