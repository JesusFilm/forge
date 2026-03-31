---
date: 2026-03-30
topic: roadmap-backfill-completed-work
---

# Backfill Roadmap with Completed Work

## Problem Frame

The roadmap currently only contains forward-looking features (feat-001 through feat-021), all marked "not-started." The team has already shipped significant work across 263 commits over 7 weeks — CMS content modeling, web and mobile experience pages, infrastructure, data pipelines, and more. Without retrospective tickets, the roadmap undersells what's been built and doesn't demonstrate progress to stakeholders.

## Requirements

- R1. Create 12 roadmap feature files for completed/in-progress work, continuing the existing `feat-NNN` sequence (feat-022 through feat-033).
- R2. Each file follows the existing feature file format (YAML frontmatter with id, title, owner, priority, status, timeline, tags; body sections for Problem, Entry Points, Grep These, What To Build, Constraints, Verification).
- R3. All backfill tickets use `status: "complete"` except where work is ongoing (Tooling & DX, AI Video Enrichment Pipeline use `status: "in-progress"`).
- R4. Backfill tickets use a past timeline notation (e.g., `"Week -6 to -1"` or actual date ranges) to distinguish them from planned future work.
- R5. Update `docs/roadmap/README.md` to include the backfill tickets in the feature index tables and update the status summary to reflect completed work.

## The 12 Tickets

| ID       | Title                                          | Owner     | Lane              | Status      |
| -------- | ---------------------------------------------- | --------- | ----------------- | ----------- |
| feat-022 | CMS Foundation (Strapi v5 Content Modeling)    | tataihono | platform          | complete    |
| feat-023 | Web Experience Pages                           | nisal     | topic-experiences | complete    |
| feat-024 | Mobile App — Expo                              | ekkasit   | topic-experiences | complete    |
| feat-025 | Mobile App — iOS Native                        | urim      | topic-experiences | complete    |
| feat-026 | GraphQL Pipeline (Contract-First Typed Client) | tataihono | platform          | complete    |
| feat-027 | Infrastructure Evolution (AWS → Railway)       | tataihono | platform          | complete    |
| feat-028 | Content Sync Pipeline (Core Sync)              | nisal     | platform          | complete    |
| feat-029 | Easter Experience (First Production Launch)    | nisal     | topic-experiences | complete    |
| feat-030 | Video Content Discovery Dashboard              | vlad      | media-generation  | complete    |
| feat-031 | AI Video Enrichment Pipeline                   | vlad      | media-generation  | in-progress |
| feat-032 | Tooling & Developer Experience                 | tataihono | platform          | in-progress |
| feat-033 | Roadmap Dashboard App                          | tataihono | platform          | complete    |

## Success Criteria

- The roadmap README shows a mix of completed and planned work, giving stakeholders a full picture of progress.
- Every backfill ticket has enough body content (entry points, grep patterns, verification) to be useful as documentation, not just a label.
- The roadmap viewer app renders the completed tickets alongside planned ones.

## Scope Boundaries

- Backfill only — do not modify or renumber existing feat-001 through feat-021 tickets.
- Body content should be concise and retrospective (what was built, where it lives), not forward-looking specs.
- No changes to the roadmap viewer app code — it should already render any valid feature file.
- Android native app (3 commits, abandoned) is excluded.

## Key Decisions

- **Continue feat-NNN sequence**: Backfill tickets use feat-022+ rather than a separate prefix. Status "complete" distinguishes them.
- **Combined infrastructure ticket**: AWS and Railway are one ticket showing the evolution, not two separate tickets.
- **iOS included as complete**: Significant work was done; it served its purpose before consolidating on Expo.
- **VideoForge split into two tickets**: Discovery dashboard (identifying gaps) and AI enrichment pipeline (generating content) are distinct capabilities.
- **Single owner per ticket**: Matches existing roadmap convention, even when multiple people contributed.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Design] Exact timeline notation for past work — use date ranges like "Feb 17 – Mar 13" or relative week numbers.
- [Affects R2][Needs research] Body content depth — scan existing feature file examples to match the right level of detail for retrospective tickets.

## Next Steps

→ `/ce:plan` for structured implementation planning
