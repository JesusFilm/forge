---
id: "feat-726"
title: "Retain full Studio outputs through bounded edge-safe transfers"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, retention, cloudflare, reliability]
---

## Problem

Attempt `cmvbzdb8z0001rut7o9g83y4u` renders and independently decodes all
8856 frames, 1080x1920/30fps H264 and complete 48kHz AAC. Its 106,963,325-byte
output expands to about 143MB in the single JSON retention upload. An
unauthenticated non-mutating size probe reproduces Cloudflare HTTP 413 before
Manager sees the request. A final binary upload to Admin would also exceed
the edge limit. Original bytes/proof are preserved. Authorized recovery uses
existing canonical asset registration and normal `StudioRenderJobs.finish`
while the original issued lease is valid, receiving `admitted: true` without
changing any deadline or historical receipt.

## Scope and constraints

Use at most eight 16MiB output parts, each registered through the normal asset
broker with exact issued-lease/input/output/index provenance. Reassemble and
verify bytes inside Admin storage before normal final output/proof/manifest
registration. Never upload the full video across either Cloudflare edge.
Preserve quality, output cap, codec proof, canonical admission and all original
retention/execution deadlines. No process-local multi-request staging state.

Add read-only recovery of an already committed canonical execution so a lost
settlement response cannot strand an otherwise retired worker. Reconcile only
exact issued assignment/result identity; never invent success or renew windows.

## Entry points and verification

- `packages/studio-contracts/src/render.ts`: bounded part metadata contract.
- `apps/studio-render/src/vm/supervisor.mjs` and `job-api.mjs`: chunked transfer
  inside the original retention window and durable retry/recovery receipts.
- `apps/manager/src/services/studio-render-pool-{gateway,http}.ts`: exact lease
  binding, bounded part upload and final small retention request.
- `apps/admin/src/services/studio-authoring/render-rpc.ts`: trusted worker-only
  storage assembly and read-only execution recovery.

Exercise the actual 106,963,325-byte captured verified output through a local
edge-cap harness; reject reordered/mixed-lease/duplicate/oversized parts and
changed digest/proof. Cover cancellation, original deadline exhaustion,
response loss and exact canonical recovery. Normal PR/main deployments and
CI-built immutable worker release only. Independently read retained bytes and
verify their digest; preserve every original terminal record.
