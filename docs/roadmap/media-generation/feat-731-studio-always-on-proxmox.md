---
id: "feat-731"
title: "Restore always-on Proxmox renderer and retire demand monitor"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, infrastructure, proxmox]
---

## Owner decision

Restore the production worker to `forge-render-01` (Proxmox VM109 on `jfp00`),
leave it continuously running and remove the jfpai01 on-demand monitor.
Keep the reviewed parallel renderer and original long-render/data fixes.

## Execution

Disable host monitor first, confirm AI guest assignments retired, persistently
exclude its supervisor before activating the original logical worker identity.
Install the exact reviewed published v4 images and host bundle on VM109 while
inactive; never reactivate the incompatible old v3 release. Preserve journals,
credentials, disk and rollback records. Confirm original VM CPU/RAM/disk capacity,
boot startup, actual polling and a fresh canonical render. Remove demand-only
Manager endpoint/config/tests and host monitor implementation through normal
PR/main; never publish local source directly. Cancel obsolete follow-up feat-730,
add dated supersession notes to historical on-demand/AI cutover instructions.

## Verification

Only one enabled physical supervisor with pool/worker identity forge-proxmox /
forge-render-1, v4 payload hashes/digests verified, no unresolved assignments on
retired host, monitor disabled/uninstalled, AI VM off, original service enabled
and healthy after restart, retained render verified. Preserve the unmet 300s
performance target honestly. Update operator setup record and roadmap.
