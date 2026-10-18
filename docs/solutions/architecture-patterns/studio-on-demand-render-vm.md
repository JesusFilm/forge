---
title: "Recoverable on-demand render VM lifecycle"
module: "studio-render"
category: "architecture-patterns"
problem_type: "architecture_pattern"
tags: [studio, rendering, lxd, memory, recovery, on-demand]
date: "2026-10-18"
---

# Recoverable on-demand render VM lifecycle

`apps/studio-render/ops/on-demand/` controls the fixed `forge-render-ai01` VM
on `jfpai01`. The host uses a separate Manager demand bearer and learns only
pool/worker/profile identity, enabled state and whether canonical work is pending.
It receives no worker credential, job capability or canonical service assertion.

## Recovery must survive the queue scan

The canonical pending scan includes queued attempts and expired leases. A fresh
lease is absent. Therefore an empty queue cannot prove that an unexpectedly
stopped VM has no work to recover. Persist `recovery.required=true` before first
observing a running VM or starting one, and clear it only after verified graceful
idle shutdown. On host restart, boot when recovery is required even if the demand
endpoint is unavailable. Let the existing supervisor resolve its durable journals.
Never reset leases or delete journals to make the VM appear idle.

## A successful render is not shutdown authority

After 600 idle seconds, write the controller's recognizable root-owned drain
marker. Manual drains remain authoritative. Require the supervisor's drained
status and inactive unit, validate every journal with the installed validator,
require all assignments complete and zero job containers/scopes, then perform a
fresh demand read. Only then use graceful LXD stop; never force it. Errors reset
the idle window and leave the VM running. A queued job racing the final read
remains canonical and starts the VM on the next poll.

## Host identity and release discipline

The existing LXD administrator runs the controller. Fixed-target code does not
restrict that administrator's host-wide authority. Snap's `lxc` requires
`snap-confine` capabilities and fails under `NoNewPrivileges=true`; do not claim
a sandbox that was not demonstrated. No new LXD-group member or privileged
container is introduced.

Enable systemd user lingering, preserve exact reviewed main source and SHA256
inventory, and wait for a healthy controller cycle before disabling VM autostart.
The independent demand secret belongs in Manager's canonical secret store and the
host's private configuration, never the source or evidence bundle. Installation,
maintenance and always-on rollback are documented in
`apps/studio-render/ops/on-demand/README.md`.

## Acceptance evidence

Production qualification passed in feat-729: 19.891s cold request-to-lease,
609.239s idle-to-graceful-stop, QEMU absent, 19.59GiB host memory released,
and all15 existing services unchanged. Full decoded media and canonical retained
output passed. Full cold request-to-retained timing is412.579s. Boot time alone does not measure
queue-to-worker readiness; use a fresh request from a stopped VM and its canonical
lease timestamp. Wait the real ten-minute idle interval and verify QEMU exits,
resident memory is released, and existing AI service identities/start times stay
unchanged. This lifecycle change does not establish the separate full-render
300-second target in feat-725.

## Exercise the actual HTTP client at the production edge

A healthy route and successful Node worker requests did not prove the Python
watcher could reach Manager. Cloudflare rejected Python's default user agent with
HTTP403 before application authentication, on both new and existing pool routes.
Changing only the user agent to the honest `Forge-Studio-OnDemand/1` identity
returned the expected HTTP401 without a bearer and no-store HTTP200 with the
independent demand bearer. The same test passed from the actual host.

PR #2796 adds that identity to the real client and guards its outgoing request
contract. The regression failed before the fix and all 21 host tests passed
with it. The installer health gate preserved always-on operation until the
corrected, reviewed main client passed its real host demand read. No edge policy
or application authentication was relaxed.
