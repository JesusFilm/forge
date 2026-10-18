# Studio five-minute end-to-end render qualification

Target: the complete repaired Widow revision-21 timeline (8856 frames,
1080x1920/30fps, complete AAC) finishes within 300 seconds from request to
independently verified retained output. Preserve authored components, source
identity, quality, offline execution, ownership/cancellation and original
immutable profile history. Feat-725 owns this work.

## Feedback loop

Use a read-only export of the successful attempt's prepared immutable source
bytes and component code. Execute only inside the existing credential-free local
namespace runner. Benchmark identical short frame ranges at concurrency 1, 2,
4 and 8, retaining measured elapsed time and complete output decode checks.
Local results guide architecture; they do not qualify a production profile.

The complete baseline is 53.710s preparation, 73.382s input delivery,
3111.433s rendering and 86.221s independent verification. A separate exact-byte
production retention qualification takes 26.299s. Their sum is a planning
baseline, not one measured uninterrupted end-to-end run. Five minutes requires
reducing overhead as well as increasing rendering throughput.

## Ranked hypotheses and discriminating measurements

1. Forced single-frame rendering limits throughput: compare identical frame
   ranges with only concurrency changed, recording memory/CPU and throughput.
2. Single-thread native extraction or screenshot surface copying dominates:
   compare source-free and real-source cases, then isolate decoder/screenshot
   changes without modifying production containment.
3. Repeated preparation/transport dominates the residual budget: measure a
   read-only retained-fixture export and packaging independently; qualify
   immutable verified-media reuse without renewing authority/deadlines.
4. Existing host cannot deliver the required throughput: use measured scaling
   and a fixed end-to-end stage budget to specify a concrete larger worker or
   distributed rendering proposal before any additional paid capacity.

## Implementation and acceptance

Choose the smallest measured change that can plausibly satisfy the complete
budget. Resource changes require a new exact immutable execution profile and
all host/native/application consumers updated together. Preserve streaming
backpressure, no duplicate media downloads and bounded output transport.

Before production release, run scope-appropriate contract/worker/consumer tests
and independent review, use normal PR/main and CI-built immutable artifacts,
and demonstrate a fresh complete verified/retained render under 300 seconds.
Do not claim a hard maximum from a short fixture or silently lower resolution,
frame rate, authored behavior or verification. Larger paid infrastructure needs
a concrete cost/capacity decision after benchmark results.

## Local diagnosis (2026-10-18, not production qualification)

### Important: initial Media samples fail appearance acceptance

Independent decode confirms codec, dimensions and audio streams, but comparison
against the verified production output reveals that the initial Media prototype
letterboxed source footage. The pinned Media component requires an explicit
`objectFit="cover"` prop; the existing Offthread `style.objectFit` is insufficient.
**All initial Media measurements above are diagnostic only and invalid for
capacity/acceptance comparisons with the production portrait render.** The
corrected prototype uses a separate bundle/result prefix. Every fixture focus
is centered; non-centered focus still requires separate behavioral qualification.
No production dependency/code change has been made.

The read-only fixture uses the successful revision-21 preparation and all
8856 frames, 17 video items and 60 component items. Source bytes were checked
against their admitted digests. Pinned production Chrome and codec binaries
were copied from the installed immutable image; no local code was deployed.
The local host has eight CPUs and about 60GiB RAM. Expanded local containment
permits eight CPUs and 512 tasks, with no credentials or external network;
these are diagnostic bounds, not a new approved execution profile.

| Experiment                                    | Frames | Frame-render time | Total isolated child time |
| --------------------------------------------- | -----: | ----------------: | ------------------------: |
| Existing decoder, concurrency 1               |     60 |           19.629s |                   23.060s |
| Existing decoder, concurrency 4               |    300 |           43.560s |                   46.746s |
| Existing decoder, concurrency 4, 512MiB cache |    300 |           42.511s |                   45.850s |
| Pinned Media decoder, concurrency 1           |    300 |           42.403s |                   45.947s |
| Pinned Media decoder, concurrency 4           |    300 |           33.140s |                   36.404s |

All table runs start at frame 450. The Media experiment uses version 4.0.475,
requires the new decoder without silent Offthread fallback, and serves the same
admitted remux bytes through range-capable private loopback HTTP. It retains
all original component items. It is a prototype, not a production dependency
change. The initial 60-frame Media probe accidentally excluded the film-look
component; exclude that probe from comparisons.

