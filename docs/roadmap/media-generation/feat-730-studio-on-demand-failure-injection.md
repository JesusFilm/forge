---
id: "feat-730"
title: "Qualify on-demand worker claim-response failure during drain"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-18"
duration: 1
depends_on: ["feat-729"]
blocks: []
tags: [studio, rendering, recovery, on-demand]
---

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
