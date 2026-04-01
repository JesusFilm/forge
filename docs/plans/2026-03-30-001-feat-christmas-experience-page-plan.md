---
title: "feat: Christmas Experience Page via Strapi MCP"
type: feat
status: completed
date: 2026-03-30
origin: docs/brainstorms/2026-03-30-christmas-experience-page-requirements.md
---

# feat: Christmas Experience Page via Strapi MCP

## Overview

Create a Christmas experience page at `/watch/christmas` mirroring the Easter page (`/watch/easter`), with narrative nativity journey sections, an Advent Countdown component, and video/bible quote content. All CMS content is created exclusively via Strapi MCP tools (R12) to test MCP capabilities and document limitations.

## Problem Statement / Motivation

JesusFilm has no Christmas page despite having nativity video content across JESUS Film, LUMO Gospels, Magdalena, and Life of Jesus libraries. The Easter page demonstrates a proven experience pattern. A Christmas page extends seasonal content strategy. The MCP-exclusive constraint (R12) provides valuable documentation of Strapi MCP capabilities for future content workflows.

(see origin: `docs/brainstorms/2026-03-30-christmas-experience-page-requirements.md`)

## Proposed Solution

Follow the Easter page architecture exactly, replacing Easter-specific content with Christmas content:

1. **New Strapi component** — `sections.advent-countdown` (replaces `sections.easter-dates`)
2. **New React component** — `AdventCountdown.tsx` (mirrors `EasterDates.tsx`)
3. **GraphQL updates** — Fragment, codegen, renderer registration
4. **Content via MCP** — Create Experience + all blocks using `strapi_rest` tool exclusively
5. **MCP capability documentation** — Log what works, what fails, workarounds needed

### Key Design Decisions (from origin)

- **Narrative chronological order** for sections: Annunciation → Birth → Shepherds → Magi → Incarnation
- **Advent Countdown** as the Christmas-unique interactive element replacing EasterDates
- **Reuse faith response sections** (NBC, quiz, invitation) from Easter
- **MCP-only content creation** — no seed script, no admin UI

### Design Decisions Made During Planning

- **Advent Countdown schema**: Simplified — single `scripture` + `scriptureReference` fields, not 25 repeatable items. Matches scope boundary "simplified countdown only"
- **Countdown behavior year-round**: Always counts forward to next Dec 25. After Dec 25, rolls to following year. Shows "Merry Christmas!" on Dec 25 itself
- **DZ registration**: Mirror EasterDates — register in experience `blocks` DZ and `container-slot` `content` DZ only (NOT section `content` DZ)
- **MCP fallback**: If MCP cannot create Experience content, document the failure and fall back to seed script (`seed-christmas.ts`)
- **Quiz URL**: Reuse the same NextStep.is embed URL from Easter
- **Bible translations**: Match Easter's existing translation choices

## Technical Considerations

### Architecture

The experience page rendering pipeline is slug-agnostic — no changes needed to routing, `getWatchExperience()`, or the page components. The only new code is the `AdventCountdown` component and its supporting GraphQL/CMS infrastructure.

### MCP Limitations (Known Before Starting)

- REST API routes are NOT exposed for most content types (videos, experiences) — only content-manager API works, which requires admin JWT
- MCP is configured with API token auth, not admin JWT
- Component schemas are filesystem files — MCP cannot create them
- Dynamic zone payloads via REST are fragile in Strapi v5 (format: `__component` key, not `__typename`)

### Critical Learnings from docs/solutions/

- **Never skip codegen** after CMS schema changes — stale types are #1 source of runtime GraphQL errors
- **Use `{ set: [] }` not `null`** to clear Strapi v5 relations
- **Composite React keys** for dynamic zone rendering: ``key={`${item.kind}-${item.id}-${index}`}``
- **Verify dynamic zone membership** before adding fragment spreads
- **Content-manager sanitization** silently strips `populate` if role lacks permission
- **Mobile queries are local** (`apps/mobile/src/lib/graphql/queries.ts`) — not shared via gql.tada. Out of scope for this PR but noted

