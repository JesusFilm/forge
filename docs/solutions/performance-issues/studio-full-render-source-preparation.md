---
module: Studio render source preparation
problem_type: performance_issue
tags: [studio, rendering, hls, source-duration, immutable-profiles, worker]
date: 2026-10-17
---

# Full Studio renders: measure the entire input path

Short exports succeeding does not prove a full project fits source preparation.
For `widow-vertical-components-20261016`, attempt
`cmvb5xwi2kzqtqa0syykg68c8` (revision 19) surfaced only “Render execution failed.”
Several independent full-project boundaries were hidden behind that diagnostic.

The catalog reported 426197ms while selected preview and exact export HLS ended
at 426166.67ms. The film trim ended at 426180ms, beyond the broker's final media
segment. Capture now measures both selected HLS renditions, floors their minimum
with the catalog bound, and pins the measured descriptor. Keep catalog eligibility
identity separate from measured duration. Reject incomplete, GAP or live playlists;
never infer available media from catalog metadata alone.

Repeated backgrounds required 158 segment uses / 273.10MiB against a 256MiB
preparation limit, although only 30 unique segment URLs / 51.43MiB were needed.
Reuse completed exact canonical downloads within one preparation and use stable
content names. Worker packaging deduplicates retained reads by full immutable
reference and files by verified digest while preserving every eligibility/proof
check and its separate 128MiB bound.

Successful complete codec verification can also be reused within a preparation
for identical ordered downloaded-byte digests, segment durations and expected
height under one fixed verifier configuration. Do not key only by source identity
or reuse rejected, aborted or cross-preparation verification. Range checks,
per-clip materialization and signed clip proofs still run separately.

After these corrections, staging took 80.177s in attempt
`cmvbom8yu0001lbo7l9xcnwn3`. Separate read-only packaging took 26.407s for
24 files / 47,716,903 bytes, with 133 broker RPCs. These were separate runs, so
their sum is an estimate, but packaging plainly cannot fit the remaining 9.8s
of a shared 90s window. Measure staging, packaging, serialization and transport;
a committed preparation row is not evidence that the worker received its input.

Profile v2 (`studio-render-2/1200s-180prep-2cpu-2g-128p-96child-128m`)
provides 180s preparation, a single 1200s cumulative job deadline and a 1500s
lease. Manager reserves 5s of the outer preparation window for response delivery.
CPU, memory, PID and byte limits are unchanged. VM transport, supervisor, native
watchdog and immutable release identity must change together. Persisted deadlines
are never reset on restart. Exact v1 descriptors remain readable for terminal
settlements; new execution requires the current profile. Database migration 0155
accepts retained v1/v2 assets only when the recorded profile matches the immutable
job snapshot and the producer/issued-lease checks pass.

The data correction uses a normal source capture and expected-revision authoring
command. Revision 21 replaces 17 handles and trims only the film endpoint to
426166ms, preserving all 8856 timeline frames and other edits. Historical revision
19/20 documents and the original failed attempt result keep their original hashes.
Never rewrite history or global catalog metadata to repair one project.

Production uses PR/main deployments and a CI-built immutable worker release.
Drain before application profile transition, verify exact main/run/artifact
identities, select inactive, then activate the matching existing configured worker.
Preserve prior releases, failed attempts and all assignment journals.

## Release evidence

Source-duration and transfer reuse: PR #2766, main
`90442e9f07f15efe5c662d6c9077cb04227c8b63`. Registration reuse: PR #2767,
main `b1a3913acd99e0aa6bc0bd64096dec5d282676a2`. Verified-sequence and
manifest reuse: PR #2768, main `674cd28d80058b41e906b0483d872e056f56c0ea`.

