---
id: "feat-399"
title: "Watch animated language globe preview"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 1
depends_on: []
blocks:
  - "feat-400"
tags:
  - "web"
  - "watch"
  - "experiences"
  - "i18n"
  - "animation"
---

## Problem

Watch needs an expressive multilingual Experience section that communicates
global language availability. The visual direction is an ASCII-style globe on
a black stage, but it must use language names rather than random characters,
retain recognizable continent silhouettes, and be independently previewable
before Experience integration.

## Entry Points — Read These First

1. `apps/web/src/components/sections/LanguageGlobe.tsx` - reusable animated
   globe component and its public configuration surface.
2. `apps/web/src/app/(preview)/language-globe/page.tsx` - isolated visual
   preview route.
3. `apps/web/src/app/(preview)/language-globe/layout.tsx` - minimal Watch
   preview shell.
4. `apps/web/src/proxy.ts` - public preview-prefix bypass.
5. `apps/web/next.config.mjs` - opt-in worktree preview dependency root.
6. `.gitignore` - keep worktree dependency-directory symlinks untracked.
7. `/tmp/codex-clipboard-3481551a-70bb-4204-9f0e-e526feb9ae20.png` - selected
   visual reference.

## Grep These

- `LanguageGlobe`
- `requestAnimationFrame`
- `prefers-reduced-motion`
- `language-globe-canvas`

## What To Build

1. Render Matthew 24:14 through a geographic land mask as a rotating projected
   globe on a responsive HTML canvas. Use the public-domain original-language
   Greek source and as many verified public-domain translations as practical;
   render complete Scripture lines once per screen row and clip them through the
   rotating geographic land mask, preserving crisp type at every globe depth.
   Keep one complete translation readable above the texture and cycle through
   every included edition with a visible language name and sequence position.
2. Match the reference's near-black full-frame stage, quiet rounded border,
   and compact white typography. Use the final user-directed composition: an
   oversized globe centered below the viewport so only its top hemisphere is
   visible. Use a calm 120-second default rotation, a faint punctuation-marked
   atmospheric rim, and a sparse ASCII star halo with slow asynchronous shimmer
   that remains visually subordinate to the Scripture.
3. Pause animation for reduced-motion users, hidden documents, and offscreen
   components; keep an accessible text alternative.
4. Add a no-index standalone preview at `/watch/language-globe` without
   coupling the component to a published Experience block contract.
5. Generate the land mask from Natural Earth's public-domain 1:50m polygons so
   coastlines follow real geography rather than hand-drawn continent shapes.
   Restore sub-grid island groups and fine coastline breaks with sparse,
   geographically projected punctuation and special-character marks.
6. Keep animation work within a small main-thread budget by caching geographic
   projections, latitude geometry, verse metrics, and caption wrapping; avoid
   per-frame collection allocation/sorting and translation searches; cull
   off-canvas cells and batch canvas state changes. Adapt canvas density, land
   sampling, decorative detail, and cadence to viewport size and device
   capability: retain the full 24 fps renderer on desktop, use a compact 20 fps
   profile on regular phones, and a 16 fps profile on constrained phones. The
   two-minute rotation keeps angular movement small at every cadence.

## Constraints

- Do not add an image, video, WebGL, runtime map, or animation dependency.
- Do not add network requests or server data requirements.
- Do not wire the preview into the production Experience renderer yet.
- Keep the component responsive and safe to mount below the fold.

## Verification

- Focused component tests cover projection, the land mask, and accessible
  rendering.
- `@forge/web` targeted lint and typecheck pass.
- Browser QA compares the preview at `1128 x 724` with the selected reference,
  tests reduced motion, and reports console errors.
- Runtime performance evidence confirms no network resources and no animation
  loop before page load or while the component is offscreen.
- A visible-animation browser sample stays below 0.25 seconds of main-thread
  task time across a three-second interval at the target desktop viewport.
- Phone-size QA at `390 x 844` verifies the compact renderer, no overflow, and a
  three-second main-thread task-time sample below 0.10 seconds. Unit coverage
  verifies deterministic desktop, regular-phone, and low-power-phone profile
  selection.