## System-Wide Impact

- **Interaction graph**: CMS content change → Strapi webhook fires → Next.js `/api/revalidate` receives event → `revalidatePath("/christmas")` and `revalidatePath("/christmas/en")` clear ISR cache → Next request fetches fresh data via `getWatchExperience("en", "christmas")`. Existing webhook handles this automatically since it fires on any Experience model update.
- **Error propagation**: If Strapi is down, `getWatchExperience` returns null → page renders 404 via `notFound()`. If AdventCountdown throws, entire page crashes (no `error.tsx` exists — pre-existing gap, out of scope).
- **State lifecycle risks**: MCP content creation is not transactional. Partial failure could leave an Experience with incomplete blocks. Mitigation: create Experience last after all referenced Videos exist.
- **API surface parity**: No other interfaces need the same change. Mobile app is out of scope.
- **Integration test scenarios**: No existing test infrastructure in `apps/web` — visual verification only.

## Acceptance Criteria

- [ ] `sections.advent-countdown` component schema exists in CMS with fields: `sectionKey`, `title`, `scripture`, `scriptureReference`, `locale`
- [ ] Component registered in experience `blocks` DZ and container-slot `content` DZ
- [ ] GraphQL codegen runs successfully with new component type
- [ ] `AdventCountdown.tsx` renders countdown to Dec 25, expandable/collapsible, Christmas gradient
- [ ] `ExperienceSectionRenderer` handles `ComponentSectionsAdventCountdown`
- [ ] `/watch/christmas` renders with hero, 6 narrative video sections, navigation carousel, Advent countdown, video collection carousel, NBC carousel, and invitation section
- [ ] Bible verses are Christmas-appropriate (Isaiah 7:14, Isaiah 9:6, Luke 2:10-14, John 1:14, etc.)
- [ ] MCP capability report documents: which operations succeeded, which failed, what workarounds were needed
- [ ] All content created via Strapi MCP (or failures documented with fallback to seed script)

## Implementation Phases

### Phase 1: MCP Capability Assessment

**Goal:** Determine what the Strapi MCP can and can't do before building anything.

Test incrementally:

1. **Read operations** — Query existing content types, videos, experiences via `strapi_rest`
   - `GET api/experiences` → expect 404 (REST not exposed) or data
   - `GET content-manager/collection-types/api::experience.experience` → expect 401 (needs admin JWT)
   - Try `strapi_get_content_types` and `strapi_get_components` → already confirmed working

2. **Write operations** — Attempt to create a minimal test video and test experience
   - `POST api/videos` with `{ data: { title: "test", slug: "mcp-test" } }` → expect 404
   - `POST content-manager/collection-types/api::video.video` → expect 401
   - Try enabling REST routes for Experience content type if needed

3. **Document results** in a findings table:
   | Operation | Endpoint | Result | Workaround |
   |-----------|----------|--------|------------|

4. **Decision gate:** If MCP can create Experiences → proceed with MCP-only. If not → enable REST routes or fall back to seed script. Document the decision.

**Files:** None modified (research only)

### Phase 2: CMS Schema — AdventCountdown Component

**Goal:** Add the new Strapi component for the Advent Countdown.

1. Create component schema file:

   `apps/cms/src/components/sections/advent-countdown.json`

   ```json
   {
     "collectionName": "components_sections_advent_countdowns",
     "info": {
       "displayName": "Advent Countdown",
       "icon": "calendar",
       "description": "Interactive countdown to Christmas with scripture"
     },
     "options": {},
     "attributes": {
       "sectionKey": {
         "type": "string"
       },
       "title": {
         "type": "string",
         "required": true
       },
       "scripture": {
         "type": "text"
       },
       "scriptureReference": {
         "type": "string"
       },
       "locale": {
         "type": "string"
       }
     }
   }
   ```

