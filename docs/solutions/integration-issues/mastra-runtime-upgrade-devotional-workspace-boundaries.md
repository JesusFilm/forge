---
title: "Mastra runtime upgrades require revalidating Devotional Workspace boundaries"
date: "2026-07-31"
category: "integration-issues"
module: "apps/mastra"
problem_type: "integration_issue"
component: "development_workflow"
symptoms:
  - "The Devotional Workspace branch diverged from the coordinated Mastra runtime dependency update and required integration hardening after the merge."
  - "Direct AWS SDK and PostgreSQL dependencies no longer matched the provider versions selected by the upgraded Mastra adapters."
  - "Programmatic workflow launchers assembled durable input without parsing it through the workflow's runtime schema."
  - "Railway S3 filesystem and digest operations lacked one shared, finite timeout and retry contract."
root_cause: "incomplete_setup"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "pnpm-lock.yaml"
  - "Devotional Workspace"
  - "video-first devotional workflow"
  - "Railway S3"
tags:
  - "mastra"
  - "workspace"
  - "dependency-upgrade"
  - "workflow-schema"
  - "railway-s3"
  - "source-integrity"
  - "retry-budgets"
  - "studio-validation"
---

# Mastra Runtime Upgrades Require Revalidating Devotional Workspace Boundaries

## Problem

The Devotional Workspace data plane was implemented against an earlier Mastra
runtime while `main` independently upgraded the coordinated Mastra package
family. Merging the runtime update preserved compilation, but compilation was
not enough to prove that workflow launch contracts, direct storage-provider
dependencies, suspended-run integrity, and S3 failure behavior still composed
safely.

This was an integration defect in the feature branch, not a change to the
ownership model. Workspace files remain devotional content authority,
PostgreSQL remains workflow and attempt state, and Shorts Worker remains the
automated media-byte executor.

## Symptoms

- `@mastra/core` and `@mastra/pg` moved to their upgraded versions while the
  app still declared a broad `@aws-sdk/client-s3` range and an older direct
  `pg` version.
- `VideoFirstRun.startAsync` accepted `Record<string, unknown>`, so routes and
  tests could construct durable input independently of the workflow's Zod
  schema.
- Workspace file operations used the client owned by `S3Filesystem`, while
  digest verification created a separate `S3Client`. The two paths could
  therefore diverge in timeout, retry, connection, or credential behavior.
- Tests covered source verification generally, but did not prove the exact
  case where an authenticated editor changes a selected Workspace source while
  the workflow is suspended for approval.
- No transport-level test proved that a connected but non-responsive S3
  endpoint would fail inside the inventory and reconciliation budget.

The gaps were found during PR integration review. There was no confirmed
production incident.

## What Didn't Work

- Treating a green standalone dependency-update PR as proof for the composed
  feature branch. Install, typecheck, and build success do not exercise the
  feature's provider graph, durable input boundary, suspension behavior, or
  stalled network I/O.
- Leaving direct provider dependencies broad or older than the versions used
  by pinned Mastra adapters. The lockfile can remain installable while direct
  application imports and adapter internals resolve through avoidable duplicate
  provider families.
- Typing an external launcher as `Record<string, unknown>` while keeping the
  real input schema inside the workflow module. Structural typing does not
  perform runtime validation and lets launch sites drift silently.
- Creating a second S3 client for integrity reads. Operations against the same
  bucket then have different operational budgets and duplicate connection and
  retry machinery.
- Assuming a generic verification test covers a human-approval suspension.
  Source files remain editable while a run is suspended, so mutation between
  suspension and resume is a first-class state transition.
- An earlier investigation found that the expected local `devo/corpus` files
  were gitignored and absent, and that Forge had no remote Workspace provider.
  Proxying large MP4 bytes through Mastra merely to write them into Workspace
  was rejected because it violated the media-execution boundary. These findings
  established the architecture later hardened here; they are not evidence that
  the integration repair was already implemented. (session history)

## Solution

### 1. Export and enforce one workflow input schema

Move the durable input contract into an import-safe module and use the same
schema at workflow definition and every programmatic launch boundary:

```ts
export const VideoFirstDevotionalWorkflowInputSchema = z
  .object({
    chapterIndex: z.number().int().positive().optional(),
    sequence: z.number().int().nonnegative().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    workspaceGeneration: z.number().int().positive(),
    attemptId: z.string().min(1),
    selectedSources: z.array(DevotionalSourceRefSchema).min(1).max(500),
  })
  .strict()
```

The route now parses immediately before starting the run:

```ts
const workflowInput = VideoFirstDevotionalWorkflowInputSchema.parse({
  chapterIndex: input.workflowInput.chapterIndex,
  sequence: input.workflowInput.sequence,
  date: input.workflowInput.date,
  attemptId: attempt.id,
  workspaceGeneration: attempt.catalogGeneration,
  selectedSources: attempt.selectedSources,
})

await run.startAsync({ inputData: workflowInput })
```

Workflow tests parse their launch fixtures through the same schema. A test can
no longer prove behavior with an input shape that production launchers would
reject.

### 2. Align direct provider dependencies with the adapter graph