Four independent Media children each rendered 60 contiguous frames (450, 510,
570 and 630) concurrently: 240 frames completed in 18.621s, including each
child's startup/remux/encoding. This demonstrates some benefit from independent
children, but proves neither linear scaling nor the complete target. A second
sample spans the beginning, middle and ending to expose uneven scene cost.

The original 96-task native bound fails at concurrency 2 with codec thread
creation errors. Decoder threads 8 also exhaust the expanded 512-task bound.
Concurrency 8 and larger caches did not improve the existing decoder enough.
Changing a CPU quota without changing native affinity, task/memory limits and
application parallelism cannot establish a faster approved profile.

The full baseline is red: its measured render phase alone is 3111.433s, above
the entire 300s target. No short-sample result establishes a five-minute maximum.
Before release, independently decode complete candidate output and compare
authored appearance, clip boundaries, audio and timing. A distributed design
should render contiguous global frame ranges with original composition
duration and produce audio once; concatenating independently encoded AAC
segments can introduce priming/padding drift. Preserve one canonical assignment,
aggregate resource bounds and cancellation for every child.

### Ending scene and rejected shortcuts

Four parallel 120-frame Media samples at frames 450, 2700, 5400 and 8100
completed in 97.221s overall. Individual elapsed times were 25.924s, 25.209s,
25.255s and 97.064s. The last scene dominates; early-scene extrapolation is
unsafe. These were concurrent probes, so do not compare their times directly
against a sequential diagnostic as if only source code changed.

For the ending, a sequential diagnostic without grain completed 120 frames
in 48.839s; setting the blur radius to zero took 48.093s. The latter output
is byte-identical to the unmodified Media sample (SHA-256
`3789148c2528b14c01d8103bbfbd74935436c4357fb0d7823a8db4f5d83450dd`),
so the blur result does not establish an appearance-correct alternative.

A cached grain experiment used the Chinese remainder relationship to preserve
both pattern phases: translate the static 3px/4px background by
`(7 * frame) % 12` horizontally and `(5 * frame) % 12` vertically, with a
12px overscan and `will-change: transform`. Its output was byte-identical to
the unmodified ending sample, but took 89.538s. Do not promote it as a proven
speedup. Removing authored grain is a diagnostic only and is not acceptable
for the five-minute target. No candidate has qualified the full output.

### Corrected portrait probe

With explicit Media `objectFit="cover"` and the pinned renderer's `swangle`
backend, frames 8100–8129 take 18.982s end to end / 15.695s frame rendering.
A complete FFmpeg decode passes. The midpoint was visually compared with the
verified full production output and preserves the portrait crop in that frame.
This is only a single-frame appearance check, not complete equivalence or
capacity qualification. The sample is still below two rendered frames/second.

A larger benchmark host is needed to qualify independent-child scaling and
its complete preparation/delivery/verification/retention budget. The owner has
been asked whether to use existing host capacity or price a temporary cloud
worker. No additional paid capacity has been provisioned and no new execution
profile or production performance change has been deployed.

The corrected 300-frame early-scene probe at concurrency 4 with Media and
`swangle` takes 69.302s end to end / 66.049s frame rendering; its complete
FFmpeg decode passes. This is slower than the existing production decoder's
46.746s / 43.560s for the same range. Reject this paired change as a default
performance improvement. Neither the decoder nor backend has earned promotion
to production from these results. A 0.13s independent decode overlapped the
long probe near its end; this does not explain its approximately 22.6s deficit,
but retain that caveat rather than presenting an uncontended lab result.

## Existing VM capacity request (2026-10-18)

The owner can expand the existing VM. Request **32 vCPUs and 64GiB RAM** as
a qualification allocation, not a proven minimum or a five-minute guarantee.
CPU capacity must be available from the hypervisor rather than heavily
oversubscribed. Use bounded independent render children; increasing a single
renderer to 32-way concurrency has not demonstrated useful scaling. Plan an
initial aggregate budget of up to 28 CPUs / 48GiB, reserving four CPUs and
16GiB for the host/control services and headroom; qualify exact bounds before
creating a new immutable profile. Downsize only after full measurements.

