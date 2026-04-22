---
title: "feat: LLM-accessible roadmap via .md suffix and llms.txt"
type: feat
status: completed
date: 2026-04-01
origin: docs/brainstorms/2026-04-01-roadmap-llm-access-requirements.md
---

# feat: LLM-accessible roadmap via .md suffix and llms.txt

## Overview

Add markdown-format responses to every roadmap page via `.md` URL suffix, plus an `llms.txt` discovery file at the site root. This makes the roadmap fully accessible to LLM-based tools without changing existing HTML pages.

## Problem Frame

The roadmap viewer renders HTML only. LLM tools (executive assistants, automation agents) cannot programmatically query project status. Adding a markdown layer lets any LLM fetch `/llms.txt` to discover the site, then navigate summary and detail pages to answer questions like "What's blocked?" or "What is Tataihono working on?" (see origin: `docs/brainstorms/2026-04-01-roadmap-llm-access-requirements.md`)

## Requirements Trace

- R1. Every roadmap page supports a `.md` suffix returning `text/markdown` (e.g., `/roadmap.md`, `/lane/platform.md`, `/person/tataihono.md`, `/ticket/feat-001.md`)
- R2. List pages render as summary tables with drill-down links to `/ticket/[id].md`
- R3. Ticket detail pages render full feature content: structured header + complete markdown body
- R4. `/llms.txt` at the site root describes the roadmap structure and links to `.md` entry points
- R5. Markdown responses use `Content-Type: text/markdown; charset=utf-8` with appropriate cache headers

## Scope Boundaries

- No authentication — roadmap viewer is already public
- No new data model — continues reading from filesystem markdown files
- No changes to existing HTML pages — purely additive
- No webhook or real-time notification system

## Context & Research

### Relevant Code and Patterns

- `apps/roadmap/lib/features.ts` — exports `getAllFeatures()`, `getFeaturesByLane()`, `getFeaturesByOwner()`, `getFeatureById()`, `getStatusCounts()`, `getAllOwners()`, `getLaneLabel()`, `ALL_LANES`
- `Feature` type includes: `id`, `title`, `owner`, `priority`, `status`, `start_date`, `duration`, `timeline`, `lane`, `depends_on`, `blocks`, `tags`, `content`, `slug`
- Pages are async server components calling `features.ts` directly — no API layer
- `apps/roadmap/app/robots.ts` — existing metadata file convention
- No existing middleware or next.config rewrites

### External References

