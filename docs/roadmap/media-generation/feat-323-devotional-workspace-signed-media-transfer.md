---
id: "feat-323"
title: "Devotional Workspace signed media transfer"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "mastra"
  - "railway"
  - "security"
---

## Problem

The devotional Workspace implementation gives Shorts Worker permanent
credentials for the canonical Workspace bucket and routes generated input
bytes through a Worker upload endpoint. That makes the compute service a
storage authority even though Mastra owns the Workspace and its file contract.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/devotional-worker-client.ts` — current
   input upload, render submission, output verification, and playback client.
2. `apps/mastra/src/services/devotional/workspace/config.ts` — canonical
   Workspace filesystem and Railway S3 client construction.
3. `packages/devotional-workspace/src/index.ts` — app-independent artifact,
   manifest, and temporary-capability contract.
4. `apps/shorts-worker/src/devotional-render.ts` — media preparation and output
   persistence.
5. `apps/shorts-worker/src/routes/jobs.ts` — authenticated render-job contract.
6. `apps/shorts-worker/src/config/env.ts` — current permanent Workspace
   credential requirement.

## Grep These

- `DEVOTIONAL_WORKSPACE_S3|createDevotionalStorage` in `apps/shorts-worker`.
- `devotional-inputs|fetchDevotionalWorkerArtifact` in `apps/mastra` and
  `apps/shorts-worker`.
- `workspaceManifestSchema|attempt-output` in the devotional render and
  Workspace services.

## What To Build

Make Mastra write render specifications, narration, music, manifests, and
final output metadata directly through the canonical devotional Workspace.
Mastra should mint bounded, method-specific signed object URLs for Worker
input reads and temporary output uploads. Shorts Worker remains the rendering
compute service, validates and consumes only those short-lived capabilities,
and returns output digests and sizes for Mastra to verify and finalize under
immutable content-addressed Workspace keys.

Remove the dedicated Workspace S3 credential tuple from Shorts Worker startup.
Keep existing non-devotional Worker artifact storage and legacy devotional
playback compatibility isolated from the new signed-transfer contract.

## Constraints

- Do not persist or log signed URL query strings.
- URLs must expire after the bounded render/poll window and be method-specific.
- Worker downloads remain size, digest, redirect, scheme, and host bounded.
- Worker accepts capabilities only from the configured exact Workspace HTTPS
  origin and requires each URL path to target its declared Workspace key.
- Worker uploads go to unique temporary keys; Mastra verifies bytes before
  server-side finalization and writes the authoritative output manifest.
- No MP3 or MP4 bytes are embedded in workflow code or durable workflow state.
- Production deployment remains PR-to-main through Railway autodeploy.

## Verification

- `pnpm --filter @forge/mastra test -- src/services/devotional/devotional-worker-client.test.ts src/services/devotional/workspace/media-store.test.ts src/mastra/devotional-asset-route.test.ts`
- `pnpm --filter @forge/shorts-worker test -- src/config/env.test.ts src/routes/jobs.test.ts src/devotional-render.test.ts src/routes/devotional-artifacts.test.ts`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/shorts-worker typecheck`
- `pnpm --filter @forge/devotional-workspace test`
- `pnpm --filter @forge/devotional-workspace typecheck`
- `pnpm --filter @forge/devotional-workspace lint`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/shorts-worker lint`