Read-only VM inspection still reports four CPUs / 8063MiB RAM, with a 60GiB
virtual disk and approximately 32GiB free. Keep that disk for the initial
benchmark. This request changes neither the current 2-CPU/2GiB execution
profile nor production settings. Pair the eventual resize with reviewed
parallel-renderer/profile changes through normal PR/main and immutable release
flow. Preparation, delivery, verification and retention also need optimization
to leave a sufficient rendering budget inside 300 seconds.

## VM expanded and benchmark resumed (2026-10-18)

Owner expanded `forge-render-01` / Proxmox VM 109 to 32 vCPUs and 64GiB
configured memory. Guest inspection confirms 32 CPUs and 64295MiB RAM, with
32GiB disk space free. Supervisor is active/running with zero restarts and
exit status zero. The VM was restarted because full memory hotplug failed;
memory hotplug is now disabled and future memory changes require a restart.

Next discriminator: keep the production Offthread decoder and produce bounded
contiguous JPEG chunks in independent browser processes. Feed them in global
frame order to one continuous H264 encoder with stream backpressure; consume
and delete each completed chunk before advancing its worker's lookahead. Render
audio once for the complete timeline and mux once. This preserves the original
composition duration, avoids independently encoded AAC joins and retains the
global bitrate budget. Test offline in a temporary network-disabled container
while the normal supervisor is drained, then remove the benchmark container
and clear only the benchmark-owned drain. The selected production release,
canonical attempts and worker credentials are unchanged. Release code/profile
changes through normal PR/main only after measured performance and correctness.

### Resized VM: parallel-pool qualification in progress

The isolated full-timeline JPEG-pool prototype initially failed after 32.224s
with Chrome `ERR_INSUFFICIENT_RESOURCES`; Docker recorded no OOM kill. A repeat
with the same 8GiB `/tmp` reproduced it. Observed `/tmp` occupancy reached 92%
while process-limit events remained zero and memory was below the 48GiB cap.
Chrome uses `--disable-dev-shm-usage`, so the 8MiB `/dev/shm` mount was unused.
Most temporary space was held by unlinked Chrome mappings, rather than JPEGs.

Changing only the temporary-filesystem bound to 24GiB allowed that phase to
continue. First range consumed at 34.360s; frame1260 at81.974s and1860 at104.385s.
Observed peak memory21,282,504,704 bytes, no OOM/process-limit events, and about
27 CPU cores in use. These partial measurements **do not qualify the five-minute
target or a new production profile**. Keep the current production release until
complete timing and correctness evidence exists. Benchmark cleanup restores
both the benchmark-owned drain flag and the selected supervisor service (drain
is a clean process exit, so removing the flag alone does not restart it).

A separate input-stage regression test reproduced 34 repeated asset-metadata
reads for17clips sharing the same retained source. A preparation-local cache
reduces that to2asset metadata reads and1source metadata read while preserving
per-clip manifest/range validation, fresh eligibility resolution, byte digest
checks and transfer-grant behavior. Never reuse this cache across preparations.

The first full-pool design's video encoder completed its video-only file at
approximately 422 seconds (94,919,910 bytes); the separate audio-only Remotion
pass was still running. Stop this failed acceptance experiment at 472.379 seconds
rather than waiting for its 600-second guard. Exit 130 was operator cancellation,
not an OOM; no complete MP4 was emitted. Before cancellation, peak memory was
21,282,504,704 bytes, observed memory/PID-limit event counts were zero, and CPU
quota throttling totaled only 6,111 microseconds. A 10-second guest sample measured
80.97% busy, 0.1% steal and 0% I/O wait. Do not describe this as a successful full
render. Docker's archive API did not copy the tmpfs video file, so no video-only
artifact was retained.

Tighten the discriminator to frames 0–959 with full composition metadata. The
control (16 frame workers, 60 frames per chunk, two encoder threads and a separate
two-way audio render) completes in 112.303 seconds; its audio pass takes 111.461
seconds. Candidate collects each frame worker's audio metadata, merges it in
global frame order, uses the pinned SDK to encode one complete AAC track, and
increases the single continuous video encoder to eight threads. This 960-frame
candidate finishes in 44.581 seconds (video 43.201 seconds, audio 43.708 seconds
including video time). Complete independent decoding and frame counting pass:
960 frames, 1080x1920, 30fps, 48kHz stereo AAC. Extracted ADTS AAC is **byte-identical**
to the control:
`7e7678e8408b4baf42ecd79888e0df5f73914ba45174ad33793eb935d7ceb752`.
This includes the audible film scene starting at frame 606. These paired changes
establish candidate performance/correctness together, not separate attribution
of their speed gains.