Pin direct provider packages to the versions selected by the upgraded Mastra
adapters, then regenerate the lockfile rather than editing it manually:

```json
{
  "@aws-sdk/client-s3": "3.1100.0",
  "@mastra/pg": "1.18.1",
  "@mastra/s3": "0.6.0",
  "@smithy/node-http-handler": "4.9.13",
  "@smithy/util-retry": "4.3.1",
  "pg": "8.22.0"
}
```

Version alignment was necessary but not sufficient; the launcher, integrity,
and transport contracts still required executable fixes and tests.

### 3. Share one bounded S3 client

Create `S3Filesystem`, take its client, apply an application-owned transport
budget, and reuse that client for digest reads:

```ts
const client = filesystem.client

client.config.requestHandler = new NodeHttpHandler({
  connectionTimeout: 5_000,
  requestTimeout: 10_000,
  socketTimeout: 10_000,
  throwOnRequestTimeout: true,
})
client.config.maxAttempts = async () => 2
client.config.retryStrategy = async () =>
  new StandardRetryStrategy({ maxAttempts: 2 })

return {
  filesystem,
  digestReader: createS3DigestReader(storage, client),
}
```

The finite defaults fit below the reconciliation budget. The test seam accepts
shorter limits so failure behavior can be proven without changing production
configuration.

### 4. Test the focused failure paths

Focused regressions pin the behavior at each layer:

- A TCP server accepts an S3 connection and never responds. With 100 ms limits
  and `maxAttempts: 1`, `filesystem.init()` must reject and the server must see
  exactly one connection.
- A workflow test suspends a devotional run for approval, injects a selected
  source verification failure on resume, and asserts failed status, reservation
  release, and no publish call.
- A separate authored-data test changes the bytes after selection and proves
  the digest mismatch is rejected as `source-changed`.

The second test preserves the fail-closed rule while avoiding a leaked clip
reservation when no external publication request was attempted.

### 5. Validate the composed surface

The completed integration validation covered:

- the full Mastra test suite: 156 files passed, 1 skipped; 1,554 tests passed,
  3 skipped;
- Mastra typecheck, lint, formatting, and `mastra build --studio`;
- a local `mastra dev` smoke with memory storage, including HTTP 200 responses
  from `/studio/workspaces` and `/api/workspaces`;
- API registration of `devotional-workspace` / `Devotional Workspace` with a
  filesystem and BM25 search;
- fresh GitHub checks for PR #1796, including CodeQL, formatting, commit lint,
  patched-dependency guard, affected checks, and schema drift.

## Why This Works

- One strict schema is both the runtime and TypeScript contract. Definition and
  invocation can no longer drift independently.
- Provider pins remove ambiguity between the packages imported directly by the
  app and those used by Mastra adapters.
- Filesystem operations and digest verification share endpoint, credentials,
  connections, timeouts, and retry policy because they share the same client.
- The blackhole test exercises successful TCP connection followed by silence,
  the failure mode most likely to evade mocked error responses.
- Digest checks at approval resume and pre-publish preserve one coherent source
  generation even though Studio editors can change Workspace files at any time.
- Layered validation distinguishes package correctness, Studio composition,
  and CI evidence from credentialed production release gates.

## Prevention

- Keep durable workflow schemas in standalone import-safe modules. Parse every
  route, script, test fixture, and internal launcher immediately before
  `startAsync`.
- Do not use `Record<string, unknown>` at a workflow invocation boundary when a
  concrete runtime schema exists.
- On storage or database adapter upgrades, inspect direct provider packages,
  align their versions deliberately, regenerate the lockfile, and check the
  resolved dependency graph.
- Reuse an adapter's client for application-owned reads against the same backend
  when those operations require the same credentials and failure budget.
- Give every external client used during reconciliation explicit connection,
  request, socket, and retry limits. Test a connected-blackhole endpoint, not
  only mocked status responses.
- For every suspendable workflow, mutate authoritative inputs between suspend
  and resume. Assert both cleanup and the downstream side effect that must not
  occur.
- Treat green CI as proof only for the surfaces it exercised. Keep live Railway
  storage/database, restart recovery, migrations, backup/restore, and canary
  checks as explicit release evidence.

## Related Issues

- [PR #1796](https://github.com/JesusFilm/forge/pull/1796) contains the
  Devotional Workspace data plane and the Mastra upgrade integration repair.
- [Mastra eval workflow local-dev contracts](./mastra-eval-workflow-local-dev-contracts.md)
  shares the rule that a green build is not a real runtime or Studio proof, but
  covers a different workflow and failure boundary.
- [Optional Railway S3 with local tmp fallback](../platform/optional-railway-s3-local-fallback.md)
  documents the adjacent local-versus-Railway storage convention.
- [Dependabot pnpm transitive remediation](../security-issues/dependabot-pnpm-transitive-remediation-20260416.md)
  provides adjacent lockfile and dependency-graph discipline for security
  updates.
- [Devotional Workspace cutover runbook](../../runbooks/devotional-workspace-cutover.md)
  owns the unrun production migration, backup/restore, Railway S3/PostgreSQL,
  restart-recovery, and canary gates.
