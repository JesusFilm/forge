---
title: "Compare the same full render before judging worker placement"
module: "studio-render"
category: "performance-issues"
problem_type: "performance_issue"
tags: [studio, rendering, performance, capacity, benchmarking]
date: "2026-10-19"
---

# Compare the same full render before judging worker placement

A faster renderer and an automatic VM lifecycle solve different problems. The
on-demand controller released resident RAM between jobs; it did not make an
individual render faster. A host-placement decision needs the same complete job
through canonical retention, with startup and independent verification included.

## Measured production comparison

Unchanged `widow-vertical-components-20261016`, draft revision21,8856 frames,
1080x1920/30fps,295.2s video. Both hosts use reviewed source
`b79a3bc3a8f7d1b0ab3a2238127e80ce6c5383fd`, the same two immutable published v4
images and host bundle
`b98e696bf1a698f6efe7d13d7d9b30799443cce5bda553d2f9155c24e9e84ec2`.
Execution caps remain24CPU/32GiB/4096tasks even though guest allocations differ.

| Host / startup    | Attempt                   | Render   | Verifier | Request to retained |
| ----------------- | ------------------------- | -------- | -------- | ------------------- |
| jfpai01 / warm    | cmvdhog9q0001noe562itdp43 | 241.990s | 28.411s  | 380.478s            |
| jfpai01 / cold    | cmvdn6d2y0001not28ojfrv0x | 245.773s | 28.654s  | 412.579s            |
| jfp00 / always on | cmvdqe8bm0001no0bc4biokrc | 652.040s | 83.974s  | 852.889s            |

All succeed with separately read-back retained digests and complete decoded frame
counts. Complete AAC matches the same reference. This is not a new pixel-parity
qualification or a latency percentile; it is a controlled-input comparison of
individual production runs. The comparison demonstrates a material speed
difference and corrects the earlier conversational inference that little speed
advantage had been established.

On the restored Proxmox worker, aggregate peak16.04GiB remains below32GiB,
with zero memory-limit/OOM events. The render consumes about15187 CPU-seconds
in652s, near its24CPU allowance, with negligible quota throttling. More guest
RAM alone is not supported as the remedy for this run's timing. CPU family,
clock, scheduling and renderer architecture need separate measurements before
assigning causality or changing resource limits.

## Current owner decision and future work

After reviewing this comparison, the owner selected always-on `forge-render-ai01`
on `jfpai01` in feat-732, superseding the temporary Proxmox placement in feat-731.
Keep the on-demand monitor removed. Preserve the successful long-render and
bounded-retention fixes. The AI VM uses 24 pinned vCPUs and 40GiB RAM.

The300s full-flow objective remains unmet in feat-725 on the selected worker.
Source preparation, transfer, verification and retention count toward it; a
295-second clip rendering in about242s does not itself meet a300s total target.
Host boot latency and deployment-gate waiting are separate measurements.

Exact handover and output identities are in
`docs/plans/2026-10-19-studio-always-on-ai.md`; the prior Proxmox record remains
`docs/plans/2026-10-19-studio-always-on-proxmox.md` and the checksum-verified
`forge-render-proxmox-setup` operator bundle. Main deployment gating is the
existing feat-728 follow-up, not authority to disable checks or force redeployment.