The metadata-cache regression's 34-to-two asset metadata lookup count is a
synthetic 17-clip/shared-snapshot fixture. The repaired real document contains 11
distinct preview and 11 export manifest versions across 17 clips, so do not claim
that synthetic lookup reduction or a measured wall-time gain for this production
project.

### Complete resized-VM candidate result

The full 8,856-frame metadata-sharing candidate succeeds in **387.724 seconds**
(6 minutes 28 seconds). Video finishes at 382.772 seconds, audio at 385.859 seconds,
and the internal mux completes at 386.542 seconds. Output is 106,398,474 bytes,
SHA256 `abc4590f137d8b429f81ccc802bdbe3980b618430e369858e56fb31ed946aee6`.
Independent full frame counting and complete error-fatal decoding pass:
1080x1920, 30fps, all 8,856 frames, 295.2-second video, 48kHz stereo AAC. The
**complete AAC stream is byte-identical to the verified production reference**:
`3e23235b65ae98c7eb218cbd85028cab37b0b1b422ad1b6941da9aaee1786e44`.
Early and late visual samples preserve crop, typography and authored effects.

Kernel memory peak is 19,494,182,912 bytes (18.2GiB); sampled maximum tasks 1,814;
Docker reports no OOM kill. CPU time is 8,557.822481 CPU seconds with only 27,165
microseconds of quota throttling. Benchmark limits remain 28 CPUs / 48GiB /
4,096 tasks / 24GiB temporary filesystem, on the 32-vCPU / 64GiB VM. No benchmark
containers remain, its drain is cleared, and the unchanged selected production
supervisor is active/running with exit status zero and zero restarts.

This **fails** five-minute end-to-end acceptance before preparation, application
input transport, independent verification and canonical retention are counted.
Independent verification was performed separately after the timed execution.
No candidate output was written to canonical project data, and no new production
execution profile or release was selected. Preserve the benchmark artifact and
proof in the task's visualization directory as
`widow-r21-parallel-capacity-benchmark.mp4` and
`widow-r21-parallel-capacity-benchmark-proof.json`.

Next allocation to qualify: 64 vCPUs backed by spare physical host capacity,
retaining 64GiB RAM and the 60GiB disk. This is a benchmark allocation, **not** a
proven minimum or a five-minute guarantee. Pair extra CPUs with a larger bounded
frame pool and an exact new immutable profile through normal PR/main release.
Source preparation/input latency also needs improvement; repeating the serial
lookup/transport stages would consume too much of the 300-second budget even
with faster frame rendering. Asked the owner whether the Proxmox host has spare
physical CPU capacity; no answer is inferred from elapsed time.

### 64-vCPU allocation checked; larger pool fails qualification

After the owner reported the resize, SSH verification confirms 64 online CPUs,
one guest socket / 64 cores, about 62GiB usable RAM and 32GiB free on the 58GiB
root filesystem. Normal supervisor is active/running, zero restarts and zero
exit status; no drain or active render container was present before testing.
This confirms guest allocation, not exclusive physical host CPU entitlement.
The restart cleared `/tmp`, so the unchanged pinned fixture was staged again.

An offline full render with 32 frame processes, 60-CPU affinity/quota, 48GiB RAM,
8,192 task limit, 40GiB tmpfs and the same eight-thread continuous encoder fails
at 269.052 seconds with no output MP4. The underlying error at global frame
7,620 is the existing five-second `delayRender` deadline fetching the offthread
video proxy for `studio-source-13.mp4` at 19.8 seconds. Ordered consumption had
logged 7,260 frames at 258.500 seconds. Do not count elapsed time to failure as
successful throughput or claim five-minute qualification.

Kernel memory peak is 38,015,299,584 bytes (35.4GiB), observed tasks peak 3,741,
Docker OOMKilled is false, CPU usage is 10,962.063717 CPU seconds, and quota
throttling totals 3.244243 seconds. CPU samples reached about 58 cores. No evidence
from this run establishes RAM exhaustion or insufficient configured vCPUs as
the cause. Larger parallelism also increases contention and startup overhead;
isolate proxy fetch latency and bounded worker scheduling before requesting more
hardware. The original 16-worker result remains the last successful full render.

