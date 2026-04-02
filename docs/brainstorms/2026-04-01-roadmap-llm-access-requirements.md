---
date: 2026-04-01
topic: roadmap-llm-access
---

# LLM-Accessible Roadmap

## Problem Frame

The roadmap viewer app renders HTML pages for human consumption, but LLM-based tools (executive assistants, automation agents, CI bots) have no way to programmatically access roadmap data. An executive assistant should be able to fetch project status, drill into specific features, and understand what's in progress, blocked, or complete — without scraping HTML.

## Requirements

- R1. Every roadmap page supports a `.md` suffix that returns a `text/markdown` response with the same data as the HTML version (e.g., `/roadmap.md`, `/lane/platform.md`, `/person/tataihono.md`, `/ticket/feat-001.md`)
- R2. List pages (`/roadmap.md`, `/lane/[lane].md`, `/person/[person].md`) render as summary tables (title, status, priority, owner, timeline) with links to individual `/ticket/[id].md` detail pages for drill-down
- R3. Ticket detail pages (`/ticket/[...id].md`) render the full feature content: frontmatter fields as a structured header, plus the complete markdown body
- R4. An `llms.txt` file is served at the site root describing the roadmap structure, available URL patterns, and linking to the main `.md` entry points — following the llms.txt convention for LLM discovery
- R5. Markdown responses set `Content-Type: text/markdown; charset=utf-8` and appropriate cache headers

## Success Criteria

- An LLM tool can fetch `/llms.txt`, discover available pages, fetch `/roadmap.md` for an overview, and drill into any feature via `/ticket/feat-NNN.md` — all without prior knowledge of the site structure
- Markdown output is structured, scannable, and contains enough context for an LLM to answer questions like "What's Tataihono working on?" or "What features are blocked?"

## Scope Boundaries

- No authentication or API keys — the roadmap viewer is already public
- No new data model or database — continue reading from filesystem markdown files
- No changes to the existing HTML pages — this is additive only
- No webhook, push, or real-time notification system

## Key Decisions

- `.md` suffix over query params or Accept header: simplest to share, discover, and construct programmatically
- Summary + drill-down over full inline detail: keeps list pages concise while allowing depth on demand
- `llms.txt` as discovery entry point: growing convention, low cost, high discoverability

## Dependencies / Assumptions

- The roadmap viewer app is publicly accessible (or will be by the time this ships)
- `lib/features.ts` already exposes all necessary query functions — no new data layer needed

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Best Next.js pattern for `.md` suffix routing — middleware rewrite, catch-all route, or route handler per page?
- [Affects R4][Needs research] Exact llms.txt format convention — check current community spec for structure

## Next Steps

→ `/ce:plan` for structured implementation planning
