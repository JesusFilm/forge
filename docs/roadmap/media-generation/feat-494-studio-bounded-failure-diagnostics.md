---
id: "feat-494"
title: "Retain bounded Studio worker failure classifications"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-09-13"
duration: 2
depends_on: []
blocks: []
tags: [manager, ai-pipeline]
---

## Problem

Studio's generic `Render execution failed` result hides distinct failures:
Chromium SIGXFSZ, a gateway ownership-check timeout, and controller teardown.
Feat-492 and feat-493 fix the observed execution defects. Diagnosing them still
required host signal capture and correlation with Manager HTTP logs.

## Entry points

- `apps/studio-render/src/vm/host-command.mjs`: bounded subprocess outcomes.
- `apps/studio-render/src/vm/controller.mjs`: currently discards error details.
- `apps/studio-render/src/vm/supervisor.mjs`: ownership monitor and settlement.
- `apps/manager/src/services/studio-render-pool-gateway.ts`: generic failure result.

## Scope

Retain a small enumerated failure classification and phase before teardown,
without persisting arbitrary child stderr, request bodies, capability tokens,
provider URLs, credentials or sensitive host configuration. Separate ownership
unconfirmed, child exit/signal, deadline and retirement-unconfirmed outcomes.
Never infer success or retirement from a diagnostic record. Preserve the original
lease, native deadline, reconciliation barriers and existing bounded outputs.

## Verification

Exercise failure classification at the real controller/supervisor boundaries,
including timeout, child signal and abort races. Verify only allowlisted fields
survive and injected credentials/URLs never appear in retained diagnostics.
