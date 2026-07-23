---
title: Defer browser engines beyond experience renderer boundaries
date: 2026-07-21
category: architecture-patterns
module: web experience blocks
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - A server-rendered experience block has an optional browser-only animation or rendering engine
  - Route entry JavaScript must remain independent of whether the block appears on a page
tags: [nextjs, turbopack, dynamic-import, webgl, bundle-size, experience-blocks]
---

# Defer browser engines beyond experience renderer boundaries

> **Supersession note (2026-07-23):** The loading-boundary pattern remains
> authoritative. The 3D Earth Language Orbit in `feat-276` replaced the
> raw-WebGL implementation named below with an effect-time-loaded
> `EarthLanguageOrbitCanvas.tsx` / `EarthLanguageOrbitScene.tsx` R3F subtree.
> The old filenames are retained in the historical context only.

## Context

Experience block renderers in `apps/web/src/components/sections/index.tsx` use
`next/dynamic`, but that boundary alone does not prove that a browser-only
engine is absent from the route's entry JavaScript. The language globe block
initially kept its WebGL shader and lifecycle code in the client component.
Production output inspection showed that the engine still needed a narrower
loading boundary.

## Guidance

Keep the accessible, server-renderable block shell in the component selected by
the experience registry. Move the optional browser engine into its own module,
then import that module from an effect only when the component has enough data
and DOM nodes to start it.

The language globe follows this split:

- `LanguageGlobe.tsx` resolves Admin-backed language metadata and contains
  upstream failures to the block.
- `LanguageGlobeClient.tsx` owns authored copy, semantic links, the static
  fallback, reduced-motion state, and the effect-time import.
- `EarthLanguageOrbitCanvas.tsx` owns the optional R3F Canvas and renderer
  lifecycle.
- `EarthLanguageOrbitScene.tsx` owns textures, geometry, shaders, depth-tested
  orbit text, animation, context-loss handling, and cleanup.

The client shell uses the following shape:

```ts
useEffect(() => {
  if (!hasGlobe) return

  let disposed = false
  let Scene: ComponentType<EarthLanguageOrbitCanvasProps> | null = null

  void import("./EarthLanguageOrbitCanvas").then(
    ({ EarthLanguageOrbitCanvas }) => {
      if (disposed) return
      Scene = EarthLanguageOrbitCanvas
      setOrbitCanvas(() => Scene)
    },
  )

  return () => {
    disposed = true
    setOrbitCanvas(null)
  }
}, [hasGlobe])
```

The shell must prevent late imports from reviving an unmounted scene. The R3F
subtree and its scene effects must stop animation, disconnect observers, remove
listeners, and dispose manual Three resources when unmounted. Keep semantic
links outside the canvas so navigation works before the import resolves and
when WebGL fails.

Do not infer success from source structure. Run a production build, find the
engine's unique asset or symbol in `.next/static/chunks`, and verify the
resulting chunk is absent from the route's entry-file list in the page client
reference manifest. Record both raw and gzip sizes for the deferred module and
enforce any feature-specific asset budget.

## Why This Matters

An optional visual enhancement should not increase first-load JavaScript for
pages that do not render it. A narrower effect-time boundary also makes the
fallback contract explicit: the authored content and language destinations are
available independently of WebGL, texture loading, animation, and GPU context
lifetime.

## When to Apply

- A block uses WebGL, canvas animation, a map renderer, or another browser-only
  engine.
- A shared registry already uses `next/dynamic`, but production artifacts still
  place engine symbols in an entry chunk.
- The interactive enhancement can start after hydration without reducing the
  meaning or navigability of the server-rendered shell.

## Examples

For a globe, map, or chart block, render headings, descriptions, status text,
and links before importing the engine. Pass DOM elements and state accessors to
the runtime instead of importing React into the runtime. On disposal, cancel
every external callback source owned by the engine.

## Related

- [Frontend change page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
- [Watch route performance campaign](../performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md)
- [Language globe implementation plan](../../plans/2026-07-21-001-feat-language-globe-experience-block-plan.md)