The benchmark container was removed, its owned drain cleared, and the unchanged
production supervisor restarted successfully. No selected worker execution
profile, canonical project data, or production release changed. Failure log and
metrics are retained locally under `/tmp/studio-five-minute/64-assetsfull.*` and
`64-assetsfull-result.json`; a summarized proof is saved in the task artifact
directory as `widow-r21-64cpu-capacity-failure-proof.json`.

### Frame-fetch timeout fix and full rerun

The pinned SDK derives its `delayRender` timeout from the child renderer's
`timeoutInMilliseconds` minus 2000ms. The hardcoded 7000ms setting therefore
allows only 5000ms for a retained video fetch. A deterministic regression runs
the actual child to capture that option, then the real installed SDK delay /
continue functions: a six-second completion reproduces cancellation before
the fix and succeeds after restoring the SDK's standard 30000ms frame timeout.
A stalled 30-second fetch still cancels. Native guard, host watchdog, aggregate
profile, original execution deadline and lease remain unchanged.

A second complete 32-process / 60-CPU benchmark changes only that renderer
option. It succeeds in **356.696 seconds**, emitting 106,381,240 bytes; video
finishes at 351.135 seconds, audio at 353.952 seconds, mux at 355.047 seconds.
All 8856 frames are reported, including the previous failing range. Memory peak
is 37,553,475,584 bytes (35.0GiB), sampled peak tasks 3750, CPU time 13109.115149
CPU seconds, zero quota throttling and no OOM kill. The single rerun demonstrates
full completion with the changed allowance, not a proof that contention was the
only source of the original latency or a guarantee against every future timeout.

This still fails the five-minute target on rendering alone. Preparation,
application transport, independent verification and canonical retention remain
outside this timed offline measurement. The benchmark container is removed,
owned drain cleared, normal supervisor active/running, exit zero and zero
restarts. No new production profile, project revision or selected release is
introduced. The narrow source fix and durable solution are on
`codex/studio-frame-fetch-timeout`; capacity qualification stays in progress.

Independent complete frame counting and error-fatal video/audio decoding pass:
8856 frames, 1080x1920 at 30fps, video duration 295.2s, 48kHz stereo AAC. The
entire extracted AAC stream remains byte-identical to the verified production
reference (`3e23235b65ae98c7eb218cbd85028cab37b0b1b422ad1b6941da9aaee1786e44`).
Output SHA256 is
`b911292f54a402af29c9936b53d7e82936b5cf3a87910e4ee2b2d75c9dbd4076`.
Local independent verification takes 62.997s separately; it is not part of the
VM's render timing and does not establish production end-to-end timing. The full
MP4 and proof are preserved in the task visualization directory as
`widow-r21-frame-timeout-fixed-benchmark.mp4` and
`widow-r21-frame-timeout-fixed-benchmark-proof.json`.

### Existing GPU host candidate: jfpai01

The owner offered existing `jfpai01` for the render workload. Tailscale-coordinated
SSH identifies an AMD Ryzen 9 9950X (16 physical / 32 logical CPUs), about 89GiB
usable system RAM with 72GiB initially available, and two NVIDIA RTX PRO 6000
Blackwell Workstation Edition GPUs with 97887MiB each. Driver is 615.71.09.
GPU 0 initially has 42197MiB free, GPU 1 10809MiB; existing model processes remain
resident and compute utilization samples are zero. Never infer reservation from
an idle sample or stop/reconfigure the existing AI services.

A read-only credential-free two-second 1080x1920/30fps capability probe runs the
same checksum-verified codec binary on GPU 0 under the existing pinned local
vLLM image, overriding its entrypoint. `h264_nvenc` succeeds. CPU and GPU startup /
encode measurements (512ms / 602ms) are too short and use different codecs, so
are capability observations, not evidence of a GPU speedup or equal quality.
Both temporary containers are removed and GPU memory returns to its prior level.

For full-project comparison, transfer the already-approved immutable production
render image directly from the current worker without registry credentials;
image identity remains
`sha256:94f52d9d6cd3b937f9ced832a432c1589ccf21e463df78f9abb799e0af17c775`.
No worker service, lease, endpoint/key or selected release is installed on this
host. Stage the unchanged immutable revision-21 fixture and benchmark-only
modules in `/tmp/forge-studio-gpu-probe-20261018`.

