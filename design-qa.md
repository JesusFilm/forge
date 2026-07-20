# Living Atlas design QA

## Comparison target

- Source visual truth: `C:/Users/pavot/.codex/generated_images/019f66fb-5ab9-73d1-b90c-39245be85a28/exec-eedd9a3d-0525-474c-89fe-565a9993c768.png`
- Initial implementation: `C:/Users/pavot/.codex/visualizations/2026/07/15/019f66fb-5ab9-73d1-b90c-39245be85a28/living-atlas-desktop.png`
- Final full-view implementation: `C:/Users/pavot/.codex/visualizations/2026/07/15/019f66fb-5ab9-73d1-b90c-39245be85a28/living-atlas-3d-africa-centered.png`
- Final focused globe implementation: `C:/Users/pavot/.codex/visualizations/2026/07/15/019f66fb-5ab9-73d1-b90c-39245be85a28/living-atlas-3d-final-africa.png`
- Viewport: 1661 x 947 desktop; responsive metrics also checked at 390 x 844.
- State: default dark theme with a continuously rotating WebGL Earth, ambient
  atmosphere, stars, shimmer, and language-label animations running.

The source and final implementation were opened together in the same comparison
input. A focused globe capture was also compared because texture, lighting,
spherical depth, and edge quality are now the primary fidelity surfaces.

## Comparison history

### Iteration 1

- [P2] The globe raster's near-black square remained distinguishable from the
  section's `#050505` background.
- [P2] The globe drift and floating labels did not provide enough atmospheric
  motion around the artwork.

### Fixes

- Added a soft circular alpha mask around the globe raster and `screen` blending
  so black pixels resolve to the section background without a visible square or
  circular plate.
- Added two star fields, a warm/cool breathing aura, and a periodic surface
  shimmer. Every animation changes only `transform` and `opacity`; filters and
  masks remain static.
- Added a complete reduced-motion fallback that stops the globe, labels, aura,
  stars, and shimmer and removes their `will-change` hints.

### Post-fix evidence

- The final desktop capture shows no rectangular raster boundary.
- Computed star opacity/transform and aura transform changed across a 500 ms
  observation, confirming the atmosphere is active.
- At 390 px, the document retained a 375 px layout width with no horizontal
  overflow; the existing mobile stack and language labels remain unchanged.

### Iteration 2

- [P2] The soft mask crossed into the rendered sphere, feathering the outer rim
  and making the globe feel less physical than the source artwork.

### Sharp-edge fix

- Moved the circular safety clip outside the sphere artwork with a near-hard
  49.2% to 49.5% transition. The source image now defines the visible planet
  edge while `screen` blending continues to remove the square black raster
  background.
- Kept the star fields, breathing atmosphere, surface shimmer, and reduced-motion
  behavior unchanged.

### Final evidence

- The source reference and sharp-edge implementation were opened together in a
  single visual comparison. The globe now has a crisp, continuous rim with no
  visible rectangular image boundary.
- The local preview loaded successfully at `http://127.0.0.1:3198/` and reported
  no browser console errors.

### Iteration 3

- [P2] The drift animation was attached to the globe image inside a stationary
  circular mask. During motion, the artwork visibly slid beneath the fixed crop,
  weakening the illusion of a physical globe.

### Unified-motion fix

- Added one globe-motion wrapper around the atmosphere, hard mask, globe image,
  and shimmer. The drift now transforms that wrapper while the mask and image
  retain `transform: none`, so the entire planet moves as one object.
- Kept the two star fields and language labels outside the wrapper so their
  independent ambient motion remains intact.

### Unified-motion evidence

- Computed styles sampled 900 ms apart showed the globe-motion wrapper changing
  transform while both the mask and image remained at `none` in both samples.
- The source reference and the unified-motion screenshot were opened together in
  one comparison input. The globe retains its crisp continuous rim, seamless
  background treatment, layout, typography, and content hierarchy.

### Iteration 4

- [P1] The user clarified that the globe must be an actual rotating 3D model,
  not a photorealistic raster moving as a single layer.

### Rotating-model fix

- Replaced the visible raster with a real tessellated WebGL sphere using NASA's
  2048 x 1024 Blue Marble equirectangular Earth texture. The model rotates around
  its axis continuously and uses per-pixel directional lighting, a shaded
  terminator, gamma correction, tone mapping, and atmospheric rim light.
- Kept Africa as the initial focal region and retained the approved labels,
  stars, aura, shimmer, layout, CTA, and section copy.
- Added a 274 KB generated WebP fallback for browsers without WebGL. The primary
  texture is 594 KB, device pixel ratio is capped at 2, no third-party animation
  or 3D dependency was added, and reduced motion renders one stationary frame.

### Rotating-model evidence

- Successive browser captures showed Africa, then the Indian Ocean and Pacific
  as the same sphere continued rotating; the canvas rendered at 1083 x 1083 in
  the observed desktop viewport and the raster fallback faded out after the
  first WebGL frame.
- The source, full-view 3D implementation, and focused Africa frame were compared
  together. The globe remains inside the approved visual slot with a crisp limb,
  realistic cloud/ocean detail, and no square raster boundary.
- The refreshed local preview reported no browser console errors.

## Required fidelity surfaces

- Fonts and typography: unchanged from the approved implementation; hierarchy,
  weights, wrapping, and native-script rendering remain intact.
- Spacing and layout rhythm: unchanged; the mask and effects stay within the
  existing square visual slot and do not move copy, CTA, or labels.
- Colors and visual tokens: atmosphere reuses the globe's restrained amber and
  blue palette on the existing cinematic black surface; physically shaded Earth
  color replaces the intentionally removed engraved illustration treatment.
- Image quality and asset fidelity: the rotating sphere uses NASA Blue Marble
  satellite imagery with a 72 x 72 segment mesh, directional light, shaded depth,
  a sharp circular limb, and a generated realistic fallback. Replacing the flat
  illustration is an intentional user-requested departure from the source.
- Copy and content: unchanged, including the canonical language-library CTA and
  Arabic, Devanagari, and Japanese labels.

## Interaction, accessibility, and performance

- The primary CTA remains a semantic link with a visible focus treatment and a
  minimum 48 px target.
- The decorative visual remains hidden from the accessibility tree.
- The section copy and CTA remain server-rendered. Only the decorative globe is a
  client island with WebGL initialization and `requestAnimationFrame`, explicitly
  added for the requested true 3D rotation; no animation-library dependency or
  runtime network request was added.
- The refreshed local preview reported no browser console errors.
- Focused component tests pass and the touched source files pass Prettier.
- Full Web typecheck remains blocked by pre-existing `never`-typed video-player
  errors outside this feature; no `RotatingGlobe` error appeared in that output.

## Findings

No actionable P0, P1, or P2 findings remain. The globe now satisfies the clarified
requirement for real model rotation while preserving the established composition.

final result: passed
