---
title: "feat: Backfill roadmap with completed work"
type: feat
status: completed
date: 2026-03-31
origin: docs/brainstorms/2026-03-30-roadmap-backfill-completed-work-requirements.md
---

# feat: Backfill Roadmap with Completed Work

## Overview

Create 12 roadmap feature files (feat-022 through feat-033) documenting work already completed or in progress, and update the README to include them. This makes the roadmap a complete picture of progress for stakeholders.

## Problem Frame

The roadmap only shows forward-looking work (feat-001 through feat-021, all "not-started"). 263 commits of shipped work across CMS, web, mobile, infrastructure, and tooling have no representation. (see origin: docs/brainstorms/2026-03-30-roadmap-backfill-completed-work-requirements.md)

## Requirements Trace

- R1. Create 12 feature files continuing the feat-NNN sequence (feat-022 through feat-033)
- R2. Each file follows the existing feature file format with adapted body sections for retrospective content
- R3. Status is `"complete"` except feat-031 (AI Video Enrichment) and feat-032 (Tooling & DX) which are `"in-progress"`
- R4. Timeline uses actual date ranges (e.g., `"Feb 17 – Mar 13"`) to distinguish from planned future work
- R5. Update `docs/roadmap/README.md` with backfill tickets in feature index tables and updated status summary

## Scope Boundaries

- Do not modify or renumber existing feat-001 through feat-021
- Body content is retrospective (what was built, where it lives), not forward-looking specs
- No changes to the roadmap viewer app
- Android native app (3 commits, abandoned) is excluded

## Context & Research

### Relevant Code and Patterns

- `docs/roadmap/platform/feat-004-web-app-onboarding.md` — example feature file with Entry Points, Grep These, What To Do, Constraints, Verification sections
- `docs/roadmap/topic-experiences/feat-001-architecture-contracts.md` — example with Decisions, Constraints, Verification
- `docs/roadmap/README.md` — feature index tables organized by lane (Content Discovery, Topic Experiences, Media Generation, Platform)
- Feature file frontmatter fields: `id`, `title`, `owner`, `priority`, `status`, `timeline`, `depends_on`, `blocks`, `tags`

### Adapted Body Sections for Retrospective Tickets

The existing format uses forward-looking sections ("What To Build", "What To Do"). For backfill tickets, adapt to:

- **Problem** → Why this work was needed (past tense)
- **Entry Points — Read These First** → Where the completed work lives (same format, pointing to current code)
- **Grep These** → Patterns to find the work in the codebase (same format)
- **What Was Built** → Summary of what was delivered (replaces "What To Build")
- **Constraints** → Boundaries that were followed (past tense where appropriate)
- **Verification** → How to confirm the work is in place (commands that work now)

## Key Technical Decisions

- **Date-range timelines**: Use `"Feb 12 – Mar 31"` style rather than relative weeks. Avoids confusion with the "Week 1-8" scheme used for planned work. Resolved from deferred question in origin doc.
- **Retrospective body format**: Adapt section names for past work while keeping the same structure. "What Was Built" replaces "What To Build". Resolved from deferred question in origin doc.
- **Priority for completed work**: All backfill tickets get `priority: "P0"` — they were the foundational work that everything else depends on.
- **depends_on / blocks**: Backfill tickets can reference each other where natural (e.g., CMS Foundation blocks Web Experience Pages) but don't need to link to future feat-001–021 tickets.

## Open Questions

### Resolved During Planning

- **Timeline notation**: Use actual date ranges like `"Feb 17 – Mar 13"`. Clearer for stakeholders, no ambiguity with future week numbering.
- **Body content depth**: Adapt existing section names for retrospective framing. Keep entry points and grep patterns detailed (they serve as documentation), but "What Was Built" can be a concise summary rather than a spec.

### Deferred to Implementation

- **Exact date ranges per ticket**: The implementer should use the git history analysis from the brainstorm conversation to set accurate date ranges per feature.
- **Cross-references in depends_on/blocks**: The implementer should add natural dependency links between backfill tickets where obvious (e.g., feat-022 CMS Foundation blocks feat-023 Web Experience Pages).

