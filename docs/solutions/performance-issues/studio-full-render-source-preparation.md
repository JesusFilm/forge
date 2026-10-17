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