Compare CPU libx264 / veryfast with NVIDIA h264_nvenc / p4 while holding 16 frame
processes, ordered 60-frame chunks, complete audio metadata, full-duration bitrate
budget, 30s frame allowance and fixed SwiftShader drawing backend constant. This
isolates the candidate encoding paths, not GPU-accelerated browser drawing or
video decoding. Use 24 logical CPUs on cores 0–11 plus their SMT siblings 16–27,
leaving four physical cores outside the test; 40GiB aggregate RAM, zero swap,
4096 tasks and 24GiB tmpfs. Only the GPU variant receives GPU 0 and compute/video
libraries, with no graphics capability. Refuse startup below 56GiB available
host RAM or, for GPU, below 16GiB free VRAM / above 10% current compute use.
Each benchmark retains a 600s native deadline and independent 630s controller
bound; delete only its owned labeled container afterward. GPU/CPU comparison
still needs full decode, audio equality and encoded appearance acceptance.

The full same-host CPU baseline completes in **219.650 seconds** (3m39.650s),
106,362,961 bytes, exit zero, no OOM. Peak cgroup memory is 17,970,429,952
bytes (16.74GiB), peak sampled tasks 1755, CPU time 5005.325097 CPU seconds
(22.79 average CPUs). Quota throttling is 31,880 microseconds. All 8856 frames
and audio decode independently without errors, 1080x1920/30fps, AAC 48kHz stereo;
complete AAC SHA256 equals the verified production reference. Output SHA256 is
`cd8a81fff93def001df602de2ee81407b5c43b1d3e5d353b515553285c15cea6`.
Local independent verification takes 57.623 seconds separately. The CPU render
alone is about 38.4% faster than the 356.696-second VM benchmark, though that
cross-host comparison also changes process count and resource configuration.
It is not an isolated hardware-only CPU comparison or production end-to-end proof.
The task visualization directory retains `widow-r21-jfpai01-cpu.mp4` and
`widow-r21-jfpai01-cpu-proof.json`. No production worker is installed on the AI host.

The complete GPU-encoding variant finishes in **210.427 seconds** (3m30.427s),
107,070,839 bytes, exit zero, no OOM. Video completes at 208.294s, audio at
209.093s, mux at 209.346s. Peak cgroup memory is 17,963,855,872 bytes (16.73GiB),
peak sampled tasks 1763, CPU time 4766.172852 CPU seconds. Against the same-host
CPU baseline, NVENC saves 9.223 seconds (4.2%). This single sequential A/B run
supports a modest observed encoding benefit, not a stable performance guarantee;
cache/order effects are uncontrolled. CPU drawing/decoding remain unchanged, so
it does not measure GPU browser rendering. GPU 0 memory returns to 42197MiB free,
GPU 1 to 10809MiB; both owned test containers are removed and all existing AI
containers remain running. Production installation and full end-to-end timing
are still outstanding. The five-minute capacity ticket remains in progress.

Independent GPU-output verification passes complete error-fatal video/audio decode
and frame counting: all 8856 frames, 1080x1920/30fps, AAC 48kHz stereo; full AAC
is byte-identical to the verified production reference. Verification separately
takes 59.924s. Output SHA256 is
`5b309c04b205cf21dd8d6d0af084b92410842b979c4b98e0bf1d55ab6046f7b4`.
Preserved task artifacts are `widow-r21-jfpai01-gpu.mp4`,
`widow-r21-jfpai01-gpu-proof.json` and
`widow-r21-jfpai01-encoder-comparison.png`. Three downscaled timestamp samples
(15s, 254s, 286s) show readable matching overlays, but background source-frame
positions differ between variants. Exact temporal/quality equivalence is not
qualified; investigate before choosing the GPU output path for production.
Both measurements support the host as a capacity candidate, with CPU-only as
the simpler initial path. Neither establishes the full end-to-end five-minute SLA.

### Standby render VM on jfpai01 (owner authorized 2026-10-18)

The host is bare-metal Ubuntu 26.04, not Proxmox. `/dev/kvm` is available but
libvirt/QEMU administration is not installed; noninteractive sudo requires a
password. The Ubuntu `lxc version` launcher automatically installs Canonical's
LXD snap (6.9, revision 40916), then the existing user's `lxd` group grants its
normal supported VM-management API. No privileged-container host-root workaround
or host OS replacement is used. There are no pre-existing LXD instances/pools.

