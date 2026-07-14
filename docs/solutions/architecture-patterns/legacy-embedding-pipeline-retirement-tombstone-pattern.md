---
title: "Retiring legacy embedding pipelines with tombstones and retention boundaries"
date: 2026-06-30
category: docs/solutions/architecture-patterns/
module: apps/admin apps/manager apps/mastra
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Removing an embedding writer, backfill, or cross-app ingest pipeline"
  - "A public or service URL may still have old callers after the writer is retired"
  - "Historical vector rows must be retained while search stops consuming them"
tags: [embeddings, tombstone-routes, retention, admin, manager, mastra, search]
related_components:
  - database
  - background_job
  - documentation
---

# Retiring Legacy Embedding Pipelines With Tombstones And Retention Boundaries

## Context

feat-193 removed the legacy scene embedding writer after transcript-backed
search and recommendations no longer consumed scene vectors. The tricky part
was that "remove the pipeline" did not mean "delete all scene concepts." Three
things had to stay distinct:

- historical `video_scene` / `video_scene_locale` data stays in Postgres until
  a separate retention/migration ticket owns it;
- Manager scene analysis may still produce non-search source artifacts;
- the scene embedding writer, ingest, backfill, sync UI, and search reads are
  retired.

The first implementation pass deleted writer code, but formal review found the
usual retirement hazards: old HTTP callers would get framework 404s, active
operator docs still contained scene flags, and one search-side fallback could
rank videos from a non-transcript candidate index when the primary embedding
provider failed.

## Guidance

Treat legacy pipeline retirement as a contract migration, not only a deletion.
Delete the writer and active operator surfaces, but keep explicit tombstones for
old externally reachable HTTP entry points. The tombstone should return a
stable reason and no data:

```ts
return Response.json(
  {
    error: "Legacy scene embedding backfill has been retired",
    reason: "legacy_scene_embedding_pipeline_removed",
    retryable: false,
    replacement:
      "Search uses transcript embeddings; historical scene data is retained for feat-199.",
  },
  { status: 410 },
)
```

Preserve the old auth gate when the route was externally callable through the
same app boundary, as with Manager's `/api/admin-embeds/scene`. For internal
service routes where the retired response reveals no data and the old auth key
has been removed, an unauthenticated 410 is acceptable when the team wants
operators to see an observable retirement signal instead of a 404.

Do not let compatibility names decide the storage path. `sceneRecommendations`
and `/api/scene-embedding/recommendations` can remain compatibility names, but
their retrieval SQL must be transcript-backed. Tests should assert absence of
the retired tables, not only presence of the new table:

```ts
expect(sql).toContain("video_transcript_chunk")
expect(sql).not.toContain("video_scene_locale")
expect(sql).not.toContain("video_scene")
```

When the new path depends on provider provenance, carry the same guard into all
semantic retrieval call sites. Experience AI candidate retrieval needed the
same transcript provider/model/dimension predicates as the public search
retriever, and provider failure needed to fall back to catalog token ranking
instead of an old local vector index.

Documentation is part of the retirement surface. Active app guides, runbooks,
roadmap tickets, and code comments should say:

- active embedding generation is transcript and experience only;
- scene analysis artifacts are non-search source artifacts;
- historical scene rows are retained for the follow-up retention ticket;
- retired CLI flags such as `--pipeline=scene`, `--scene-mode`, and
  `--from-report` are archival and fail closed.

## Why This Matters

A deleted route is ambiguous to old callers: it looks the same as a deploy
miss, a proxy bug, or a path typo. A 410 tombstone gives operators and agents a
stable contract they can classify without reintroducing the writer.

A retained table is also ambiguous unless comments and tests say what retained
means. Without that boundary, future work can accidentally reason from
"scene rows still exist" to "scene retrieval is still supported." Keeping data
retention in a separate ticket avoids destructive cleanup inside a code-removal
PR and preserves the repair/migration substrate until a deliberate data plan
exists.

## When To Apply

- Removing writer workflows, ingest endpoints, or backfill CLIs while old
  callers may still hold URLs or generated GraphQL operations.
- Repointing a compatibility API name to a different retrieval source.
- Retiring a vector corpus while historical rows must remain queryable for
  migration, audit, or non-search product work.
- Cleaning active operator docs after a pipeline removal.

## Examples

### Retired HTTP surfaces

Keep tombstones for old service URLs with explicit tests:

- Admin internal scene ingest:
  `apps/admin/src/app/api/internal/mastra/scene-embeddings/route.ts`
- Manager proxy:
  `apps/manager/src/app/api/admin-embeds/scene/route.ts`
- Mastra service route:
  `apps/mastra/src/mastra/index.ts`

### Retired CLI flags

Test the actual entrypoint, not only helper functions:

```ts
const result = spawnSync("pnpm", [
  "exec",
  "tsx",
  "src/scripts/run-embeds.ts",
  "--pipeline=transcript",
  "--scene-mode=model-upgrade",
])

expect(result.status).toBe(2)
expect(result.stderr).toContain("--scene-mode is no longer supported")
expect(result.stderr).toContain("scene embedding backfills have been retired")
```

### Retained historical data

Schema comments should make the boundary explicit:

```prisma
/// The scene embedding writer is retired; rows are retained for historical
/// and non-search scene data until feat-199 decides retention/migration.
/// Search and recommendation retrieval are transcript-backed.
model VideoSceneLocale {
  embedding Unsupported("vector(1536)")?
}
```

## Related

- [Mastra embedding workflow ownership pattern](../platform/mastra-embedding-workflow-ownership-pattern.md)
- [Mastra scene embedding workflow pattern](../platform/mastra-scene-embedding-workflow-pattern.md)
- [Destructive embedding cleanup CLIs need model-provenance targeting](../tooling-decisions/destructive-embedding-cleanup-cli-safety-contract.md)
- [Migrating Next.js App Router route shapes](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md)
- [Retiring a mechanism: sweep docs prose for its names](../workflow-issues/mechanism-retirement-docs-prose-sweep.md) — the discovery method for the "documentation is part of the retirement surface" scope above: noun-keyed sweep + dated supersession notes on forward-looking instructions.
