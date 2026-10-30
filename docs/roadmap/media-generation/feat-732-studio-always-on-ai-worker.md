---
id: "feat-732"
title: "Restore faster AI host as always-on Studio worker"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, infrastructure]
---

## Scope

Owner reverses feat-731 placement after measured full-flow comparison. Run
`forge-render-ai01` continuously on `jfpai01`, with VM autostart and supervisor
boot startup. Keep the monitor, demand endpoint and demand key removed. Preserve
the exact reviewed v4 parallel renderer, bounds, data fixes and all journals.

## Execution and verification

Boot the persistently disabled AI guest first. Verify immutable release bytes,
images and completed assignments. Drain the original Proxmox worker through
`apps/studio-render/ops/switch-supervisor.py`, verify physical retirement, disable
its configuration and boot service before activating the AI worker. Preserve the
logical `forge-proxmox` / `forge-render-1` identity and all leases. Restore future
release target `forge-render-ai01` only if this matches the existing approved
AI policy/candidate; verify exact target before editing. Update current operator
guidance and supersede the previous host-placement record. Use normal PR/main.
Run a fresh full canonical render, confirm retained output and healthy polling;
keep the five-minute target open in feat-725. No on-demand monitor is restored.

## Completed handover and qualification

Original worker is durably drained with all92 issued assignments complete, zero
containers and persistent worker/release-policy disablement. Its boot service is
disabled; VM109 is gracefully shut down with onboot0, preserving its disk and all
records. AI worker uses the same approved bundle/images, existing target-bound
policy and logical identity. Its supervisor is active/enabled, VM RUNNING with
boot.autostart=true, and the monitor unit remains not-found. All15 existing host
AI services retain their identities/start times/restart counts.

Fresh full attempt `cmve94qj00001noaklz47a4ts`, unchanged draft21 /8856frames,
succeeds in 390.967s request to retained output; first lease
1.104s. Independent retained-byte readback matches
SHA256 `f383509f6d6b4592c297f3b0d1ce33d1fca5ef2a38b84769da37854c9f618742`, 106355088bytes. Operator full decode confirms
all8856 video frames and complete AAC matches the established reference. Native
render and verifier exit successfully without OOM. Worker returns idle with no
unfinished assignments or containers. The300s full-flow goal remains feat-725.

All36 existing release tests pass. Current source changes only restore the future
AI target and operating guidance; no renderer bounds, schema or frontend changes.
Exact proof is in the checksum-verified `forge-render-ai-always-on-setup` bundle.
