# Rebuilt renderer image qualification

This is a local image build and execution check for the feat-548 release record.
No image was pushed, and no production service was deployed. The source snapshot
contained 193 files; every SHA-256 matched the integrated PR checkout, including
the pinned Remotion patch, lockfile and contained child configuration.

The `render-job` target was built from the reviewed Dockerfile with frozen pnpm
dependencies, native binaries, pinned Chromium and checksum-verified FFmpeg/FFprobe.
Its OCI manifest is
`sha256:dd5f705bf9b117c830f96669423e1027cd92c063be43a223ddc03bf90f2ef2ba`.
The image ran the original two-clip, narration-plus-music composition under a
local rootless `runc` probe. Its output was an 11,494,825-byte H.264/AAC MP4,
1080×1920, 30 fps, 300 frames, 10.048 seconds including audio. Output SHA-256
`1c9157776bf4fd61e94dff0388c2a22257317e854be8eeb4ea866bf502d55a14`
matched the earlier contained replay byte for byte. The pinned codec fully
decoded both streams.

The live process audit found the native guard as container PID 1 and authored
Node, Chromium and FFmpeg descendants in the same parent cgroup. Effective
limits were 2 CPUs, 2 GiB RAM, zero swap and 128 tasks; memory peaked at
1,762,459,648 bytes and process count at 109, without OOM or task-limit events.
Authored processes had no effective capabilities, `NoNewPrivs=1` and seccomp
active. This local host did not allow the nested child cgroup controller to be
created; the first attempt failed closed. The successful probe enforced the
unchanged limits in the verified ancestor scope. This is local OCI evidence,
not a Docker-default seccomp or deployed-VM acceptance result.

The separate `verify-job` OCI target was built from the same source snapshot.
Its manifest is
`sha256:25064ec19c95ebe394dd4fae338b450c9ff8d96a4d6730fc3c4427f8fa70f083`.
Both image exports were checked layer by layer against their SHA-256 manifests.
Running this verifier image under the same bounded local scope against the exact
rendered MP4 returned `decoded:true`, the matching output digest, 300 H.264
frames, 1080×1920 at 30 fps, and AAC at 48 kHz, two channels. This is an
independent image execution, not only a host-side `ffprobe` result.

The task-private build, source inventory, output and process audit are under
`/home/tataihono/.local/share/forge/shorts-agent-workflow/image-548-final/`.
These local manifests are evidence for this exact code and fixture. A normal
release still needs its own recorded image digests, hosted dedicated-VM admission,
network/cgroup policy, and authenticated client/operator smoke before enabling
production use.
