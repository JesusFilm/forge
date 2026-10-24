---
date: 2026-04-23
topic: tv-section-background-consistency
---

# TV Section Background Consistency

## Problem Frame

Section backgrounds on the TV app are set by CMS editors using semantic names (`primary`, `cosmic`, `purple`, `default`, `dark`, `light`) that `apps/tv/src/components/sections/SectionWrapperRenderer.tsx` maps to saturated Tailwind-derived colors — deep blue (`#1e3a8a`), indigo (`#1e1b4b`), purple (`#581c87`), cool stone gray (`#292524`). On a 10-foot TV in a dark room, these render as jarring blocks of color that break immersion and clash with the Crimson Gallery warm-stone palette that governs the rest of the app.

The map was inherited verbatim from mobile, which uses a different visual system. TV needs its own palette that honors Crimson Gallery tokens and produces a cohesive, cinematic experience as the viewer scrolls through a mixed-kind experience page.

---

## Requirements

**Palette**

- R1. TV section backgrounds must render only values from the existing Crimson Gallery token set in `apps/tv/src/lib/colors.ts` — no standalone hues outside that palette.
- R2. Adjacent sections should produce visible but subtle tonal hierarchy (a "lift" feeling) without using chromatic color (no blue, purple, indigo, etc.).
- R3. The palette must collapse to three tiers to support alternation: base, lifted, and high-lift.

**CMS contract**

- R4. The CMS `backgroundColor` field and its semantic values (`default`, `dark`, `light`, `primary`, `cosmic`, `purple`) stay intact; editors do not need to change content. TV simply remaps what those names render as.
- R5. Every semantic value must map to exactly one of the three Crimson Gallery surface tiers. Mapping is deterministic.
- R6. Hex pass-through on section wrappers is removed on TV: if an editor ever sets a literal hex on a section (currently unused in production data), TV ignores it — `sectionBackgroundColor` returns `undefined`, and the wrapper renders without an explicit `backgroundColor`, so the parent surface (the app base, `#161311`) shows through. Same visual outcome as "falls back to base surface"; the wrapper simply doesn't paint its own background for unknown values. This prevents a future editor from re-introducing a blue/purple block.

**Platform scope**

- R7. Change is TV-only. `apps/mobile/src/components/sections/SectionWrapperRenderer.tsx` is untouched. No shared package extraction in this pass.

---

## Success Criteria

- Scrolling through an experience page (Easter, Christmas, New Believer, etc.) on Apple TV and Android TV produces a single visual family — warm-stone surfaces only, no blue or purple blocks.
- Sections still feel distinct from each other (no monolithic flat wall) thanks to the three-tier lift.
- A design reviewer comparing the four screenshots in the brainstorm input against the new build would agree "the app now looks like the Crimson Gallery."
- A downstream implementer can make the change in one file without needing to invent any color values — every value is already in `colors.ts`.

---

## Scope Boundaries

- Not changing mobile. Mobile's SECTION_BACKGROUND_COLORS stays on Tailwind blues/purples.
- Not changing per-item backgrounds rendered by `BibleQuotesCarouselRenderer` or `NavigationCarouselRenderer`. Those use literal hex from the CMS per-quote/per-card (warm tans, oxbloods, plums) and already look cohesive in the screenshots.
- Not introducing gradients, image backgrounds, or radial lighting effects. The existing `backgroundImageUrl` path in `SectionWrapperRenderer` is untouched.
- Not extracting a shared `@forge/design-tokens` package. That is a separate refactor if the TV palette ever needs to be reused.
- Not changing the CMS schema, the Strapi field, or the set of allowed semantic values.
- Not adding new Crimson Gallery tokens. Only the four existing surface tokens (`surface`, `surfaceContainer`, `surfaceContainerHigh`, `surfaceContainerHighest`) are used.

---

## Key Decisions

- **Warm-stone alternation over flat single surface.** The Crimson Gallery spec explicitly says "No 1px borders — use background color shifts," so sections are expected to lean on tonal variation for hierarchy. A single flat surface would lose that affordance.
- **Three tiers, not six.** Collapsing the six CMS semantic names onto three surface tokens keeps editorial intent (lightest vs. darkest sections) while guaranteeing no off-palette color ever renders.
- **TV forks the map, doesn't share it.** Mobile is live and has audience familiarity with its current look; TV is pre-launch. Forking minimizes blast radius and lets TV ship independently.
- **`light` collapses into the brightest dark surface on TV, not to a near-white tone.** A `#f5f5f4` surface on a 10-foot screen in a dark room would be physically uncomfortable; TV's "lightest" is still dark.
- **Hex pass-through removed on TV section wrappers.** The escape hatch has no legitimate use today and is a foot-gun for the consistency guarantee above.

---

## Dependencies / Assumptions

- Assumes the current seed data and production CMS content do not rely on raw-hex section backgrounds — verified against `apps/cms/src/bootstrap/seed-easter.ts` where section-level `backgroundColor` is always a named token, and per-item hex lives on bible quote / nav carousel items that use different renderers.
- Assumes the Crimson Gallery palette in `apps/tv/src/lib/colors.ts` is stable — no other in-flight work is redefining those tokens.

---

## Proposed Semantic → Surface Mapping

This belongs in the requirements doc because it is the product decision, not an implementation detail:

| CMS semantic | Tier      | Crimson Gallery token  | Hex       |
| ------------ | --------- | ---------------------- | --------- |
| `default`    | base      | `surface`              | `#161311` |
| `dark`       | base      | `surface`              | `#161311` |
| `primary`    | lifted    | `surfaceContainer`     | `#221F1D` |
| `light`      | lifted    | `surfaceContainer`     | `#221F1D` |
| `cosmic`     | high-lift | `surfaceContainerHigh` | `#2D2927` |
| `purple`     | high-lift | `surfaceContainerHigh` | `#2D2927` |

Rationale for groupings:

- `default` and `dark` both read as "no editorial emphasis" — send them to the app base so they dissolve into the page background.
- `primary` and `light` are mid-emphasis signals — a mild lift is enough to distinguish them.
- `cosmic` and `purple` were the boldest color choices on mobile — preserve that "this section stands out" intent at the highest warm-stone tier.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Do any TV renderers or downstream styles read `section.backgroundColor` directly to compute contrast (e.g., gradient overlays, text color inversion)? A grep during planning confirms whether the change is purely visual or needs paired contrast work.
- [Affects R2][Needs research] Worth a quick A/B of `surfaceContainerHighest` (`#383432`) vs. `surfaceContainerHigh` (`#2D2927`) for the "high-lift" tier on a real Apple TV 4K screen — on-monitor preview can mislead. Resolve during planning's TV device test step.

---

## Next Steps

→ `/ce-plan` for structured implementation planning.
