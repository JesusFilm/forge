# TV SDUI Renderer Parity with Mobile-v2

**Date:** 2026-04-14
**Owner:** urim
**Status:** Requirements captured, ready for planning

## Problem

The TV app's `SectionDispatcher` handles only a subset of the SDUI block kinds that mobile-v2 supports. On a real Experience, any block whose `kind` isn't in that subset falls through to `PlaceholderRenderer` (a silent `return null`). That leaves visible holes in the vertical Experience feed where mobile-v2 users see rich content.

Concretely, the following mobile-v2 block renderers have **no TV counterpart**:

| Block kind           | Mobile renderer              | Lines | Role                                             |
| -------------------- | ---------------------------- | ----- | ------------------------------------------------ |
| `easterDates`        | `EasterDatesRenderer`        | 209   | Static info block listing upcoming Easter dates  |
| `relatedQuestions`   | `RelatedQuestionsRenderer`   | 178   | Expandable Q&A list                              |
| `quizButton`         | `QuizButtonRenderer`         | 256   | Large CTA-style button that launches a quiz flow |
| `navigationCarousel` | `NavigationCarouselRenderer` | 148   | Horizontal rail of navigation cards              |
| `videoCarousel`      | `VideoCarouselRenderer`      | 206   | Horizontal rail of video cards                   |
| `mediaCollection`    | `MediaCollectionRenderer`    | 261   | Horizontal rail of mixed media items             |

## Goals

1. Every block kind mobile-v2 already implements renders on TV inside the Experience detail feed (`apps/tv/app/experience/[slug].tsx`).
2. New TV renderers look like their mobile-v2 counterparts but **adapted for 10-foot UI + D-pad navigation** — they are not pixel ports.
3. Interactive elements navigate to the same destinations as mobile-v2 (confirmed: "Match mobile-v2 navigation").

## Non-Goals / Out of Scope

- **Generic `cta` block** — TODO on mobile-v2 as well; excluded.
- **`adventCountdown`** — TODO on mobile-v2 as well; excluded.
- **Porting `ContentDispatcher` + `CuratedHomeLayout`** — the TV home screen already uses the correct TV pattern (`HomeHero` + `ContentRail` hand-composed in `apps/tv/app/index.tsx`) matching the existing Stitch TV designs. The mobile home composer (which reclassifies `sectionWrapper`-with-video into a video card rail) does not map onto a D-pad-first home. **Decision:** do not port; all new renderers are exercised only through the Experience detail's existing `SectionDispatcher`.
- **Visual redesign** — the goal is parity of content, not redesign. Crimson Gallery tokens already defined in `apps/tv/CLAUDE.md` are the style contract.
- **Auto-preview on focus, voice search, deep-linking** — not part of this work.

## Scope: Renderers to Build

Six new files under `apps/tv/src/components/sections/`:

1. `EasterDatesRenderer.tsx`
2. `RelatedQuestionsRenderer.tsx`
3. `QuizButtonRenderer.tsx`
4. `NavigationCarouselRenderer.tsx`
5. `VideoCarouselRenderer.tsx`
6. `MediaCollectionRenderer.tsx`

Plus wiring each new `kind` into `apps/tv/src/components/sections/SectionDispatcher.tsx` (currently has `sectionWrapper`, `container`, `videoHero`, `video`, `text`, `bibleQuotesCarousel` → everything else → `PlaceholderRenderer`).

## Required TV Adaptations (apply to every renderer)

These are the product rules that distinguish a "port" from a "translation". Planning should treat them as non-negotiable:

1. **Every interactive element is D-pad focusable** with a visible focus ring (1.05x scale + crimson glow at `#CB333B`), matching existing TV cards (e.g. `FocusableCard`, `VideoCardRenderer`).
2. **Horizontal rails are wrapped in `TVFocusGuideView`** so D-pad left/right stays on the rail and doesn't diagonally jump to adjacent rails.
3. **Text sizes scale up for 10-foot viewing.** Titles/body that mobile sets at 14–20pt read at roughly 22–32pt on TV. Use existing TV typography conventions, not the mobile `useTypography()` hook.
4. **System font only** (`fontFamily: 'System'`), and `Math.round()` every scaled font size on Android (`apps/tv/CLAUDE.md` rule).
5. **Navigation matches mobile-v2.** Select on a carousel item routes to the same experience/video target. Select on `QuizButton` launches the same flow (route to be confirmed during planning — if the quiz route does not yet exist on TV, scope it as a dependency, not silently stubbed).
6. **External links are treated carefully.** Mobile-v2's `RelatedQuestionsRenderer` uses `Linking.openURL` for some actions. On TV, external browser handoff is a bad user experience; **if a question's action is an external URL, render it as informational only (no link, no focus ring) rather than opening a browser on tvOS/Android TV**. Internal `/experience/<slug>` actions still navigate.
7. **Composite keys** per `apps/tv/CLAUDE.md`: `key={\`${item.kind}-${item.id}-${index}\`}`.
8. **Validate all CMS URLs** via `apps/tv/src/lib/` URL helpers before use (mirroring mobile's `validateActionUrl` approach).
9. **Colors:** Crimson Gallery tokens only — surface `#161311`, container `#221F1D`, primary `#CB333B`, text `#F5F5F4`, muted `#A8A29E`. No 1px borders; use background shifts.

## Per-Renderer Behavior Contract

**`EasterDatesRenderer`** — Static info display; not interactive. Focus skips over it. Adapts mobile layout to a wider, more horizontal card sized for the TV section feed.

**`RelatedQuestionsRenderer`** — Each question row is a D-pad-focusable `Pressable`. `Select` toggles expand/collapse in place (matches mobile's `AnimatedChevron`). External-link actions are informational-only on TV (see rule #6). Only one row expanded at a time is acceptable; matches mobile if it also does.

**`QuizButtonRenderer`** — Large focusable button occupying a full feed row. Visible focus ring. Select navigates to the quiz flow (route exists → navigate; route does not yet exist on TV → planning surfaces it as a dependency to resolve, not a silent no-op).

**`NavigationCarouselRenderer` / `VideoCarouselRenderer` / `MediaCollectionRenderer`** — Horizontal `FlatList` wrapped in `TVFocusGuideView`. Cards sized for TV (landscape-friendly; use `ogImage`/`videoStill`, not `mobileCinematicHigh` — same reasoning as `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md`). Focus ring on each card. First card may set `hasTVPreferredFocus` when the rail is the first focusable in the feed. Select navigates to the same target mobile-v2 uses.

## Success Criteria

- An Experience that previously showed blank gaps on TV now renders all of the above block kinds with visible, focusable, navigable content.
- D-pad navigation works: up/down between sections, left/right within each rail, select on every interactive element follows to a real destination (or, for external URLs inside `relatedQuestions`, stays put as an info-only row).
- No `[TV] Unhandled block type:` console warnings from `PlaceholderRenderer` for any of the six block kinds above on any Experience in the current CMS content.
- Visual check against the existing TV Stitch designs for section layout + Crimson Gallery tokens (surface colors, 16px card radii, crimson focus ring, no 1px borders).
- Manual QA on both tvOS and Android TV (per `apps/tv/CLAUDE.md` pitfalls — rebuild with `EXPO_TV=1 npx expo prebuild --clean`).

## Open Questions for Planning

1. Does a **quiz flow route** already exist in `apps/tv/app/`? If not, `QuizButtonRenderer` needs a target — either stub a placeholder route or defer the button to a follow-up.
2. Do `navigationCarousel` / `mediaCollection` items point to routes the TV app already has? Spot-check one real Experience to confirm link targets resolve.
3. Should `MediaCollectionRenderer` coerce mixed-media into a single card shape, or keep per-item variants? (Mobile does both — planning should pick one.)

## References

- `apps/tv/CLAUDE.md` — TV conventions, pitfalls, Crimson Gallery tokens
- `apps/mobile-v2/src/components/sections/*` — renderers to port
- `apps/tv/src/components/sections/SectionDispatcher.tsx` — wiring point
- `apps/tv/app/experience/[slug].tsx` — consumer of the dispatcher
- `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — original TV prototype scope that deferred these renderers
- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` — relevant focus pitfall for any carousel containing video previews
