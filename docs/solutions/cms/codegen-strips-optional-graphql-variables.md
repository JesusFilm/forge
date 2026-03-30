---
title: "Codegen strips optional GraphQL variable definitions from DocumentNode AST"
category: cms
date: 2026-03-30
severity: critical
tags:
  - graphql-codegen
  - apollo-client
  - core-sync
  - incremental-sync
  - gql-tada
modules:
  - apps/cms
related_issues:
  - "PR #567"
---

# Codegen strips optional GraphQL variable definitions from DocumentNode AST

## Problem

Incremental sync filters (`$where`, `$input`) were silently ignored — every sync refetched all records regardless of the `updatedAt` watermark. The Core API received queries without filter parameters.

## Symptoms

- Languages sync: "Fetched 2280 languages" on every run (should be 0 after first sync)
- Video variants count query returned 207,313 instead of 0 with updatedAt filter
- Watermarks were being set and read correctly, but the filter had no effect
- Direct API calls from curl/node with the same filter worked correctly (returned 0)

## Root Cause

`@graphql-codegen/client-preset` (v5.2.4) optimizes the generated DocumentNode AST objects by **stripping optional variable definitions**. When a query has only optional variables (e.g., `$where: LanguagesFilter`), the entire `variableDefinitions` array and the corresponding field `arguments` are removed from the AST.

Apollo Client serializes the AST to produce the query text sent over HTTP. With the variable definitions stripped, the serialized query becomes:

```graphql
# What Apollo sent (stripped):
query SyncLanguages {
  languages(limit: 5000) { ... }
}

# What the source code defines:
query SyncLanguages($where: LanguagesFilter) {
  languages(limit: 5000, where: $where) { ... }
}
```

The `variables` object was also sent as `{}` regardless of what was passed to `client.query()`.

When a query has BOTH required and optional variables (e.g., `$limit: Int!, $offset: Int!, $input: VideoVariantFilter`), codegen keeps the required ones but strips the optional one.

## Investigation Steps

1. Added HTTP interceptor to Apollo's fetch wrapper — saw `variables: {}` and query without `$where`
2. Inspected the generated AST in `graphql.ts` — confirmed `variableDefinitions: undefined` and missing `where` argument
3. Compared queries with required variables (SyncVideos with `$limit: Int!`) — those had `variableDefinitions` preserved
4. Tested `print()` from graphql-js on the AST — produced the same stripped query (proving it's the AST, not Apollo)
5. Tried passing `where: {}`, `where: null`, `where: undefined` — none worked because the variable definition itself was missing from the query text

## Solution

Added `optimizeDocumentNode: false` to `codegen.ts` config and regenerated `graphql.ts`. This tells the codegen to skip the AST optimization that strips optional variable definitions.

5 DocumentNode objects now correctly include their optional variables:

| Document                       | Variable preserved           | Argument preserved |
| ------------------------------ | ---------------------------- | ------------------ |
| SyncLanguagesDocument          | `$where: LanguagesFilter`    | `where: $where`    |
| SyncVideoVariantsCountDocument | `$input: VideoVariantFilter` | `input: $input`    |
| SyncVideoVariantsDocument      | `$input: VideoVariantFilter` | `input: $input`    |
| SyncVideosCountDocument        | `$where: VideosFilter`       | `where: $where`    |
| SyncVideosDocument             | `$where: VideosFilter`       | `where: $where`    |

No manual patches needed — the codegen generates correct ASTs natively with this config.

### Verified locally

|           | Run 1 (no watermark) | Run 2 (with watermark) |
| --------- | -------------------- | ---------------------- |
| Languages | 2,280 updated        | **0 updated**          |
| Videos    | 1,057 updated        | **0 updated**          |
| Duration  | 45s                  | **1.5s**               |

## Why This Works

The AST patch adds the `variableDefinitions` array and field `arguments` that codegen stripped. When Apollo Client serializes the patched AST, it produces the full query text with `$where`/`$input` parameters. The variables object is then correctly included in the HTTP body, and the Core API filters results by `updatedAt`.

## Prevention

| Pattern              | Rule                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codegen config       | Always keep `optimizeDocumentNode: false` in `codegen.ts` config. Removing it will silently break incremental sync.                                             |
| Testing incremental  | After any codegen change, trigger sync twice — second run should show 0 records for phases with watermarks.                                                     |
| schemaExtensions bug | Codegen requires a patch to `@graphql-tools/schema` (guard `applyExtensions` against undefined). Update `@graphql-tools` packages when newer versions fix this. |

## Key Files

- `apps/cms/codegen.ts` — codegen config with `optimizeDocumentNode: false`
- `apps/cms/src/api/core-sync/gql/graphql.ts` — generated file with correct DocumentNodes

## Related Documentation

- [Core sync incremental delta sync](./core-sync-incremental-delta-sync.md) — watermark system
- [Core sync production vs local performance gap](./core-sync-production-vs-local-performance-gap.md) — other sync fixes