2. Register in dynamic zones:

   `apps/cms/src/api/experience/content-types/experience/schema.json` — add `"sections.advent-countdown"` to `blocks` array

   `apps/cms/src/components/sections/container-slot.json` — add `"sections.advent-countdown"` to `content` array

3. Restart Strapi to pick up new schema

**Files:**

- `apps/cms/src/components/sections/advent-countdown.json` (new)
- `apps/cms/src/api/experience/content-types/experience/schema.json` (edit)
- `apps/cms/src/components/sections/container-slot.json` (edit)

### Phase 3: GraphQL Codegen + Fragment

**Goal:** Generate types and create the GraphQL fragment for the new component.

1. Run Strapi locally (must be running for schema introspection)
2. Run codegen in `packages/graphql/` to regenerate introspection types
3. Create fragment file:

   `apps/web/src/lib/fragments/advent-countdown.ts`

   ```typescript
   import { graphql } from "@forge/graphql"

   export const adventCountdownFragment = graphql(`
     fragment AdventCountdown on ComponentSectionsAdventCountdown @_unmask {
       id
       sectionKey
       title
       scripture
       scriptureReference
       locale
     }
   `)
   ```

4. Export from `apps/web/src/lib/fragments/index.ts`

5. Add inline fragment spread to:
   - `apps/web/src/lib/fragments/container.ts` — in container-slot content DZ
   - `apps/web/src/lib/content.ts` — in `GET_WATCH_EXPERIENCE` blocks DZ (if AdventCountdown can appear as a top-level block)

6. Verify types compile: `pnpm tsc --noEmit` in `apps/web/`

**Files:**

- `packages/graphql/` — regenerated (codegen output)
- `apps/web/src/lib/fragments/advent-countdown.ts` (new)
- `apps/web/src/lib/fragments/index.ts` (edit)
- `apps/web/src/lib/fragments/container.ts` (edit)
- `apps/web/src/lib/content.ts` (edit)

### Phase 4: Web — AdventCountdown React Component

**Goal:** Build the interactive Advent Countdown component following EasterDates patterns.

1. Create `apps/web/src/components/sections/AdventCountdown.tsx`:
   - `"use client"` directive (uses useState, useEffect, useId)
   - Accept `FragmentOf<typeof adventCountdownFragment>` as `data` prop
   - Compute days until next Dec 25 at runtime
   - Replace `{year}` placeholder in title with target year
   - Show scripture text and reference below countdown
   - On Dec 25: show "Merry Christmas!" instead of countdown
   - After Dec 25: count forward to next year's Dec 25
   - Expandable/collapsible with responsive default (expanded desktop, collapsed mobile)
   - Christmas gradient: `from-green-800 via-red-800 to-amber-600` with noise texture overlay
   - Accessibility: `aria-expanded`, `aria-controls`, `useId()` for unique IDs

2. Add to section renderer:

   `apps/web/src/components/sections/index.tsx` — add case for `ComponentSectionsAdventCountdown`

**Files:**

- `apps/web/src/components/sections/AdventCountdown.tsx` (new)
- `apps/web/src/components/sections/index.tsx` (edit)

### Phase 5: Content Creation via Strapi MCP

**Goal:** Create all Christmas content using MCP tools exclusively. Document successes and failures.

Based on Phase 1 findings, use whichever MCP approach works. Expected content creation order:

1. **Create Video documents** (if MCP can write to videos):
   - `christmas-hero` — hero background video
   - `birth-of-jesus` — JESUS Film nativity segment (may already exist from core sync)
   - Videos for each of 6 narrative sections (LUMO Luke, LUMO Matthew, JESUS Film clips)
   - Verify NBC and Invitation videos already exist

