---
title: "Strapi EnrichmentJob content type for durable job state"
date: 2026-03-22
category: cms
tags: [strapi, enrichment, jobs, content-type, graphql]
---

# Strapi EnrichmentJob Content Type

## Problem

The manager app stored enrichment job state in a file (`.data/jobs.json`) which was lost on every Railway deploy/restart.

## Solution

Created an `EnrichmentJob` collection type in Strapi with `draftAndPublish: false` (jobs are always "published") and an `enrichment.job-step` repeatable component for step-level tracking.

### Key design decisions

- **`draftAndPublish: false`** — Jobs don't need draft/published lifecycle. This avoids needing `status: "published"` on mutations.
- **No `source` field** — Unlike gateway-synced types, enrichment jobs are always manager-created.
- **Repeatable component for steps** — Strapi replaces the entire array on update (no patch-single-item). The state module does a read-then-write for `updateStepStatus`.
- **JSON fields for `artifacts`, `errors`, `languages`** — Flexible shape, no need for dedicated Strapi types.
- **`video` relation (manyToOne)** — Links to the gateway-synced Video for coverage overlay.

### Gotcha: untyped operations before codegen

After creating a new content type, `gql.tada` codegen must run to add it to the introspection types. Until then, use `gql` from `@apollo/client` for untyped operations. Apollo Client returns `unknown` for untyped query data — use `as any` with eslint-disable comments.

### Read-then-write for step updates

Strapi v5 has no way to patch a single item in a repeatable component array. To update one step, read the full job, mutate the step in the local array, then send the entire `steps` array back:

```typescript
const job = await getJob(jobId)
const steps = job.steps.map((s) =>
  s.name === stepName ? { ...s, status: newStatus } : s,
)
await updateJob(jobId, { steps: toStepInput(steps) })
```
