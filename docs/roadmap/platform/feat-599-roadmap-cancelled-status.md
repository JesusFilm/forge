---
id: "feat-599"
title: "Represent cancelled roadmap work as terminal"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-02"
duration: 1
depends_on: []
blocks: []
tags: ["infrastructure", "roadmap"]
---

## Problem

`apps/roadmap/lib/features.ts` maps cancelled work to `blocked`, so explicit
recommendation closeout decisions appear as unresolved work. The dashboard and
Markdown index do not distinguish cancelled scope from delivery blockers.

## Entry points

- `apps/roadmap/lib/features.ts`: parsing, effective dependency status and counts.
- `apps/roadmap/lib/markdown.ts`: generated index and Markdown views.
- `apps/roadmap/components/StatusBadge.tsx`, `StatusBoard.tsx` and
  `RoadmapTimeline.tsx`: status presentation.

## Constraints

Keep `canceled` as a historical spelling alias. A cancelled dependency does not
satisfy a dependent ticket; the dependent stays blocked until the dependency is
explicitly removed. Keep cancelled tickets out of overdue and open workload.
Do not regenerate `docs/roadmap/README.md` in this PR.

## Verification

Exercise fixture tickets for both spellings, dependency status, status counts,
Markdown output and overdue counts. Run roadmap lint, typecheck, format and
production build; compare page-loading performance before and after UI changes.

Verified with a fixture for both spellings, cancelled and duplicate-ID
dependencies, counts, overdue exclusion and Markdown output in Pacific/Auckland,
UTC and America/Los_Angeles. Roadmap lint, typecheck, production build and scoped
Prettier check passed. A three-run, fresh-browser comparison against current
main with the same ticket data found unchanged resource and script counts on
`/contributions` and `/lane/content-discovery`; transfer size rose 383 and 377
bytes respectively. Median load time was 479 → 445 ms and 337 → 343 ms. Legacy
`/ticket/<id>` links remain ambiguous when historical IDs collide; route
identity is outside this status change.
