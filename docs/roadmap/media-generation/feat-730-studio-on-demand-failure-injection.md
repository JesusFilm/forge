---
id: "feat-730"
title: "Qualify on-demand worker claim-response failure during drain"
owner: "tataihono"
priority: "P2"
status: "cancelled"
start_date: "2026-10-18"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, recovery, on-demand]
---

## Cancelled by owner decision 2026-10-19

Feat-731 removes the demand monitor and restores an always-on Proxmox worker.
The drain/claim hypothesis below is preserved as history; the removed controller
is not a mechanism to maintain or fault-qualify. Dependency on feat-729 retired.

## Scope

Expand fault qualification after the successful normal lifecycle in feat-729.
Potential race to reproduce: broker commits a fresh lease, claim response is lost,
controller initiates drain from the last idle status, supervisor restarts before
assignment.json is written. Fresh leases are absent from pending scans.
This is an unconfirmed failure hypothesis, not an observed production incident.

## Entry points and verification

Read `apps/studio-render/src/vm/supervisor.mjs` (drain check before claim replay),
`journal.mjs` (claim-request.json vs assignment.json), `cycle-state.mjs`, and
`apps/studio-render/ops/on-demand/guest.mjs` (`retirementClear`, `inspectGate`).
Use an isolated broker/guest fixture; never interrupt or reset production leases.
Prove response loss plus drain cannot clear recovery or strand a fresh lease.
If reproduced, preserve/replay uncertain claims before granting shutdown authority,
with a failing integration regression first. Do not rely on systemd restart counts
without verifying their reset semantics. Keep normal PR/main release discipline.