Created KVM VM `forge-render-ai01` under LXD, using pinned Ubuntu 24.04 image
`a80e9c9fd0d484dec024da3e9e264bbad4ce159b5312d6e149ef6ad532e18e43` (serial
20261017). Host CPU pinning `0-11,16-27` gives 24 logical CPUs on twelve physical
cores, excluding four host physical cores from the VM allocation (not exclusive
reservation of the chosen cores). Host-passthrough exposes Ryzen 9950X to guest;
40GiB configured RAM, 40,999,968KiB guest MemTotal; 60GiB virtual root disk,
about 58GiB filesystem. No GPU passthrough. Autostart stays false during standby
qualification. Own directory-backed LXD pool `forgerender` keeps the host's
existing filesystems, Docker volumes, model services and GPU drivers intact.

The initial dedicated NAT bridge can reach its gateway after a temporary static
address but fails DHCP and outbound TCP. Replace only the empty guest's adapter
with macvlan on `enp6s0`; do not alter AI host firewall rules. Remove the now-unused
owned `forgerender0` bridge. LAN DHCP issues guest `10.2.70.237/16`, gateway
10.2.0.1. Persisted MAC is the stable identity; IP is not reserved. Cloud-init's
first-boot ssh reload fails because the service is socket-activated; correct to
`reload-or-restart`, clean/reboot this still-empty guest, and confirm clean
`cloud-init status: done`. No job journals or worker identity exist in this guest.

Install Docker from its official signed Ubuntu repository after verifying key
fingerprint `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`. Current guest packages
recorded as Docker 29.9.1/containerd 2.4.2. Docker Unix socket is root:root 0600,
local logs bounded 10m x 3; no TCP socket; swap disabled. Forge user has key-only
SSH and sudo, with new dedicated private key retained only on the operator
workstation. Retrieve the SSH public host key via authenticated LXD agent and
pin it in `/home/tataihono/.ssh/forge-render-ai01-known-hosts`; direct SSH to the
LAN guest verifies hostname and sudo access. Both owned bootstrap files and
instance config are retained in host `/home/tataihono/forge-render-vm-setup`.

Reboot guest once and confirm Docker active/socket permissions and cloud-init
success. Preload the same approved immutable render image locally from host
Docker, credential-free; stage the unchanged revision-21 fixture and benchmark
modules. Qualify CPU-only prototype inside VM with 24 CPUs, 32GiB job RAM / no
swap, original 24GiB tmpfs, full native guard/controller bounds and output cap.
Do not run the prototype as a production release. Published v3 remains 2 CPU /
2GiB/serial; migration alone cannot deliver the prototype's throughput. Any
production promotion needs reviewed parallel-renderer/immutable-profile changes,
normal main/CI release, complete correctness and end-to-end timing. Original
worker remains active and the AI host's existing containers retain their uptimes.

The new VM's complete CPU-only prototype run succeeds in **242.995 seconds**
(4m02.995s), 106,317,283 bytes, exit zero and no OOM. Video completes at 241.031s,
audio 242.197s, mux 242.534s; peak cgroup RAM 18,102,882,304 bytes (16.86GiB),
peak sampled tasks 1767, CPU time 5484.723356 CPU seconds, 16,936 microseconds
quota throttling. This is 23.345 seconds slower than the direct-host CPU run;
it is one sequential observation, not an isolated virtualization overhead test.
The owned benchmark container is removed; guest Docker has no running containers.
All existing host AI containers retain nine-/eleven-day uptimes and free GPU
memory returns to 42197MiB / 10809MiB. Full independent output validation follows.

Reproducible provisioning script, Docker bootstrap, pinned public key, cloud-init,
expanded VM config and creation proof are preserved in the task visualization
subdirectory `forge-render-ai01-setup` with a SHA256SUMS manifest. The private key
is not in that bundle. Initial NAT failure and first-boot SSH ordering fix are
included in the operational history; the final recipe directly uses macvlan and
`reload-or-restart`. Guest boot and cloud-init are clean after reboot. No
production lease, token, supervisor, release policy or project data is changed.