Versioned execution profile: PR #2770, main
`9cceb0bbd0eb7b49549c4a1eff57396158295ca6`. Hosted release
[38991905872](https://github.com/JesusFilm/forge/actions/runs/38991905872)
built and published that exact commit. Candidate SHA256:
`c018c1888aa464a6e3968f38408528025b0cdaf31499f2f2de13b8be7477664e`.
Selected host bundle SHA256:
`36a998365978344c4e0e29edd5856bd39ca0a8e78fc703aa34e0654b40ed1303`.
The host verified all members and preserved prior release/journal history.

After Admin deployment, a read-only transaction confirmed migration 0155,
current revision 21/DRAFT/unpublished, and unchanged historical hashes:
revision 19 `f1999b4644b18d59a450d909a497bf38`, revision 20
`360ca10db7020e9800682b9808da0b0e`, original failed attempt result
`d0ee7889359b129095322f5cd1bc9759`.

Both application services deployed the matching profile and the VM was activated.
Attempt `cmvbrelg10001o72n9zshopdp` committed preparation in 54.463s and entered
the render container 22.377s later. This confirms complete input delivery, which
the earlier attempts never reached. It does not establish a successful render.

At 02:29:31.678Z its ownership read returned 409 after 9005ms. Admin's delegated
read was aborted after 8879ms while the shared main database pool reported up to
92 waiting operations and acquisition waits over 15s. The VM correctly cancelled
and physically retired rendering before the original job deadline, without
entering codec verification. Canonical failure was admitted and remains intact.
Do not classify that control-plane timeout as a codec or source failure, reset
its deadline, or reuse its consumed assignment. See feat-721 for a separate
contention follow-up. A fresh measurement after recovery,
`cmvbs6eh70001o7woqorh0ive`, delivered input and started native rendering at
02:33:18.438Z. At 02:41:51Z it had accumulated 1602 JPEG frames / 188,666,432
bytes, while 17 remuxed source files separately occupied 247,200,184 bytes.
The SDK's parallel-encoding heuristic requires more than 2GB free after its
estimated allocation, so it cannot stream under the fixed 2GiB profile by default.
This attempt was cancelled through the normal expected-revision API after the
measurement; physical retirement and idle state were confirmed.

Feat-722 pairs a worker-only streaming opt-in with the existing single-thread
codec policy, awaits each encoder write and preserves other SDK consumers. This
keeps JPEG buffering independent of timeline length. The measured approximately
3.1fps is also much slower than the synthetic benchmark: roughly 49 minutes are
needed for the complete project plus input/verification at that observed rate.
V3 therefore versions the cumulative deadline to 3600s, request to 3620s and lease
to 3900s, with exact v1/v2 history retained. All physical resource caps and the
180s preparation window stay unchanged. This remains a capacity inference until
the complete project is independently decoded and retained.

Backpressure must reach the screenshot producer: the pinned SDK invokes
`onFrameBuffer` without awaiting its promise. Awaiting writes only inside that
callback would move JPEG accumulation into pending promises. Under the paired
worker opt-in, both SDK entry points await the callback at the producer boundary.
Regressions execute the installed producer and callback together, proving that
a delayed write blocks frame completion and write errors reject rendering.

Feat-721 gives render-worker RPCs a separate two-connection database pool with a
5s acquisition timeout and process-wide module-cache reuse. Ordinary and sync
requests retain their existing pools. A live capacity read before rollout showed
31 connections against PostgreSQL's 500-connection ceiling. Canonical authority
checks and fail-closed ownership monitoring remain unchanged; positive ownership
is not cached. A regression holds all ten main-pool connections while the real
assigned/context/claim ownership sequence completes on the isolated pool, then
cancels canonically and confirms prompt ownership refusal. Production verification of
these final corrections is pending.

## V3 release evidence

PR #2771 merged as `60a1eba4364c65ec0fc2153cc0ca58e703e77097`.
Installed-SDK producer/backpressure tests, worker tests/build, contracts and
Manager checks, Admin typechecks and PostgreSQL regressions passed. The PR CI
and CodeQL passed. Main CI initially failed in the Google-font resolver and an
unrelated recommendation integration assertion; both passed on normal retry.
Main CodeQL also passed.

Hosted release
[38998417347](https://github.com/JesusFilm/forge/actions/runs/38998417347)
built and published that exact main commit. Candidate SHA256:
`338125ed2907a4a078d4d1bf49b0f8d5860d02962e7edf3077ba6dcebd33b4e6`.
Host bundle SHA256:
`613f069ffcbb8e775ff3d9d06ca175167653872c32a671c3e31a6b001d51c2d3`.
The trusted host tools were updated from those exact reviewed main bytes with a
root-private backup; acquisition and inactive selection both completed.

Production Admin deployment `c6f24933-3028-4431-9315-0bae375d34ee` is healthy.
Read-only checks confirmed v3, completed migration 0156, the two-connection
render-control pool with its 5000ms acquisition bound, revision 21/DRAFT/
unpublished and the unchanged historical hashes listed above.

Railway left Manager's original main deployment skipped after the failed CI
attempt, despite the subsequent successful retry. PR #2772 added the missing
Manager release runbook and merged normally as
`203715cfcde7abf97e017edd17a7148d017ebaca`. Its fresh normal Manager deployment
is `7a23af83-b6b7-42e8-ad80-ac465e556aef` and became healthy with v3. The
matching VM candidate was activated and a fresh revision-21 attempt
`cmvbw60hs0001ru937n8zmbhf` delivered complete input in 76.342 seconds.
Ownership checks remained responsive and native streaming produced no
accumulated JPEG frames. At 04:31:19Z the host nevertheless recorded a 2GiB
cgroup OOM killing Chromium. The failed receipt and retired assignment remain
intact, and the worker was drained again.

Before failure, 746 of 8856 encoded frames consumed 25.4MB of the 128MiB
allowance. The default medium/CRF18 encoder also consumed about 405MiB anonymous
RSS. Streaming does not bound codec allocations or total output bytes; feat-723
adds duration-based rate control and measures encoder/browser memory before
repeating full-project acceptance. Do not infer complete rendering from a
published host candidate or a partial encoded stream.

## Encoding and tile-policy correction

PR #2773 merged as `893cf873c237ab9c1abe34cf17864b608147c2d9` after all
PR CI and CodeQL checks passed. Worker tests passed (82 passed, 10 existing
qualification skips), build, ESLint and the normal full-repository formatting
hook passed. It budgets H264 target/max/VBV rates from the complete duration,
keeps explicit 48kHz/320kbps AAC, selects `veryfast`, and replaces the SDK's
4096MiB compositor tile allowance with 256MiB in the trusted launcher.

The installed-SDK/native regression fully decodes 90 detailed 1080x1920 frames
and audible AAC within the derived envelope; default CRF18 exceeds it. With the
same rate/thread policy, medium peaks at 474.3MiB and takes 11.45s; veryfast
peaks at 269.6MiB and takes 6.87s. Those fixture measurements are not full-project
acceptance or an aggregate memory guarantee.

Hosted release [39004203386](https://github.com/JesusFilm/forge/actions/runs/39004203386)
publishes that exact main source. Candidate SHA256:
`f9fa6682f40c2f0acd4123ff8354b17fd07cc93254bea70b38365e2a7fb4a204`.
The unchanged host bundle is
`613f069ffcbb8e775ff3d9d06ca175167653872c32a671c3e31a6b001d51c2d3`;
the new render image is
`ghcr.io/jesusfilm/forge-studio-render@sha256:3fd98d60aef5f383ee80a73bc96e3d3e4ddc7cc945711712259db0a605fa41bd`.
Trusted acquisition and inactive selection completed, then the matching v3
worker was activated through the normal switcher.

Fresh revision-21 attempt `cmvbxfc1u0001ruk1njy8i0v7` leases at
04:58:56.811Z, commits preparation at 04:59:50.823Z (54.012s), delivers input
in 75.328s, and starts native rendering at 05:00:15.627Z. Live flags confirm
2558kbps target, 2843kbps maximum, 5686kb VBV, veryfast and the 256MiB tile
allowance. Final full-project codec proof and retained output remain pending.

## Duplicate remux allocation

The same diagnostic run reaches 4689 encoded frames and 49,807,408 video-only
bytes at 05:25:38Z without a cgroup limit event. Maximum sampled aggregate usage
is 2,100,133,888 bytes under the 2,147,483,648-byte cap. Temporary files reach
437,021,750 bytes as more sources are visited. This is capacity evidence, not a
completed codec or retained-output proof.

Read-only SHA256 comparisons establish seven exact copied remuxes totaling
93,483,312 bytes under the SDK's `remotion-assets-dir`; all 17 original remuxes
already occupy 247,200,184 bytes. The SDK retains downloads until final cleanup;
its 32MiB decoded-frame cache does not bound those complete source copies.

The diagnostic attempt was cancelled through the normal canonical command, then
the trusted switcher confirmed physical retirement and left the worker drained
and inactive. Preserve its CANCELLED result; do not relabel it as an OOM failure
or a successful full render. Feat-724 removes the second allocation with a narrow
paired worker-only resolver for generated remux paths, retaining native audio
analysis, cancellation and default SDK behavior for other consumers. Full
acceptance requires the next immutable worker release and a fresh complete run.
