---
id: "feat-276"
title: "3D Earth Language Orbit"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-07-23"
duration: 5
depends_on:
  - "feat-275"
blocks: []
tags:
  - "web"
  - "i18n"
  - "experience"
  - "webgl"
  - "accessibility"
  - "performance"
---

## Problem

The first Language Globe block proves the Admin-backed data and routing contract,
but its raw-WebGL sphere, geographic markers, and side labels cannot reproduce
the approved cinematic design. The experience needs a real textured Earth with
independent clouds, atmosphere, stars, and multilingual 3D text that passes in
front of and behind the planet.

## Entry Points — Read These First

1. `docs/plans/2026-07-23-001-feat-3d-earth-language-orbit-plan.md`
2. `apps/web/src/components/sections/LanguageGlobe.tsx`
3. `apps/web/src/components/sections/LanguageGlobeClient.tsx`
4. `apps/web/src/components/sections/language-globe-model.ts`
5. `docs/solutions/architecture-patterns/defer-browser-engines-beyond-experience-renderer-boundaries.md`
6. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`

## Grep These

- `LanguageGlobe|language-globe-webgl|language-globe-projection` in `apps/web/src/`
- `languageVideosIndexPath|publicSlug|nativeName` in `apps/web/src/`
- `requestAnimationFrame|visibilitychange|IntersectionObserver` in `apps/web/src/components/sections/`

## What To Build

1. Replace the simulated globe with an effect-time-loaded React Three Fiber
   scene containing Earth, a separately rotating cloud shell, restrained
   atmospheric rim, and deterministic star field.
2. Render the Admin-selected language names as local-font 3D text on one
   elliptical orbit with true depth-buffer occlusion and no backing ribbon.
3. Keep one stable semantic DOM link per selected language and preserve the
   canonical Watch language URL contract independently of WebGL readiness.
4. Add deterministic quality tiers, reduced-motion behavior, hidden/offscreen
   pausing, bounded context-failure handling, and a static accessible fallback.
5. Record dependency, asset, license, bundle, loading, and browser-performance
   evidence.

## Constraints

- Keep the existing `languageGlobe` Admin and GraphQL contract unchanged.
- Load Three/R3F/Troika only after the lightweight client shell mounts.
- Use only local runtime textures and fonts with checked-in attribution.
- Never use external Troika font fallback; unsupported scripts must degrade to
  a documented local visual fallback while their semantic DOM link remains.
- Do not navigate from the decorative canvas or restore the removed marker/card
  interface.
- Production deployment remains on the normal PR-to-main path.

## Verification

- Pure tests cover orbit clearance, direction/font selection, quality tiers,
  and reduced motion.
- Component tests cover effect-time loading, semantic links, pause state,
  ready fade, and terminal fallback.
- Focused Web tests, lint, typecheck, production build, and `git diff --check`
  pass.
- Desktop, 390 px mobile, and 320 px narrow-mobile browser proof confirms
  framing, shaping, depth occlusion, motion, fallback, and no overflow.
- Runtime evidence records lazy request timing, asset/chunk weights, frame
  behavior, and no Three/orbit resources on a route without the block.

## Component Usage

`EarthLanguageOrbitCanvas` is the typed client-only scene API. Callers provide a
sized container; the component observes its own width when `width` is omitted.
The production Watch integration imports it after page load and near-viewport
idle time from `LanguageGlobeClient`, which also owns the SSR-safe image
fallback and semantic links.

```tsx
<EarthLanguageOrbitCanvas
  className="h-[38rem] w-full"
  languages={languages}
  autoRotate
  quality="auto"
  earthRotationSeconds={64}
  textOrbitSeconds={26}
  initialLongitude={-100}
  showClouds
  showAtmosphere
  showStars
  onReady={() => setReady(true)}
/>
```

Set `reducedMotionOverride` only when a host already owns the media preference;
otherwise the component observes `prefers-reduced-motion` itself.
