---
id: "feat-726"
title: "Retain full Studio outputs through bounded edge-safe transfers"
owner: "tataihono"
priority: "P1"
status: "complete"
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

## Implementation and review

PR #2775 merges as `96aea48b791230f299c455a08b17276fdd35de5c`.
The worker persists one absolute transfer deadline with its original monotonic
retention window. Manager accepts at most eight 16MiB parts, and Admin validates
exact immutable provenance, order, sizes, complete digest and codec proof before
normal private asset registration. Cancellation and the identical absolute
deadline reach upload grants, storage operations and assembly. Partial results
preserve references and settle as failures. Read-only receipt recovery returns
only an exact already committed canonical execution.

Validation: 68 Admin tests including actual PostgreSQL, storage cancellation and
S3 body handling; 110 worker tests plus two startup tests; 76 Manager suite tests
and 32 deadline/partial-result regression tests. Scoped type checks, build, lint,
format and normal commit hooks pass. Two independent reviewers' actionable
findings were corrected and their final reviews have no findings.

The actual captured 106,963,325-byte full output passes the local bounded
transport harness in 7.977s, with seven parts, maximum Manager request
22,369,818 bytes, maximum Admin PUT 16,777,216 bytes and 1,624-byte final
metadata. This fixture is distinct from production storage acceptance.

Admin deployment `2bfa4d8d-daaa-48e9-b5f0-d5bc854df474` is healthy and migration
0157 is applied. CI-built main release `39013807151` selects worker bundle
`8029fc729abd3a8d5926b8251dd049410d8e2307220c5c5b75bacb0735c53dff`.
PR #2776 (`848ce82f8d675431c83d66aef3651953d4183b8d`) documents the normal
Manager rollout after an unrelated existing feat-609 fixture failure skips the
first deployment; the original main CI retry and recovery PR checks pass.
Production transport acceptance and worker activation are complete as recorded below.

## Production acceptance — 2026-10-17

Manager deployment `8e446c0c-e5a6-4729-a0eb-afcb729f24eb`, source
`848ce82f8d675431c83d66aef3651953d4183b8d`, becomes healthy after normal main
CI and CodeQL pass. Admin remains healthy on the matching implementation and
migration 0157. No local code is published directly to either application.

A read-only preflight confirms existing dispatch
`c43b5a8d-c602-4f95-a773-04e0961f48aa`, completed revision-21 attempt
`cmvbzdb8z0001rut7o9g83y4u` and its exact canonical execution. The installed
worker client then sends the original independently decoded 106,963,325-byte
video through seven normal production parts, one shared 45s absolute deadline
and metadata-only finalization. The transfer completes in **26.299s**. Every
Manager claim, receipt, part and final retention response is HTTP 200.

An independent Admin storage read verifies the complete retained output SHA256
`969113a698186620f1ee889c91facbf6acf82ae7f5d3e579b6679e8d5707711b`.
Supplemental qualification output version `cmvc4dzwb0896pj0s1kgvg2az` and
manifest version `cmvc4e04o089epj0sipvvficu` are private normal retained assets.
The complete persisted canonical execution row, including request hash, result,
admission and timestamp, remains identical. Original canonical manifest
`cmvc1iwvd000brufhqkkz65hd` still reports SUCCEEDED/non-stale at revision 21.
Revision 19/20 documents and the original failed attempt retain their hashes.

This is a **post-completion transport qualification of the exact full output**,
not a second render or a new completion. It never calls finish, rewrites a
terminal record, resets the original retention window or edits an original VM
journal. The earlier complete render/decode plus canonical recovery qualifies
the rendering/data fixes; this separate check qualifies the production bounded
transfer and internal storage assembly. The installed supervisor's normal
settlement path has the corresponding automated test and full-size local
harness coverage.

The trusted release selector then activates approved bundle
`8029fc729abd3a8d5926b8251dd049410d8e2307220c5c5b75bacb0735c53dff`.
The drain is cleared; supervisor is active/running with zero restarts and exit
status zero, and repeated production claim requests return HTTP 200. CPU and
memory limits remain unchanged. Feat-725 separately tracks measured memory
headroom and parallelism qualification.
