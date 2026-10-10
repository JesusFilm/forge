---
title: "Admin-authored, Web-owned Experience block contract"
date: 2026-08-26
category: architecture-patterns
module: Watch Experience blocks
problem_type: architecture_pattern
component: frontend
severity: medium
applies_when:
  - "An editor must place, remove, reorder, and localize a Web-owned visual inside any Experience"
  - "The visual has expensive client-only initialization that should not join the initial page hydration path"
  - "A new Experience block crosses Admin validation, Pothos, gql.tada, and Web dispatch"
tags:
  - experience-editor
  - watch
  - admin
  - graphql
  - gql-tada
  - dynamic-import
  - performance
---

# Admin-authored, Web-owned Experience block contract

## Context

The Watch language globe began as a reusable Web component but was still
inserted by the homepage code after all authored blocks. That made its visual
implementation reusable while leaving its placement and promotional copy
hard-coded. Editors could not remove it, reorder it relative to another block,
or localize its heading and action through the Experience Editor.

Moving a Web-owned visual into the Experience model is a cross-layer change.
The persisted JSON needs a validated discriminator, the public API needs a
concrete union member, the typed consumer fragment needs to select it, and Web
needs to dispatch it without pulling an expensive canvas renderer into every
initial route chunk.

## Guidance

Treat the Experience block as an authored contract, not as a serialized
implementation. Store content and placement inputs such as eyebrow, title,
description, action fields, and a stable section key. Keep animation geometry,
rendering profiles, and performance heuristics inside the Web component that
owns the visual.

Add the contract through the complete pipeline:

1. Define the discriminated block in Admin's Zod union. If the block is a
   page-level composition, add it only to the top-level union and omit it from
   nested section or container unions.
2. Add a block-library starter, summary, editable controls, and an inline
   preview in the Experience Editor. Defaults should form a valid block before
   the editor changes any field.
3. Add the Pothos object and map its discriminator to the GraphQL typename.
   Include it only in the unions where the persisted schema permits it.
4. Regenerate the committed Admin SDL and gql.tada introspection instead of
   editing generated artifacts by hand.
5. Add a shared fragment for the new object, include it in the Watch
   Experience fragment dependency list, and include the same fragment in draft
   preview queries.
6. Add a Web renderer adapter that converts authored data into the existing
   visual component. Register the adapter in the block dispatcher and let the
   normal block map preserve editor order.

When the visual is expensive, keep the server-rendered surface and accessible
copy in the normal block path but defer the client renderer itself. A viewport
gate must control the dynamic import, not only whether an already-imported
component begins drawing. Otherwise module-scope decoding, projection, or
geometry setup still runs during initial hydration even when the canvas is far
below the fold.

Use an explicit immediate-load option for above-fold placements such as a 404
experience. The same authored-compatible section can therefore serve both
deferred Experience blocks and intentionally immediate standalone compositions
without duplicating the renderer.

## Why This Matters

An Experience remains the source of truth for composition only when the
consumer renders blocks in their stored order. Extracting a special block and
appending it later recreates hard-coded placement under a different name.

Separating authored content from implementation details also protects the
contract. Editors control what the section says and where it appears; Web can
change canvas density, animation scheduling, or responsive scale without a
content migration.

The import boundary is part of the performance design. Deferring only the draw
loop saves frames while off-screen, but it does not save JavaScript transfer,
module evaluation, or module-scope preprocessing. Deferring the module import
until the viewport threshold removes those costs from the cold path.

## When to Apply

- A custom visual must become placeable in the Experience Editor without
  exposing its rendering internals to editors.
- A block is valid only at the page level and should fail validation when
  nested in a section or container.
- A consumer uses a committed Pothos SDL and generated gql.tada introspection.
- A heavy client renderer is usually below the fold but must retain an
  immediate-loading mode for another surface.

## Examples

The language globe block stores promotional copy and action fields, while its
Web adapter owns the icon and passes the content into the shared globe section.
The homepage no longer appends a special globe after rendering the Experience;
the ordinary block dispatcher renders it exactly where the editor places it.

For deferred loading, the server-rendered section mounts a lightweight client
gate. The gate observes a stable placeholder and imports the canvas module only
after the surface approaches the viewport. Environments without
`IntersectionObserver` use a bounded fallback so the content remains available.

Verification should cover each contract boundary:

- valid top-level parsing and rejected nested parsing;
- editor insertion, defaults, editable fields, and summary;
- Pothos typename mapping plus SDL drift;
- shared fragment and preview fragment coverage;
- renderer dispatch and exact authored order;
- deferred import before intersection and immediate import when requested;
- desktop and mobile browser layout, overflow, console errors, and canvas
  appearance.

## Related

- `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`
  — the committed SDL and generated introspection contract used by Admin
  consumers.
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
  — the broader Watch lesson that static renderer imports can inflate initial
  route cost even when a block is not rendered.
- `CONCEPTS.md` — definitions for Experience and Experience Block.
- PR #2032 — pending implementation of the language globe block at the time
  this learning was captured.
