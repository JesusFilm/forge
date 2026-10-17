---
id: "feat-721"
title: "Protect Studio ownership reads from shared control-plane contention"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 2
depends_on: []
blocks: []
tags: [studio, rendering, database, reliability]
---

## Observed failure

Full revision-21 attempt `cmvbrelg10001o72n9zshopdp` prepared successfully and
entered its render container at 2026-10-17T02:11:54.553Z. At 02:29:31.678Z,
Manager's `/api/shorts/render-pool/owns` returned 409 after 9005ms. The preceding
ownership requests returned 200. Admin's third delegated request was aborted
after 8879ms. Its shared main database pool reported up to 92 pending operations
and acquisition waits over 15 seconds. The VM cancelled and physically retired
the container at 02:29:32.124Z, before its original 02:30:38 job deadline.
No codec verification ran; the canonical admitted result is FAILED.

This is separate from the source-range, repeated-transfer and preparation-budget
failures addressed by feat-713 through feat-716. Preserve this failed attempt.

## Entry points and investigation

- `apps/manager/src/services/studio-render-pool-gateway.ts`: `owns`, `bound`,
  `current`; currently three sequential delegated reads, including full context.
- `apps/manager/src/services/studio-render-pool-http.ts`: bounded ownership read.
- `apps/admin/src/services/studio-authoring/render-jobs.ts`: assigned receipt,
  immutable context and canonical assignment eligibility.
- `apps/admin/src/db/`: main pool acquisition and workload profiles.
- `apps/studio-render/src/vm/supervisor.mjs`: fail-closed ownership monitor.

Reproduce ownership starvation with competing database work. Route authenticated
render-worker RPCs through a dedicated two-connection pool with a five-second
acquisition bound, isolated from the main and sync pools and reused across module
caches. Retain the existing canonical queries, exact issued-lease, input-hash,
revision, publication/admission and cancellation checks. Do not cache positive
ownership or keep rendering after unconfirmed authority. Consolidating canonical
RPCs and adding bounded phase/reason diagnostics are possible later improvements;
they are not necessary to remove this observed shared-pool queue.

## Verification

Exercise the actual ownership path under competing pool load and prove timely
revocation, timeout cleanup, unchanged cumulative deadlines and immutable receipt
history. Roll out through normal PR/main; qualify a full project with independent
codec verification and retained output. No direct production source publishing.