2. **Create Christmas Experience** with all blocks:

   **Block 1: VideoHero**
   - heading: "Christmas"
   - subheading: "Christmas 2026 — the story of Jesus' birth through film, scripture, and reflection"
   - streamingUrl: (Mux HLS URL for Christmas background)
   - video: reference to christmas-hero video

   **Block 2: Main Section** (bg: dark)
   - NavigationCarousel with 6 items linking to each narrative section
   - Container: Text ("The Christmas Story") + AdventCountdown
   - First video section content (Prophecy & Annunciation)

   **Block 3: Video Bible Collection** (bg: purple)
   - MediaCollection carousel with LUMO Luke 1-2, LUMO Matthew 1-2, Magdalena Birth, StoryClubs Birth

   **Blocks 4-8: Narrative Video Sections** (bg: dark)
   Each following `buildVideoSectionContent` pattern:
   - sections.video (streamingUrl + video relation)
   - sections.container (text + related-questions side by side)
   - sections.bible-quotes-carousel (4 Christmas-themed quotes per section)
   - sections.quiz-button (NextStep.is embed)

   Section mapping:
   | # | sectionKey | Video | Heading | Bible Quotes |
   |---|-----------|-------|---------|-------------|
   | 4 | `mary-elizabeth-section` | LUMO Luke 1:1-56 | "Mary & Elizabeth: The Magnificat" | Luke 1:30-33, Luke 1:46-49, Isaiah 7:14, Luke 1:37 |
   | 5 | `birth-shepherds-section` | JESUS Film Birth / LUMO Luke 1:57-2:40 | "The Birth of Jesus & The Shepherds" | Luke 2:10-14, Luke 2:7, Micah 5:2, Isaiah 9:6 |
   | 6 | `magi-star-section` | LUMO Matthew 1:1-2:23 | "The Magi & The Star of Bethlehem" | Matthew 2:1-2, Matthew 2:10-11, Numbers 24:17, Psalm 72:10-11 |
   | 7 | `incarnation-section` | Life of Jesus "God's Word Becomes Flesh" | "The Word Became Flesh" | John 1:14, John 1:1-3, Philippians 2:6-8, Colossians 1:15-17 |
   | 8 | `the-story-section` | The Story Short Film (reuse from Easter) | "The Story: How It All Began" | Genesis 3:15, Isaiah 53:5, Romans 5:8, John 3:16 |

   **Block 9: NBC Carousel** (bg: primary)
   - VideoCarousel with 10 NBC videos (reuse from Easter)

   **Block 10: Invitation Section** (bg: dark)
   - Invitation to Know Jesus video + container + bible quotes (reuse from Easter)

3. **Verify the experience renders** at `http://localhost:3000/watch/christmas`

**Files:** None (MCP-only content creation). If MCP fails, fall back to:

- `apps/cms/src/bootstrap/seed-christmas.ts` (new, following seed-easter.ts pattern)

### Phase 6: Verification and MCP Report

**Goal:** Verify the page renders correctly and document MCP findings.

1. Start Next.js dev server (`pnpm dev` in `apps/web/`)
2. Navigate to `http://localhost:3000/watch/christmas`
3. Visual verification:
   - Hero renders with video background
   - Navigation carousel shows 6 section cards
   - Advent Countdown renders with correct countdown and scripture
   - Each video section renders with video player, text, Q&A, bible quotes
   - Collection carousel shows nativity videos
   - NBC carousel and invitation section render
4. Test Advent Countdown:
   - Expandable/collapsible works on mobile and desktop
   - Countdown math is correct for current date
5. Document MCP capability findings:

   | Operation                        | Tool/Endpoint              | Success? | Notes                |
   | -------------------------------- | -------------------------- | -------- | -------------------- |
   | Read content types               | `strapi_get_content_types` | Yes      | Works with API token |
   | Read components                  | `strapi_get_components`    | Yes      | Works with API token |
   | Create Video                     | `strapi_rest POST`         | ?        |                      |
   | Create Experience                | `strapi_rest POST`         | ?        |                      |
   | Create Experience with DZ blocks | `strapi_rest POST`         | ?        |                      |
   | Update Experience                | `strapi_rest PUT`          | ?        |                      |
   | Upload media                     | `strapi_upload_media`      | ?        |                      |

