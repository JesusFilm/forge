---
title: "fix: Locale-aware video relations in Easter & Christmas seed scripts"
type: fix
status: active
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-easter-seed-video-relations-requirements.md
---

# fix: Locale-aware video relations in Easter & Christmas seed scripts

## Overview

Easter and Christmas seed scripts create video components without locale-aware video relations. All video lookups use hardcoded `"en"` locale (Easter) or no locale filter at all (Christmas). This causes video components in Strapi to have missing or wrong video relations, which results in no thumbnails or playable content in the mobile app.

## Problem Statement

- `findPublishedVideo()` in Easter seed hardcodes `locale = "en"` — only works for English videos
- `findOrCreatePublishedVideo()` in Christmas seed has **no locale filter** — returns non-deterministic results on multi-locale databases
- Section keys encode locale as `{slug}/{locale}` (e.g., `easter-explained/english`) but this information is never parsed or used
- Carousel item video lookups also have no locale awareness
- Christmas seed skips if experience exists — seed fixes never propagate to existing databases

## Proposed Solution

1. **Extract shared `findOrCreatePublishedVideo()`** with an explicit `locale` parameter
2. **Add `parseSectionKeyLocale()` helper** to derive Strapi locale code from section key suffix
3. **Thread locale through all video lookups** — including hero, video sections, and carousel items
4. **Switch Christmas to delete-and-recreate** — consistent with Easter, ensures seed updates propagate

## Technical Considerations

### Strapi v5 Relation Gotchas (from `docs/solutions/`)

- **Numeric IDs required inside components** — `documentId` strings fail in dynamic zone component relations (see `docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md`)
- **Use `{ set: [] }` to clear relations** — `null` triggers Strapi bug (see `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md`)
- **Delete-before-create window** — Easter already handles this with a placeholder fallback on create failure

### Locale Mapping

Current section keys only use `/english` suffix. The mapping is:

```typescript
const LOCALE_MAP: Record<string, string> = { english: "en" }
```

Section keys without a suffix default to `"en"`. This is extensible for future locales.

### Christmas `findOrCreatePublishedVideo` SQL Fix

Current: `.where("slug", slug).first()` — no locale filter, non-deterministic.
Fix: `.where("slug", slug).where("locale", locale).first()` — explicit locale, deterministic.

## Acceptance Criteria

- [ ] **R1.** Both seeds resolve video relations per-locale derived from section key
- [ ] **R2.** Both seeds use find-or-create pattern with locale parameter
- [ ] **R3.** Every `sections.video`, `sections.video-hero`, and `sections.video-carousel-item` has a valid video relation after seeding
- [ ] **R4.** Section key conventions unchanged
- [ ] Christmas seed switches to delete-and-recreate so seed updates propagate
- [ ] Seed works on fresh DB (find-or-create produces placeholders)
- [ ] Seed works on DB with production data (finds existing localized videos)
- [ ] No regressions — existing Easter/Christmas content renders correctly

## Implementation Steps

### Step 1: Create shared video utility

**New file: `apps/cms/src/bootstrap/seed-utils.ts`**

```typescript
// Locale mapping from section key suffix to Strapi locale code
const LOCALE_MAP: Record<string, string> = { english: "en" }
const DEFAULT_LOCALE = "en"

export function parseSectionKeyLocale(sectionKey: string): string {
  const slashIdx = sectionKey.lastIndexOf("/")
  if (slashIdx === -1) return DEFAULT_LOCALE
  const suffix = sectionKey.slice(slashIdx + 1)
  return LOCALE_MAP[suffix] ?? DEFAULT_LOCALE
}

export async function findOrCreatePublishedVideo(
  strapi: Core.Strapi,
  slug: string,
  title: string,
  locale: string = DEFAULT_LOCALE,
): Promise<VideoDocument> {
  const knex = (strapi.db as any).connection
  // Lookup with explicit locale filter
  const row = await knex("videos")
    .select("id", "document_id as documentId", "title", "slug")
    .where("slug", slug)
    .where("locale", locale)
    .whereNotNull("published_at")
    .orderBy("id")
    .first()

  if (row) {
    strapi.log.info(
      `[seed] Using existing Video "${row.title}" (${slug}, ${locale})`,
    )
    return row
  }

  // Create placeholder via Document Service
  const docService = strapi.documents("api::video.video")
  await docService.create({
    locale,
    status: "published",
    data: { title, slug },
  })

  // Re-fetch for numeric ID
  const created = await knex("videos")
    .select("id", "document_id as documentId", "title", "slug")
    .where("slug", slug)
    .where("locale", locale)
    .orderBy("id", "desc")
    .first()

  strapi.log.info(
    `[seed] Created placeholder Video "${title}" (${slug}, ${locale})`,
  )
  return created
}
```

### Step 2: Update seed-easter.ts

1. **Remove** `findPublishedVideo()` function
2. **Import** `findOrCreatePublishedVideo` and `parseSectionKeyLocale` from `seed-utils.ts`
3. **Update all video lookups** to pass locale:
   - Hero video: `findOrCreatePublishedVideo(strapi, "easter-hero", "Easter Hero", "en")`
   - `buildVideoSectionContent` calls: derive locale from the section key being passed
   - Carousel video lookups: pass "en" (carousel section keys have no locale suffix)
4. **Keep existing delete-and-recreate + placeholder fallback pattern**

### Step 3: Update seed-christmas.ts

1. **Remove** `findOrCreatePublishedVideo()` function (replaced by shared utility)
2. **Import** from `seed-utils.ts`
3. **Update all video lookups** to pass locale
4. **Switch from skip-if-exists to delete-and-recreate** — match Easter's pattern with placeholder fallback
5. **Add try/catch** around experience creation (currently missing)

### Step 4: Verify

```bash
# Fresh DB test
docker compose -f .devcontainer/docker-compose.yml down -v
devcontainer up --workspace-folder .
# Inside container:
SEED_ON_BOOT=true pnpm --filter @forge/cms dev
# Check: all video components have relations in Strapi admin

# Production data test
doppler run -- pnpm data-import
SEED_ON_BOOT=true pnpm --filter @forge/cms dev
# Check: video relations point to correct localized videos
```

## Dependencies & Risks

- **Risk:** Switching Christmas to delete-and-recreate means manual content edits will be lost on next seed run. Acceptable because seeds are for dev/staging only (`NODE_ENV !== "production"` guard exists).
- **Dependency:** `findOrCreatePublishedVideo` create path requires the `api::video.video` content type to exist — always true in this repo.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-08-easter-seed-video-relations-requirements.md](docs/brainstorms/2026-04-08-easter-seed-video-relations-requirements.md) — Key decisions: find-or-create for both seeds, locale from section key parsing
- Strapi v5 numeric ID workaround: `docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md`
- Relation clearing pattern: `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md`
- Bootstrap lifecycle: `docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md`
- Easter seed not called fix: `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`
