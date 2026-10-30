---
id: "feat-731"
title: "Restore always-on Proxmox renderer and retire demand monitor"
owner: "tataihono"
priority: "P1"
status: "complete"
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
and healthy after activation, retained render verified. Preserve the unmet 300s
performance target honestly. Update operator setup record and roadmap.

## Operational qualification

Always-on original VM activated with the exact reviewed v4 host bundle and image
digests. Fresh full attempt `cmvdqe8bm0001no0bc4biokrc` succeeds: first lease1.090s,
render652.040s, verifier83.974s, request-to-retained852.889s. Independent canonical
byte digest, all8856 decoded frames and complete AAC pass. No memory-limit/OOM;
worker idle with zero restarts/containers/unfinished assignments. AI worker
disabled/off, monitor uninstalled and private monitor config removed; demand-only
secret removed. All15 AI services unchanged. The Proxmox run is materially slower
than the prior380.478s warm AI-host run; no performance win is claimed.

Cleanup #2798 merged as5f11c9d70db79ac13ac31f85682cd18be3cb62b4 after29 checks.
Normal Manager deployment6d06afd9-eb22-4305-a9d1-ed5ffe2758a5 succeeds from
that exact source. Live endpoint404, built route absent, running demand key
absent, normal pool enabled and original supervisor active/enabled confirm the
remaining source retirement. All28 main checks pass/neutral/skip. Reviewed host
release tools also match main (13file hashes), without worker restart;

see `docs/plans/2026-10-19-studio-always-on-proxmox.md` for exact proof.

Superseded placement: the owner subsequently selects always-on jfpai01 in
feat-732 after this measured comparison. Keep this completed handover as history;
the monitor retirement and renderer fixes remain in effect.
