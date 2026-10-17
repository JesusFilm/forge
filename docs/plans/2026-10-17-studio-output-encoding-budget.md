# Bound complete Studio encoding

Scope: feat-723, the contained worker's encoder policy and its actual codec
regression. Keep Admin/Manager contracts, v3, all physical resource limits and
historical data unchanged. Continue full-project acceptance tracked by
feat-715/716/721/722 after the new immutable worker release.

## Evidence and policy

Attempt `cmvbw60hs0001ru937n8zmbhf` delivers complete input in 76.342s and
streams frames, but 746 of 8856 frames already produce 25.4MB. Its medium
encoder consumes about 405MiB anonymous RSS when the aggregate cgroup OOM kills
Chromium at 04:31:19Z. Do not infer that removing JPEG files alone fixes memory.

Use the actual composition duration to budget target bitrate, maximum rate and
two seconds of VBV capacity before streaming starts. Preserve the SDK's existing
320kbps AAC fidelity explicitly. Reserve 16MiB for muxing and rate variation,
round rates downward and refuse infeasible/nonfinite durations. Use `veryfast`
to reduce encoder work and lookahead memory. Retain the final physical byte check
and independent full-decode verifier; VBV is not an exact output-size proof.

Trace browser/compositor cache allocation before adding cache controls. A control
that does not apply to Studio's OffthreadVideo path is not an OOM correction.

The applicable offthread cache is already 32MiB. The SDK additionally forces
Chromium's compositor tile allowance to 4096MiB. In pinned Chromium 149.0.7790.0,
`GetGpuMemoryPolicy()` directly uses that value; it feeds tile/resource-pool
limits for software compositing too. Replace that single argument with 256MiB
in the trusted launcher, preserving the backend and other enabled features.
This bounds the tile policy, not total RSS or the separate image decode cache.
Do not add `mediaCacheSizeInBytes`, which applies to different components.

Primary source:
[tile policy](https://github.com/chromium/chromium/blob/149.0.7790.0/third_party/blink/renderer/platform/widget/compositing/layer_tree_settings.cc),
[software resource pool](https://github.com/chromium/chromium/blob/149.0.7790.0/cc/trees/layer_tree_host_impl.cc),
[separate decode budget](https://github.com/chromium/chromium/blob/149.0.7790.0/cc/tiles/image_decode_cache_utils.cc).

Measured with the same 90-frame detailed 1080×1920 fixture and fixed thread/rate
arguments: medium takes 11.45s and peaks at 474.3MiB RSS; veryfast takes 6.87s
and peaks at 269.6MiB. This supports the encoder choice but does not prove full
aggregate safety. Acceptance must pass the old OOM point and final mux with
memory observations and a complete independently decoded retained result.

## Implementation and verification

Keep policy inline in `apps/studio-render/src/child.mjs` so the existing immutable
child artifact and namespace bindings stay sufficient. Pass encoding options to
`renderMedia` so they reach the streaming pre-stitcher. Preserve final stream-copy
muxing, all frames/dimensions/FPS, complete audio and single-thread overrides.

Exercise the actual child options and installed SDK pre-stitch/final-copy paths.
Use a detailed moving native codec fixture to verify complete H264/AAC, dimensions,
frame count, full decode and bounded bytes; demonstrate that the old default
exceeds its fixture allowance. Measure preset elapsed time and peak RSS without
host-dependent timing assertions. Run worker suite/build, formatting and required
PR CI. Merge normally, publish CI-built main worker artifacts, acquire and select
the exact candidate while drained, then activate with the already matching v3
applications. Require a fresh full revision-21 codec proof and retained output
before closing the tickets.