## Implementation Units

- [ ] **Unit 1: Create platform lane backfill tickets (feat-022, feat-026, feat-027, feat-032, feat-033)**

  **Goal:** Create 5 feature files in `docs/roadmap/platform/` for completed platform work.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Create: `docs/roadmap/platform/feat-022-cms-foundation.md`
  - Create: `docs/roadmap/platform/feat-026-graphql-pipeline.md`
  - Create: `docs/roadmap/platform/feat-027-infrastructure-evolution.md`
  - Create: `docs/roadmap/platform/feat-032-tooling-developer-experience.md`
  - Create: `docs/roadmap/platform/feat-033-roadmap-dashboard-app.md`

  **Approach:**
  - Each file uses the standard frontmatter format with `status: "complete"` (except feat-032 which is `"in-progress"`)
  - Timeline uses date ranges from the git history analysis
  - Body uses the adapted retrospective section format
  - Entry Points should reference the actual code paths that exist today
  - Tags should match the app or concern area (e.g., `["cms"]`, `["graphql"]`, `["infrastructure", "railway"]`, `["tooling"]`, `["roadmap"]`)

  **Patterns to follow:**
  - `docs/roadmap/platform/feat-004-web-app-onboarding.md` for structure
  - `docs/roadmap/platform/feat-005-graphql-contract-stewardship.md` for platform-level framing

  **Ticket details:**

  | ID       | Title                                          | Owner     | Status      | Timeline        |
  | -------- | ---------------------------------------------- | --------- | ----------- | --------------- |
  | feat-022 | CMS Foundation (Strapi v5 Content Modeling)    | tataihono | complete    | Feb 17 – Mar 13 |
  | feat-026 | GraphQL Pipeline (Contract-First Typed Client) | tataihono | complete    | Feb 12 – Mar 31 |
  | feat-027 | Infrastructure Evolution (AWS → Railway)       | tataihono | complete    | Mar 3 – Mar 31  |
  | feat-032 | Tooling & Developer Experience                 | tataihono | in-progress | Feb 12 – Mar 31 |
  | feat-033 | Roadmap Dashboard App                          | tataihono | complete    | Mar 30 – Mar 31 |

  **Verification:**
  - All 5 files exist in `docs/roadmap/platform/` with valid YAML frontmatter
  - Each file has Entry Points, Grep These, What Was Built, and Verification sections

- [ ] **Unit 2: Create topic-experiences lane backfill tickets (feat-023, feat-024, feat-025, feat-029)**

  **Goal:** Create 4 feature files in `docs/roadmap/topic-experiences/` for completed experience work.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None (can be done in parallel with Unit 1)

  **Files:**
  - Create: `docs/roadmap/topic-experiences/feat-023-web-experience-pages.md`
  - Create: `docs/roadmap/topic-experiences/feat-024-mobile-app-expo.md`
  - Create: `docs/roadmap/topic-experiences/feat-025-mobile-app-ios-native.md`
  - Create: `docs/roadmap/topic-experiences/feat-029-easter-experience.md`

  **Approach:**
  - Same format as Unit 1
  - Tags should include the app name (e.g., `["web"]`, `["mobile"]`, `["mobile", "ios"]`)
  - Easter Experience (feat-029) should reference the cross-cutting nature — it drove CMS, web, and mobile work

  **Ticket details:**

  | ID       | Title                                       | Owner   | Status   | Timeline        |
  | -------- | ------------------------------------------- | ------- | -------- | --------------- |
  | feat-023 | Web Experience Pages                        | nisal   | complete | Feb 17 – Mar 20 |
  | feat-024 | Mobile App — Expo                           | ekkasit | complete | Mar 2 – Mar 30  |
  | feat-025 | Mobile App — iOS Native                     | urim    | complete | Feb 25 – Mar 13 |
  | feat-029 | Easter Experience (First Production Launch) | nisal   | complete | Mar 10 – Mar 31 |

  **Verification:**
  - All 4 files exist in `docs/roadmap/topic-experiences/` with valid YAML frontmatter

