---
date: 2026-04-08
topic: easter-seed-video-relations
---

# Fix Video Relations in Easter & Christmas Seed Scripts

## Problem Frame

When the Easter experience is seeded locally, video components (sections.video, sections.video-hero, sections.video-carousel-item) are missing their video relations and media attachments. This means the mobile app shows video sections without thumbnails or playable content. The root cause is that `findPublishedVideo()` only resolves videos for the default locale ("en"), but video components need locale-specific video relations based on the section key.

## Requirements

- R1. Both Easter and Christmas seed scripts resolve video relations per-locale, not just default "en". The locale is derived from the section key (e.g., `easter-explained/english` -> English locale, `why-did-jesus-have-to-die/spanish` -> Spanish locale).
- R2. Use a find-or-create pattern for both seeds: look up the video by slug+locale from local data; if it doesn't exist, create a placeholder video so the seed never fails due to missing video data.
- R3. Every video component created by the seed (sections.video, sections.video-hero, sections.video-carousel-item) must have a valid video relation attached after seeding.
- R4. Existing section key conventions are preserved. No changes to section key format.

## Success Criteria

- After running `SEED_ON_BOOT=true pnpm --filter @forge/cms dev`, the Easter experience in Strapi admin shows video relations populated on all video components.
- The mobile app renders video thumbnails and playable content from the seeded Easter experience.
- Seeds work on both a fresh database and a database with production data imported via `pnpm data-import`.

## Scope Boundaries

- Not changing video component schemas or Strapi content types.
- Not adding new locales — only using locales that already exist in the video data.
- Not fixing video media uploads (poster images, thumbnails) — only the video relation itself. Media attachments are a separate concern tied to the video record, not the seed.

## Key Decisions

- **Find-or-create for both seeds**: Aligns Easter with Christmas pattern. More forgiving and works without requiring data-import first.
- **Locale from section key**: Section key already encodes locale info (slug/locale format). Parse it rather than adding new fields.

## Next Steps

-> `/ce:plan` for structured implementation planning
