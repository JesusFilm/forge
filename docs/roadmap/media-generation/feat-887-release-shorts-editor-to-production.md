---
id: "feat-887"
title: "Release the recovered Shorts editor to production"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, release]
---

## Scope

Ship the recovered editor UI, media workspace, timeline controls, audio envelopes,
shared Manager sidebar and Content Pack retirement together through a reviewed
PR to main. Preserve unrelated local Watch and export work. Reconcile current
main, regenerate GraphQL artifacts and use migration 0163 after main's 0162.
Renumber the recovered roadmap tickets into 817–886 to avoid IDs already used
by newer main work. Content Pack retirement remains feat-816.

## Verification

Run affected contract, composition, Manager, Admin and Mastra checks. Verify
formatting, generated artifacts and roadmap uniqueness before push. Wait for PR
CI before squash merging; observe production deployment commit/status and health
for affected Railway services. Existing editor-loading/request-count tests and
per-feature browser evidence provide frontend loading coverage.

## Release evidence

- PR [#2938](https://github.com/JesusFilm/forge/pull/2938) passed all 61
  checks and squash merged as `9f39bd8686ff4303ccd59f85c74a9f53c2995c35`.
- Production Admin applied `0163_retire_studio_content_packs` successfully;
  the worker subsequently reported no pending migrations. This directly removes
  the retired tables and planning references, without a restore or data rewrite path.
- Hosted renderer release
  [40504028064](https://github.com/JesusFilm/forge/actions/runs/40504028064)
  built and published from that exact main commit. Candidate SHA256:
  `34e35e90337047d7a0cc08c0413bd074cdf6cb44eabb183235dee6b9ec0fc4ba`.
- The existing `forge-render-ai01` worker was drained before merge. The trusted
  host release tools verified, acquired and selected the candidate before
  explicit activation. The service is active with no pending release marker.
  Render image: `ghcr.io/jesusfilm/forge-studio-render@sha256:76f3ed8c5c84e98edb0bb2cd8172237fe31e69693e683225b94efc4110fc8a1c`.
  Verify image: `ghcr.io/jesusfilm/forge-studio-verify@sha256:f80ec31895d475928459afad82d18d439aba3d2b264835830d3a1c5ff28f372f`.
  The unchanged supervisor bundle remains
  `b98e696bf1a698f6efe7d13d7d9b30799443cce5bda553d2f9155c24e9e84ec2`.

## Durable verification notes

- Run Manager's package lint in addition to root staged-file lint. Its Next/React
  configuration checks ref writes during render; synchronize a latest-callback
  ref in a layout effect and use an effect event for cancellation cleanup.
- Historical saved-document test fixtures retain their original bytes. Compare
  reads against `studioDocumentSchema.parse(saved.document)`, which represents
  the current contract, rather than reintroducing a retired field or rewriting
  recorded evidence.
- Local validation passed: 1,477 Manager tests, 3,936 Mastra tests, 56 contract
  tests, 74 composition tests, 2 preview tests, 123 renderer/host tests and 58
  affected Admin database tests. All four Admin typecheck shards, affected
  package typechecks, Manager production build, generated-artifact checks,
  fresh migration chain, downloadable skill verification, roadmap uniqueness
  and repository formatting passed. Two additional Admin historical-evidence
  suites (7 tests) passed after normalizing their expectations to the schema.
- Editor startup/loading tests and existing per-feature browser evidence cover
  deferred media-library initialization. The local calendar startup check made
  two initial requests. Public production browser verification reached login;
  an authenticated production editor session was unavailable.

## Manager build retry

Railway deployment `404a9272-d145-4581-8e82-7a1a3ae04000` failed while
resolving `docker/dockerfile:1`, before any application build step, with
`failed to solve: frontend grpc server closed unexpectedly`. The same commit's
Manager production-image workflow `40504019479` passed. This distinguishes the
observed builder failure from an application compilation failure; the underlying
Railway daemon failure could not be reproduced locally. No application fix is
inferred. Release evidence and the Manager troubleshooting pointer are submitted
through a normal PR-to-main merge to obtain another watched Manager deployment.
The original frontend deployment remains unpromoted; completion requires a
successful replacement and public health verification.
