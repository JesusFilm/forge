---
date: 2026-03-30
topic: roadmap-experiments-page
---

# Experiments Page on Roadmap

## Problem Frame

Stakeholders and non-technical team members need a single place to see what JFP is actively building and demo each project. Currently there is no overview of live experiments — people have to know the URLs and context independently. An "Experiments" page on the roadmap app gives everyone a clear, friendly summary of each project with one-click access to demos.

## Requirements

- R1. Add a new `/experiments` route to the roadmap app that displays four project cards.
- R2. Each card shows: a non-technical description (2-3 sentences), the team members responsible (with avatars from existing `getOwnerProfile`), and a prominent "View Demo" button linking to the live project.
- R3. Descriptions should be written for a non-technical audience — explain what the project does and why it matters, not how it's built.
- R4. Add an "Experiments" link under "About" in the Sidebar navigation.
- R5. The four projects are:

  **1. Easter Experience** — The first demonstration of a manually curated CMS experience that flows from content management to a polished front-end page. Shows what's possible when editorial teams craft a themed viewing experience by hand.
  - Demo: https://watch.jesusfilm.org/watch/easter
  - Team: Urim, Nisal, Tataihono

  **2. AI-Generated Christmas Experience** — An experience page created entirely by AI, drawing from content across the internet, the Bible, and our video library. Demonstrates how AI can assemble a complete themed experience automatically.
  - Demo: https://watch.jesusfilm.org/watch/christmas
  - Team: Ekkasit

  **3. Mobile App** — A native mobile app built on top of the experience platform, bringing curated and AI-generated content to phones. Expo-based, currently in preview.
  - Demo: link TBD (Expo link to come)
  - Team: Urim

  **4. Content Warehouse** — The data backbone behind everything: a content management system paired with a manager interface and data enrichment pipeline. This is where all video content is organized, enriched, and made available to other projects.
  - Demo: https://manager.jesusfilm.org + https://cms.jesusfilm.org (both linked)
  - Team: Vlad, Nisal, Tataihono

## Success Criteria

- Non-technical visitors can understand what each project does within 10 seconds of reading.
- Every project has a working demo link (except Mobile, which shows "Coming Soon" until the Expo link is provided).
- The page is discoverable from the sidebar under About.

## Scope Boundaries

- Static/hardcoded content only — no markdown files or database. Same pattern as the existing About page.
- No analytics, no filtering, no interactive features beyond the demo links.
- Descriptions are final as written above (can be tweaked during implementation for tone).

## Key Decisions

- **Hardcoded content, not markdown-driven**: Matches the About page pattern. These four projects are stable enough to not need dynamic rendering.
- **Content Warehouse shows both links**: Manager and CMS presented together on one card with two buttons (e.g., "Manager" and "CMS") rather than separate cards.
- **Sidebar placement**: Listed under About, not as a top-level nav item, to keep the sidebar clean.

## Outstanding Questions

### Deferred to Planning

- [Affects R5.3][Pending] Mobile app Expo link — use a "Coming Soon" state until the URL is provided.
- [Affects R2][Design] Card layout and visual style — follow existing roadmap app design patterns (Tailwind, consistent with About page cards).

## Next Steps

-> `/ce:plan` for structured implementation planning