- [llmstxt.org](https://llmstxt.org/) — canonical spec: H1 title, blockquote summary, H2 sections with `[name](url): description` link lists, served as `text/plain; charset=utf-8`
- `llms-full.txt` — community convention that inlines all content into one file (not needed for V1 given drill-down approach)
- Next.js App Router: `route.ts` cannot coexist with `page.tsx` at the same route segment — must use rewrites or middleware to redirect `.md` requests to a separate route handler
- Next.js docs recommend `app/llms.txt/route.ts` pattern for custom metadata files (same as `sitemap.xml`)

## Key Technical Decisions

- **next.config rewrites over middleware**: The roadmap app has no basePath and no existing middleware. Declarative rewrites in `next.config.ts` are simpler and sufficient — `{ source: '/:path*.md', destination: '/api/md/:path*' }`. No runtime middleware overhead needed.
- **Single catch-all route handler**: One `app/api/md/[...slug]/route.ts` handles all `.md` requests. It parses the slug prefix (`roadmap`, `lane`, `person`, `ticket`) to determine which features.ts function to call and which markdown template to render. Centralizes all markdown generation logic.
- **llms.txt as a route handler**: `app/llms.txt/route.ts` dynamically generates the file from `getAllFeatures()` so it stays current with the roadmap data (status counts, lane lists, owner lists). No manual maintenance.
- **Markdown rendering as string templates**: Plain template literal functions that return markdown strings. No new dependencies needed — this is server-side string concatenation, not client-side rendering.

## Open Questions

### Resolved During Planning

- **Best Next.js pattern for .md suffix routing?** → `next.config.ts` rewrites to a catch-all API route. Simpler than middleware, no conflict with existing page.tsx files.
- **llms.txt format?** → Follow llmstxt.org spec: H1, blockquote, H2 sections with links. Serve as `text/plain; charset=utf-8`.

### Deferred to Implementation

- Exact markdown table formatting for list pages — will iterate on readability during implementation
- Cache header values — start with short TTL (e.g., `max-age=60`) since data is filesystem-based and changes infrequently

## Implementation Units

- [ ] **Unit 1: Markdown rendering utilities**

  **Goal:** Create functions that convert Feature data into markdown strings for each page type.

  **Requirements:** R2, R3

  **Dependencies:** None

  **Files:**
  - Create: `apps/roadmap/lib/markdown.ts`
  - Test: `apps/roadmap/lib/markdown.test.ts`

  **Approach:**
  - Export four functions: `renderRoadmapMarkdown(features)`, `renderLaneMarkdown(lane, features)`, `renderPersonMarkdown(person, features)`, `renderTicketMarkdown(feature)`
  - List page functions produce a summary header (status counts) followed by a markdown table with columns: Title, Status, Priority, Owner, Timeline, and a link column pointing to `/ticket/[id].md`
  - Ticket detail function produces a structured metadata block (status, priority, owner, timeline, lane, dependencies, tags) followed by the full `feature.content` markdown body
  - Accept a `baseUrl` parameter so links are absolute when needed
  - Pure functions with no side effects — easy to test

  **Patterns to follow:**
  - `apps/roadmap/lib/features.ts` for data access patterns and types

  **Test scenarios:**
  - Renders correct markdown table for a list of features with mixed statuses
  - Includes drill-down links in the correct format (`/ticket/feat-NNN.md`)
  - Ticket detail includes all metadata fields and full content body
  - Handles features with empty `depends_on` and `blocks` arrays
  - Handles features with `blocked` computed status

  **Verification:**
  - All rendering functions return valid markdown strings
  - Tests pass

- [ ] **Unit 2: Catch-all markdown route handler**

  **Goal:** Serve markdown responses for any `.md` URL via a single route handler.

  **Requirements:** R1, R2, R3, R5

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/roadmap/app/api/md/[...slug]/route.ts`

  **Approach:**
  - Parse the slug array to determine page type:
    - `["roadmap"]` → call `getAllFeatures()` + `renderRoadmapMarkdown()`
    - `["lane", laneName]` → call `getFeaturesByLane()` + `renderLaneMarkdown()`
    - `["person", personName]` → call `getFeaturesByOwner()` + `renderPersonMarkdown()`
    - `["ticket", ...idParts]` → call `getFeatureById(idParts.join('/'))` + `renderTicketMarkdown()`
  - Return 404 with plain text for unknown paths or missing features
  - Set `Content-Type: text/markdown; charset=utf-8` and `Cache-Control` headers
  - Validate lane names against `ALL_LANES` and person names against `getAllOwners()`

  **Patterns to follow:**
  - `apps/roadmap/app/robots.ts` for metadata file serving convention

  **Test scenarios:**
  - `/api/md/roadmap` returns markdown with status summary table
  - `/api/md/lane/platform` returns features filtered to that lane
  - `/api/md/person/tataihono` returns features filtered to that person
  - `/api/md/ticket/feat-001` returns full feature detail
  - Unknown paths return 404
  - Response headers are correct

  **Verification:**
  - Route handler responds with correct content type and valid markdown for each page type

- [ ] **Unit 3: next.config rewrites for .md suffix**

  **Goal:** Map `.md` suffix URLs to the catch-all route handler transparently.

  **Requirements:** R1

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `apps/roadmap/next.config.ts`

  **Approach:**
  - Add `rewrites()` to next.config that maps `/:path*.md` to `/api/md/:path*`
  - This makes `/roadmap.md` internally route to `/api/md/roadmap`, `/lane/platform.md` to `/api/md/lane/platform`, etc.
  - The browser URL stays as the `.md` version — the rewrite is internal

  **Patterns to follow:**
  - Existing `next.config.ts` is currently an empty config object — add only the rewrites

  **Test scenarios:**
  - `/roadmap.md` serves markdown (not 404, not HTML)
  - `/lane/platform.md` serves lane-filtered markdown
  - `/person/tataihono.md` serves person-filtered markdown
  - `/ticket/feat-001.md` serves full feature detail
  - Existing HTML pages are unaffected

  **Verification:**
  - Visiting `.md` URLs in a browser or via curl returns markdown content with correct headers
  - Existing HTML pages continue to work normally

- [ ] **Unit 4: llms.txt route handler**

  **Goal:** Serve a dynamically generated `llms.txt` discovery file at the site root.

  **Requirements:** R4

  **Dependencies:** Unit 3 (so links reference working `.md` URLs)

  **Files:**
  - Create: `apps/roadmap/app/llms.txt/route.ts`

  **Approach:**
  - Follow the llmstxt.org spec format:
    - H1: project name
    - Blockquote: one-line description of what the roadmap contains
    - H2 sections for: Overview (link to `/roadmap.md`), Lanes (links to each `/lane/[lane].md`), Team (links to each `/person/[person].md`), current status summary (inline counts of features by status)
  - Dynamically generate from `getAllFeatures()`, `ALL_LANES`, `getAllOwners()`, `getStatusCounts()`
  - Content-Type: `text/plain; charset=utf-8` per the llms.txt spec

  **Patterns to follow:**
  - `apps/roadmap/app/robots.ts` for metadata file convention in this app

  **Test scenarios:**
  - Response follows llmstxt.org format (H1, blockquote, H2 sections with links)
  - Links point to valid `.md` URLs
  - Status counts are accurate
  - All lanes and owners are listed
  - Content type is `text/plain`

  **Verification:**
  - Fetching `/llms.txt` returns a well-formed discovery file that an LLM can follow to navigate the entire roadmap

## System-Wide Impact

- **Interaction graph:** No callbacks or middleware affected. The rewrite rule and new route handlers are self-contained within `apps/roadmap/`.
- **Error propagation:** 404s from the route handler return plain text errors. No impact on existing error handling.
- **State lifecycle risks:** None — all data is read-only from filesystem at request time.
- **API surface parity:** The `.md` endpoints mirror the existing HTML page structure exactly. If a new HTML page is added later, a corresponding markdown template should be added.
- **Integration coverage:** Manual curl/fetch testing against the running dev server validates the full rewrite → route handler → markdown rendering chain.

## Risks & Dependencies

- **Rewrite pattern matching**: The `/:path*.md` pattern must not accidentally match static assets or other routes. Low risk since no other `.md` files are served by the app.
- **Feature data consistency**: Markdown output uses the same `features.ts` functions as HTML pages, so data is always consistent.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-01-roadmap-llm-access-requirements.md](docs/brainstorms/2026-04-01-roadmap-llm-access-requirements.md)
- Related code: `apps/roadmap/lib/features.ts`, `apps/roadmap/next.config.ts`
- External docs: [llmstxt.org](https://llmstxt.org/), [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