- [ ] **Unit 3: Create media-generation lane backfill tickets (feat-030, feat-031)**

  **Goal:** Create 2 feature files in `docs/roadmap/media-generation/` for VideoForge work.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None (can be done in parallel with Units 1 and 2)

  **Files:**
  - Create: `docs/roadmap/media-generation/feat-030-video-content-discovery-dashboard.md`
  - Create: `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`

  **Approach:**
  - feat-030 covers the Manager dashboard for identifying content gaps
  - feat-031 covers the AI pipeline that generates enrichment content (status: `"in-progress"`)
  - Tags: `["manager", "ai-pipeline"]`

  **Ticket details:**

  | ID       | Title                             | Owner | Status      | Timeline        |
  | -------- | --------------------------------- | ----- | ----------- | --------------- |
  | feat-030 | Video Content Discovery Dashboard | vlad  | complete    | Mar 18 – Mar 25 |
  | feat-031 | AI Video Enrichment Pipeline      | vlad  | in-progress | Mar 18 – Mar 31 |

  **Verification:**
  - Both files exist in `docs/roadmap/media-generation/` with valid YAML frontmatter

- [ ] **Unit 4: Create content sync pipeline ticket (feat-028)**

  **Goal:** Create feature file in `docs/roadmap/platform/` for the core-sync pipeline.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None (can be done in parallel with all other units)

  **Files:**
  - Create: `docs/roadmap/platform/feat-028-content-sync-pipeline.md`

  **Approach:**
  - Covers gateway-sync → core-sync rename, incremental delta sync, bulk SQL upserts, language sync, snapshots, System Status dashboard
  - Tags: `["cms", "infrastructure"]`

  **Ticket details:**

  | ID       | Title                             | Owner | Status   | Timeline        |
  | -------- | --------------------------------- | ----- | -------- | --------------- |
  | feat-028 | Content Sync Pipeline (Core Sync) | nisal | complete | Mar 20 – Mar 31 |

  **Verification:**
  - File exists with valid frontmatter and retrospective body content

- [ ] **Unit 5: Update roadmap README**

  **Goal:** Add all 12 backfill tickets to the README feature index tables and update the status summary.

  **Requirements:** R5

  **Dependencies:** Units 1-4 (needs the final ticket details)

  **Files:**
  - Modify: `docs/roadmap/README.md`

  **Approach:**
  - Add a new section header "Completed Work" (or similar) within each lane table, or interleave completed tickets into existing tables — follow whichever reads better
  - Update the status summary at the top to reflect completed work (e.g., "Platform: 5 features complete, 4 planned")
  - Add backfill tickets to the appropriate lane tables: Platform (6 tickets), Topic Experiences (4 tickets), Media Generation (2 tickets)
  - Keep the existing Dependency Chain and Sequencing sections focused on future work — do not add completed work there

  **Patterns to follow:**
  - Existing table format in `docs/roadmap/README.md` — columns: ID, Feature, Owner, Priority, Timeline, Status

  **Verification:**
  - README contains all 12 new tickets in the correct lane tables
  - Status summary reflects the mix of completed and planned work
  - Existing feat-001 through feat-021 entries are unchanged

## System-Wide Impact

- **Roadmap viewer app**: Should render completed tickets without code changes — it reads all valid feature files from `docs/roadmap/` subdirectories. The `status: "complete"` value may need to be a recognized status in the viewer's UI (check that the viewer handles it gracefully).
- **No code changes**: This is purely documentation — no risk to running systems.

## Risks & Dependencies

- **Viewer status rendering**: The roadmap viewer may not style `status: "complete"` distinctly. If it doesn't, that's a separate follow-up, not a blocker for creating the files.
- **Date accuracy**: Timeline date ranges are approximations from git history. Minor inaccuracies are acceptable for retrospective documentation.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-30-roadmap-backfill-completed-work-requirements.md](docs/brainstorms/2026-03-30-roadmap-backfill-completed-work-requirements.md)
- Related code: `docs/roadmap/` (existing feature files and README)
- Git history analysis: conducted during brainstorm phase, covering 263 commits from Feb 12 – Mar 31 2026