Independent VM-output validation passes complete error-fatal video/audio decode
and frame counting: 8856 frames, 1080x1920/30fps, AAC 48kHz stereo. Entire AAC
SHA256 matches the verified production reference. Output SHA256 is
`d17165022490016d15539d2b0c354a5d3cf06b6ae65ba87cf158c719f8fa3d6a`.
Operator-side verification takes 56.283 seconds separately; it is excluded from
render timing. Artifacts `widow-r21-jfpai01-vm-cpu.mp4` and
`widow-r21-jfpai01-vm-cpu-proof.json` preserve bytes/results. Setup component is
complete as a standby VM; capacity ticket remains in progress for reviewed
parallel production profile, visual/temporal qualification, busy-host coexistence
and complete end-to-end deadline. No production cutover has occurred.

### Parallel CPU release and AI-host cutover (2026-10-18)

Owner requests the parallel worker release, removal of the old production
renderer from dispatch, and migration to jfpai01. Preserve the old VM and journals
for rollback; no destructive VM removal is requested. Timeout fix PR #2792 is
merged before this release. Release target becomes `forge-render-ai01`.

Implementation introduces immutable v4: 24 CPU / 32GiB / 4096 aggregate and
child tasks, unchanged cumulative 3600s execution and 128MiB output limits.
Retain v1/v2/v3 descriptors and explicit historical release selection. Only the
named render-job target receives the new compiled native entry and parallel
modules; legacy serial and separate verifier images retain original native
bounds. Aggregate systemd and Docker bounds match the shared descriptor.

Sixteen persistent frame workers each render one sixty-frame global range at a
time. Encode strictly in global order with bounded one-range-per-worker
lookahead and stream backpressure into one H.264 encoder. Stitch audio once from
all ordered frame metadata while browsers remain alive; mux one continuous AAC
track. Preserve complete-timeline bitrate budget, source remux reuse, frame
allowance, authored dimensions, native cancellation/watchdog and separate codec
verification. Worker, encoder and cleanup failures fail the job and close peers.

Focused verification: 48 contract tests and contract typecheck, 49 Manager
execution/gateway/retention tests, 50 Admin transfer/retention tests, 36 release
Python tests, 121 worker/native tests plus two startup tests pass. Ten existing
namespace-dependent integration tests skip outside their supported CI namespace.
Nine frame-pool tests cover bounds, order, backpressure, initialization and later
worker failure, idle death, encoder failure and cleanup. Actual native moving
1080p encoding verifies the unchanged bitrate cap for both child entry points.
Source-probe full render and visual/temporal checks remain a promotion gate,
followed by a fresh hosted immutable image qualification and canonical timing.

Gracefully drained old worker before profile deployment: all 92 retained polling
journals validate with zero unfinished assignments, no running containers,
service inactive, status drained, restart count zero. Preserve all old journals,
keys and installed artifacts. Provision the new VM inactive from hosted CI only,
transfer scoped private worker configuration over pinned SSH without logging
secrets, verify Manager/Admin current profile readiness, then explicitly activate
only the AI-host worker. Enable guest/service boot startup after cutover. Complete
end-to-end <=300s remains separate from measured render-only improvement.

Full production-source offline qualification inside the AI guest passes in
241.565s (4m01.565s), 106,378,021 bytes, no OOM, peak RAM 17,787,072,512 bytes
(16.57GiB), sampled peak tasks1773. Independent full decode counts all8856
1080x1920/30fps frames, AAC48kHz stereo; complete AAC SHA256 equals production
reference. Video SHA256 `597eb0c3a1155e2647c94271b3a2eca31c64b36ea731dba620ee974c70cf97a9`.
Separate operator verification takes66.326s; excluded from render timing. All8856
same-timestamp frames compared with the serial production reference at108x192
grayscale: meanSSIM0.996429. Two near-black fade frames below0.95 (minimum0.850914)
were inspected directly; overlays/background align. This is a lossy scaled visual
comparison, not pixel identity or exhaustive authored-code correctness proof.
Retain exact source output/proofs in task artifacts `widow-r21-parallel-release-source*`.

Review catches serial HTTP image advertising the shared current profile despite
its retained2CPU native bounds. Pin that executor and its signed admission schema
to immutablev3; keep v4 admission exclusive to the new VM path. Share inventory
validation through a local schema factory; test mutual profile rejection. Manager's
current-profile gateway is included in the normal source deployment. Admin's
checked-in Railway watch patterns now include studio-contracts, so this shared
execution contract triggers a normal Admin main deployment. Manager currently
uses dashboard watch patterns; its gateway source comment also triggers this
release's normal deployment, without changing its build system or live settings.