**Files:** MCP findings to be documented in commit message or as a `docs/solutions/cms/strapi-mcp-capability-findings.md`

## Dependencies & Prerequisites

- Strapi running locally at `localhost:1337` with existing component schemas
- Nativity videos either exist in Strapi (from core sync) or can be created
- Mux streaming URLs available for Christmas-related video content
- `@forge/graphql` codegen infrastructure working

## Risk Analysis & Mitigation

| Risk                                             | Likelihood | Impact | Mitigation                                        |
| ------------------------------------------------ | ---------- | ------ | ------------------------------------------------- |
| MCP cannot create Experiences (REST not exposed) | High       | High   | Fall back to seed script; document finding        |
| MCP cannot create Videos (REST not exposed)      | High       | Medium | Use existing synced videos or seed script         |
| Nativity videos don't exist in Strapi            | Medium     | Medium | Create via seed script or core sync trigger       |
| No Mux URL for Christmas hero video              | Medium     | Low    | Use an existing JESUS Film clip or placeholder    |
| Codegen fails with new component                 | Low        | High   | Follow exact EasterDates pattern to minimize risk |
| Dynamic zone payload format wrong via MCP        | Medium     | Medium | Test with minimal payload first (Phase 1)         |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-30-christmas-experience-page-requirements.md](docs/brainstorms/2026-03-30-christmas-experience-page-requirements.md) — Key decisions: narrative chronological order, Advent countdown as unique element, MCP-only content creation, reuse faith response sections

### Internal References

- Easter seed template: `apps/cms/src/bootstrap/seed-easter.ts`
- EasterDates component: `apps/web/src/components/sections/EasterDates.tsx`
- EasterDates fragment: `apps/web/src/lib/fragments/easter-dates.ts`
- Section renderer: `apps/web/src/components/sections/index.tsx`
- Experience schema: `apps/cms/src/api/experience/content-types/experience/schema.json`
- Container-slot schema: `apps/cms/src/components/sections/container-slot.json`
- GraphQL queries: `apps/web/src/lib/content.ts`
- Fragment barrel: `apps/web/src/lib/fragments/index.ts`
- Container fragment: `apps/web/src/lib/fragments/container.ts`

### Institutional Learnings

- ISR + Apollo: `docs/solutions/web/nextjs16-cachecomponents-isr.md`
- Schema drift: `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`
- Webhook seeding: `docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md`
- Relation clearing: `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md`
- Content type patterns: `docs/solutions/cms/strapi-enrichment-job-content-type.md`
- Server-side queries: `docs/solutions/graphql/server-side-strapi-queries-nextjs.md`
- Populate sanitization: `docs/solutions/cms/strapi-v5-populate-role-sanitization.md`

### Available Nativity Videos (from web research)

| Video                      | Source        | Slug                                                  | Duration |
| -------------------------- | ------------- | ----------------------------------------------------- | -------- |
| Birth of Jesus             | JESUS Film    | `jesus/birth-of-jesus`                                | 3:43     |
| Birth of Jesus             | Magdalena     | `magdalena/birth-of-jesus`                            | 3:43     |
| LUMO Luke 1:1-56           | LUMO Luke     | `lumo-the-gospel-of-luke/lumo-luke-1-1-56`            | 9:49     |
| LUMO Luke 1:57-2:40        | LUMO Luke     | `lumo-the-gospel-of-luke/lumo-luke-1-57-2-40`         | ~9:30    |
| LUMO Matthew 1:1-2:23      | LUMO Matthew  | `lumo-the-gospel-of-matthew/lumo-matthew-1-1-2-23`    | ~9:30    |
| God's Word Becomes Flesh   | Life of Jesus | `life-of-jesus-gospel-of-john/god-word-becomes-flesh` | 4:35     |
| StoryClubs: Birth of Jesus | StoryClubs    | `storyclubs/storyclubs-birth-of-jesus`                | 2:09     |
