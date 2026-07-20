---
title: "Use placement-only Experience blocks for static Web sections"
date: 2026-07-15
category: docs/solutions/design-patterns
module: apps/admin, apps/web
problem_type: design_pattern
component: development_workflow
severity: low
related_components:
  - "Experience Block"
  - "Homepage Experience"
  - "admin-graphql"
tags:
  - "experience-blocks"
  - "watch-home"
  - "server-rendering"
  - "graphql-contract"
  - "performance"
applies_when:
  - "Editors need to place a code-owned promotional section inside an Experience"
  - "The section has no authored payload beyond placement identity"
---

# Use placement-only Experience blocks for static Web sections

## Context

Some Watch homepage sections are designed and maintained in Web code but still
need editorial ordering inside the Homepage Experience. Modeling the complete
visual as authored block data would duplicate copy, layout, and animation
configuration without giving editors a useful control surface.

## Guidance

Use a strict placement-only Experience block whose stored payload contains only
its discriminator and optional `sectionKey`. Carry that identity through every
contract boundary, then render the complete section from a server component.

The Living Atlas implementation follows this path:

1. `apps/admin/src/domain/blocks.ts` validates `watchHomeLanguages` as a strict
   placement marker.
2. `apps/admin/src/graphql/types/blocks.ts` exposes the marker through the
   `ExperienceBlock` union.
3. `packages/admin-graphql/src/fragments/watch-experience.ts` selects the new
   union member for consumers.
4. `apps/web/src/components/sections/index.tsx` dispatches it to
   `WatchHomeLanguages`.
5. `apps/web/src/components/sections/WatchHomeLanguages.tsx` owns the static
   copy, canonical route, responsive layout, and progressive visual treatment.

Keep the block homepage-only in the editor when the section depends on homepage
context. Add it to the homepage seed so local and review environments exercise
the real Experience composition.

## Why This Matters

This preserves editor control over ordering without adding client fetching,
hydration, timers, canvas, WebGL, or a runtime animation dependency. It also
keeps one source of truth for the visual while the GraphQL discriminator remains
available to every consumer that must deliberately render or skip the block.

## When to Apply

- The section is code-owned and intentionally not configurable beyond placement.
- Editors need to insert or reorder it in one constrained Experience context.
- The visual can render from bundled assets and existing route helpers.

Do not use this pattern when editors must author copy, select content, or change
presentation variants; those inputs belong in the validated block schema.

## Examples

`watchHomeHero` and `watchHomeLanguages` are placement-only markers. The latter
renders a lazy-loaded image with explicit dimensions, CSS-only ambient motion,
and a `prefers-reduced-motion` fallback while remaining a React Server
Component.

When adding another marker, update and regenerate the admin schema and the
`packages/admin-graphql` gql.tada environment together. Never hand-edit the
generated environment output.

## Related

- `CONCEPTS.md` defines Experience, Experience Block, and Homepage Experience.
- `docs/roadmap/content-discovery/feat-262-watch-home-living-atlas.md` records
  the Living Atlas implementation scope and verification contract.
