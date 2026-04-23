---
title: "fix: Patch video relations in deeply nested seed components"
type: fix
status: completed
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-nested-component-video-relations-requirements.md
---

# fix: Patch video relations in deeply nested seed components

## Overview

After PR #679 fixed locale-aware video resolution, a second Strapi v5 bug surfaced: the Document Service silently drops relation data for components nested 2+ levels deep in dynamic zones. All 30 `sections.video` components across Easter and Christmas seeds have NULL video relations, while `sections.video-hero` (depth 1) works correctly.

The fix: insert missing link table rows directly via Knex after Experience creation.

## Problem Statement

**Nesting depth determines whether relations are persisted:**

| Component             | Nesting path                                       | Depth | Video relation |
| --------------------- | -------------------------------------------------- | ----- | -------------- |
| `sections.video-hero` | Experience → blocks                                | 1     | **Works**      |
| `sections.video`      | Experience → blocks → `sections.section` → content | 2+    | **NULL**       |

Both use identical `video: numericId` syntax. The Document Service `create()` succeeds without error, but the `components_sections_videos_video_lnk` rows are never created for depth 2+ components.

This is a **distinct bug from strapi/strapi#22611** (which throws "Invalid relations"). Here, no error is thrown — the relation is silently discarded during persistence.

(see origin: docs/brainstorms/2026-04-08-nested-component-video-relations-requirements.md)

## Proposed Solution

Add a `patchNestedVideoRelations()` utility to `seed-utils.ts` that runs after `experienceService.create()`. It:

1. Queries `components_sections_videos` by `section_key` to find all newly created video component rows
2. Parses each `section_key` to extract the video slug (the part before `/`)
3. Looks up the correct video ID from the `videos` table by slug + locale
4. Inserts the missing rows into `components_sections_videos_video_lnk`

Both Easter and Christmas seeds call this function after Experience creation.

## Implementation Units

### Unit 1: Add `patchNestedVideoRelations` to seed-utils.ts

**Goal:** Shared utility that patches the `components_sections_videos_video_lnk` table after Experience creation.

**Files:**

- `apps/cms/src/bootstrap/seed-utils.ts`

**Approach:**

1. Accept a map of `sectionKey → videoId` (the seed already has this info from `findOrCreatePublishedVideo`)
2. Query `components_sections_videos` for rows matching those section keys
3. Check which component IDs already have a link row (idempotent — safe to re-run)
4. Insert missing link rows: `{ inv_video_id: componentId, video_id: videoId }`

**Patterns to follow:**

- `apps/cms/src/api/core-sync/services/bulk-upsert.ts:363-407` — batch link table insertion pattern
- `apps/cms/src/bootstrap/seed-utils.ts:56-63` — existing Knex query pattern

**Verification:**

- `SELECT COUNT(*) FROM components_sections_videos_video_lnk` returns a row for every `components_sections_videos` row after seeding

**Execution note:** Implementation-first. The function signature should be:

```typescript
export async function patchNestedVideoRelations(
  strapi: Core.Strapi,
  videoMap: Map<string, number>, // sectionKey → video numeric ID
): Promise<void>
```

### Unit 2: Call patch from Easter seed

**Goal:** Wire up the patch after Easter Experience creation.

**Files:**

- `apps/cms/src/bootstrap/seed-easter.ts`

**Approach:**

1. Build a `Map<string, number>` from the existing `buildVideoSectionContent` calls (sectionKey → videoId)
2. Call `patchNestedVideoRelations(strapi, videoMap)` after `experienceService.create()` succeeds
3. Place the call inside the try block, after create but before any success logging

**Patterns to follow:**

- `apps/cms/src/bootstrap/seed-easter.ts:462-464` — existing buildVideoSectionContent calls with sectionKey and videoId
- The map entries come from the same data already used for buildVideoSectionContent

**Verification:**

- After seeding, `SELECT * FROM components_sections_videos_video_lnk WHERE inv_video_id IN (SELECT id FROM components_sections_videos WHERE section_key LIKE 'easter%')` returns 8 rows (one per video section)

### Unit 3: Call patch from Christmas seed

**Goal:** Wire up the patch after Christmas Experience creation.

**Files:**

- `apps/cms/src/bootstrap/seed-christmas.ts`

**Approach:**

- Same pattern as Unit 2: build videoMap from existing Christmas video section data, call patch after create

**Patterns to follow:**

- `apps/cms/src/bootstrap/seed-christmas.ts` — mirrors Easter seed structure

**Verification:**

- After seeding, Christmas video components have link rows for all 7 video sections

### Unit 4: End-to-end verification

**Goal:** Verify the fix works on both fresh and production-imported databases.

**Files:** None (testing only)

**Approach:**

1. Wipe local DB, start Strapi (creates schema), stop, import production data, restart with `SEED_ON_BOOT=true`
2. Verify DB: `SELECT sv.section_key, v.title FROM components_sections_videos sv JOIN components_sections_videos_video_lnk svl ON svl.inv_video_id = sv.id JOIN videos v ON v.id = svl.video_id`
3. Verify mobile app: video thumbnails appear on Easter Explained and all other video sections
4. Verify no regression: video-hero still works

**Verification:**

- All 30 `components_sections_videos` rows have corresponding link table entries
- Mobile app renders video thumbnails on all sections
- Strapi admin shows video relations populated

## Acceptance Criteria

- [ ] Every `sections.video` component has a populated video relation after seeding (R1, R2)
- [ ] `sections.video-hero` and `sections.video-carousel-item` continue working (R3)
- [ ] Works on fresh databases and production-imported databases (R4)
- [ ] Patch is idempotent — running seed twice doesn't create duplicate link rows
- [ ] No changes to Strapi content type schemas

## Dependencies & Risks

- **Dependency:** PR #679 must be merged first (provides the `findOrCreatePublishedVideo` and shared utils)
- **Risk:** If Strapi upstream fixes the nested relation bug, the patch becomes redundant (but harmless — idempotent check prevents duplicates)
- **Risk:** Component IDs may differ between fresh and imported databases — the patch uses section_key lookup, not hardcoded IDs

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-08-nested-component-video-relations-requirements.md](docs/brainstorms/2026-04-08-nested-component-video-relations-requirements.md) — key decisions: post-create SQL patch approach, reuse findOrCreatePublishedVideo pattern
- **Strapi v5 nested relation bug:** [docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md](docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md)
- **Bulk link table insertion pattern:** `apps/cms/src/api/core-sync/services/bulk-upsert.ts:363-407`
- **Related PR:** #679 (locale-aware video resolution)
- **Upstream issues:** strapi/strapi#22611, strapi/strapi#24850, strapi/strapi#23909
