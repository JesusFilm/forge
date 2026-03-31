---
date: 2026-03-30
topic: christmas-experience-page
---

# Christmas Experience Page

## Problem Frame

JesusFilm has a well-structured Easter experience page (`/watch/easter`) with 13 sections of video content, bible quotes, Q&A, and interactive elements. No equivalent Christmas page exists on jesusfilm.org despite having nativity-related video content across the JESUS Film, LUMO Gospels, Magdalena, and Life of Jesus libraries. A Christmas page would extend the seasonal content strategy and give users a curated nativity experience.

## Requirements

- R1. Create a new Experience in Strapi with slug `christmas` and path `/watch/christmas`, following the same `blocks` dynamic zone pattern as the Easter experience
- R2. Hero section with a Christmas-themed video background, heading "Christmas", and seasonal subheading/meta description
- R3. Navigation carousel linking to the main video sections (same pattern as Easter's `NavigationCarousel`)
- R4. Narrative journey video sections following the Christmas story chronologically:
  - R4a. **Prophecy & Annunciation** — Gabriel appears to Mary (LUMO Luke 1:1-56 or JESUS Film birth segment)
  - R4b. **Mary & Elizabeth** — Mary visits Elizabeth, the Magnificat (LUMO Luke 1:1-56)
  - R4c. **Journey to Bethlehem & Birth** — The nativity, shepherds, angels (LUMO Luke 1:57-2:40 or JESUS Film "Birth of Jesus")
  - R4d. **The Shepherds** — Angels announce to shepherds (JESUS Film "Birth of Jesus")
  - R4e. **The Magi & the Star** — Wise men, Herod, flight to Egypt (LUMO Matthew 1:1-2:23)
  - R4f. **The Incarnation** — "The Word became flesh" theological meaning (Life of Jesus / Gospel of John "God's Word Becomes Flesh")
- R5. Each video section includes: video player, descriptive text (heading + subtitle + paragraphs), 3 related Q&A items, 4 bible quote cards, and a quiz button — mirroring Easter's per-section pattern
- R6. **Advent Countdown** — Interactive component replacing EasterDates. Shows days remaining until Christmas (Dec 25), with daily scripture or reflection. Expandable/collapsible like EasterDates. Christmas-themed gradient styling.
- R7. **Video Bible Collection carousel** — Curated collection of LUMO Gospel nativity chapters (Matthew 1-2, Luke 1-2) plus Magdalena and StoryClubs birth segments
- R8. **New Believer Course carousel** — Reuse the same 10-video NBC series from Easter
- R9. **Quiz button** — Reuse the same NextStep.is embed pattern from Easter
- R10. **Invitation section** — Reuse "Invitation to Know Jesus" video section from Easter
- R11. Christmas-appropriate bible verses throughout (Isaiah 7:14, Isaiah 9:6, Luke 1:30-33, Luke 2:10-14, Matthew 1:23, John 1:14, Micah 5:2, Philippians 2:6-8, etc.)
- R12. All content created exclusively through Strapi MCP tools — no seed script, no admin UI. This is intentionally an MCP capability test. Document what works, what fails, and what workarounds are needed.

## Success Criteria

- `/watch/christmas` renders a full experience page with hero, video sections, carousels, and Advent countdown
- Page structure matches Easter's quality and depth with Christmas-specific content
- Advent countdown component correctly calculates days to Dec 25 and displays daily content
- Bible verses are contextually relevant to each section's nativity theme
- Video collection carousel showcases available nativity content across film libraries
- New Believer Course and invitation sections provide a faith response pathway

## Scope Boundaries

- **In scope:** Web app only (`apps/web`). Strapi content creation. New `AdventCountdown` component. Christmas seed data.
- **Out of scope:** Mobile app (`apps/mobile`) Christmas page (follow-up work). Advent calendar with 25 daily unlocking content (simplified countdown only). New video uploads or Mux encoding. Internationalization beyond English (can be added later via Strapi i18n).
- **Out of scope:** Christmas-specific promotional banners, social sharing features, or analytics events beyond what Easter already has.

## Key Decisions

- **Narrative chronological order** over thematic grouping: Sections follow the Christmas story from Annunciation to Incarnation, giving users a journey through the nativity.
- **Advent countdown** as the Christmas-unique interactive element: Replaces Easter's date calculator. Shows countdown to Dec 25 with scripture.
- **Reuse faith response sections** (NBC, quiz, invitation): Same pattern as Easter — proven, no new content needed.
- **Content via Strapi MCP**: Create experience and all blocks programmatically rather than through admin UI.

## Dependencies / Assumptions

- Strapi is running locally with the existing component schemas (sections.video-hero, sections.section, sections.container, etc.)
- Videos referenced (JESUS Film "Birth of Jesus", LUMO chapters, etc.) exist in Strapi's video collection with valid Mux streaming URLs. If not, they'll need to be created via MCP or synced from core API first.
- The `AdventCountdown` component is new code in `apps/web` — requires a new Strapi component schema `sections.advent-countdown` and corresponding React component.
- Strapi REST API routes are NOT exposed for most content types (videos, experiences). Content-manager API requires admin JWT, not API token. MCP currently has API token auth only — this will likely be a limitation to document.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Needs research] Which specific Mux streaming URLs and video document IDs map to each nativity video? Discover via MCP what's queryable.
- [Affects R6][Technical] Advent countdown implementation: daily scripture (25 entries) vs simpler "X days until Christmas" with rotating verse.
- [Affects R2][Needs research] What video/image for the Christmas hero background? Existing Mux footage or needs sourcing.
- [Affects R4][Technical] Nativity events overlap across LUMO Luke and JESUS Film clips — pick one per section to avoid redundancy.
- [Affects R7][Technical] Video Bible Collection items need `imageUrl`, `collectionSize`, and label overrides.
- [Affects R12][MCP limitation] The Strapi MCP uses API token auth which may not have write access to all content types. Document which operations succeed/fail and what workarounds (admin JWT config, REST route enablement) would be needed.

## Next Steps

→ `/ce:plan` for structured implementation planning. MCP limitations will be discovered and documented during execution.
