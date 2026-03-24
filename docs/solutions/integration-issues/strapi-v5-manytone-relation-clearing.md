---
title: "Strapi v5: Use { set: [] } to Clear manyToOne Relations in Sync Operations"
category: integration-issues
date: 2026-03-20
tags:
  - strapi-v5
  - relations
  - core-sync
  - manyToOne
  - data-integrity
severity: high
affected_files:
  - apps/cms/src/api/core-sync/services/sync-video-variants.ts
  - apps/cms/src/api/core-sync/services/sync-videos.ts
  - apps/cms/src/api/core-sync/services/strapi-helpers.ts
---

## Problem

During video variant sync, variants failed with two distinct errors:

1. `"1 relation(s) of type api::video-edition.video-edition associated with this entity do not exist"` — stale manyToOne relations pointed to deleted/unpublished editions
2. `"strapi is not defined"` — triggered when passing `null` to clear relations

## Root Cause

Strapi v5's document service has non-obvious semantics for relation fields during create/update:

| Syntax                 | Meaning                         | Safe for sync?                         |
| ---------------------- | ------------------------------- | -------------------------------------- |
| `undefined`            | "Don't touch this field"        | No — preserves stale/broken references |
| `null`                 | Triggers internal Strapi v5 bug | No — ReferenceError                    |
| `{ set: [] }`          | Explicitly clear the relation   | Yes                                    |
| `documentId` (string)  | Set the relation                | Yes                                    |
| `{ connect: [docId] }` | Link to entity                  | Yes                                    |

When the core-sync pre-pass failed to create/find an edition or mux-video, `editionDocId` resolved to `undefined`. Passing `videoEdition: undefined` preserved whatever stale relation reference existed on the record. Strapi's publish-time validation then rejected it because the referenced edition no longer existed.

## Solution

Use `{ set: [] }` to explicitly clear unresolvable relations:

```typescript
// Before (broken — preserves stale refs):
videoEdition: editionDocId ?? undefined,
muxVideo: muxDocId ?? undefined,

// After (fixed — clears stale refs):
const relations: Record<string, unknown> = {
  language: langDocId ?? undefined,
  video: { connect: [videoDocId] },
}
relations.videoEdition = editionDocId ?? { set: [] }
relations.muxVideo = muxDocId ?? { set: [] }
```

Same pattern applied to subtitle → videoEdition in `sync-videos.ts`:

```typescript
videoEdition: editionDocId ?? { set: [] },
```

## Prevention

1. **In sync operations, upstream data is authoritative.** If a relation is absent in source data, actively clear it with `{ set: [] }` — never use `undefined` (which means "don't touch").

2. **Never pass `null` for Strapi v5 relations.** It triggers an internal bug. Use `{ set: [] }` instead.

3. **Separate relation fields from scalar fields** for clarity:

   ```typescript
   const relations: Record<string, unknown> = {}
   relations.videoEdition = editionDocId ?? { set: [] }
   ```

4. **Consider a helper** to enforce the pattern:
   ```typescript
   function clearableRelation(docId: string | undefined) {
     return docId ?? { set: [] }
   }
   ```

## Cross-References

- Related: `docs/solutions/cms/strapi-v5-populate-role-sanitization.md` (other Strapi v5 API gotcha)
