---
id: "feat-255"
title: "Mobile Home poster rails — give the card-shape decision its own signal"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-07-16"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
---

## Problem

`apps/mobile` renders a Home row's card shape from `WatchHomeSection.orientation`,
a field with three producers where only one implies the row has portrait poster
art. When either of the other two fires, the row frames the video's **landscape**
cinematic in a portrait card and crops it.

This is the same defect TV carried and fixed (PR #1579). The full analysis,
including why green tests and a live-data screenshot both miss it, is in
`docs/solutions/logic-errors/tv-home-orientation-field-overloaded-card-shape-signal.md`
— read it first; this ticket is the port.

The three producers on mobile:

| #   | Producer                                                                                                                  | Poster-backed? |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | `isPortraitPosterRail(rawItems)` — `src/lib/watchHome/experienceAdapter.ts:130`                                           | Yes            |
| 2   | `mapVariant("collection")` → `orientation: "vertical"` — `src/lib/watchHome/experienceAdapter.ts:37`                      | **No**         |
| 3   | Two declared sections — `src/lib/watchHome/fallbackConfig.ts:99` and `:133`, carried via `src/lib/watchHome/model.ts:357` | **No**         |

**Two exposure routes.** A poster-less `collection` block (prod's Experience has
none as of 2026-07-15, so this one is latent), and the **config-fallback path** —
reached whenever the Experience is absent, errored, or yields zero rails. Route 2
is not latent: it crops the moment the Experience fetch fails.

**Mobile's tests do not protect it — they pin it.** `src/lib/__tests__/watchHomeModel.test.ts:116`
asserts `expect(advent?.orientation).toBe("vertical")` for `home-collection-bibleproject-advent`,
a **poster-less** config section, while `src/components/home/HomeShelf.tsx:38-39`
renders shape off that same field. The assertion encodes what the code does, not
what the product needs. Coverage is not the protection here; asserting the right
field is.

## Entry Points — Read These First

1. `docs/solutions/logic-errors/tv-home-orientation-field-overloaded-card-shape-signal.md` — the root-cause analysis and TV's fix shape. Do not re-derive it.
2. `apps/mobile/src/components/home/HomeShelf.tsx:38-39` — the render site: `section.orientation === "vertical" ? "portrait" : "landscape"`.
3. `apps/mobile/src/lib/watchHome/model.ts` — `WatchHomeSection` (no poster field today) and `normalizeCard` (no `imageUrlOverride` param — the config path always uses the video's own art).
4. `apps/mobile/src/lib/watchHome/experienceAdapter.ts:47-56` — `isPortraitPosterRail`; note it tests the **raw** `imageOverrideUrl` field, unlike TV.
5. `apps/mobile/src/lib/watchHome/fallbackConfig.ts:99`, `:133` — the two sections declaring `orientation: "vertical"` with no poster art available.
6. TV's shipped fix, as the reference implementation: `apps/tv/src/lib/watchHome/model.ts` (`isPosterRail`), `apps/tv/src/lib/watchHome/experienceAdapter.ts` (single `posterRail` binding), `apps/tv/src/components/home/homeRailVariant.ts` (the `Pick<>`-narrowed resolver).

## Grep These

```
orientation === "vertical"          # the render sites to migrate
isPortraitPosterRail                # producer 1
mapVariant                          # producer 2
orientation: "vertical"             # producer 3 (fallbackConfig) + adapter writes
imageOverrideUrl                    # the poster signal + the art, same field
imageUrlOverride                    # absent on mobile's normalizeCard — this is the gap
```

## What To Build

Mirror TV's fix; do not invent a second shape.

1. **A dedicated required field** on `WatchHomeSection`:

   ```ts
   /** Every card carries curated portrait art, so the row may render portrait.
    *  Set only from the resolved override poster the cards show. */
   isPosterRail: boolean
   ```

   Required, not optional — it forces every construction site to decide, and the
   typecheck will find them.

2. **One value gates BOTH the frame and the art.** In the adapter, decide once
   from `rawItems` (not surviving cards) and use the same binding for the section
   flag and each card's art. Frame/art divergence becomes unrepresentable rather
   than merely untested.

3. **The fallback path hard-codes `isPosterRail: false`** — it has no curated
   posters, only the video's cinematic.

4. **Adopt TV's resolved-URL tightening in the same change.** Mobile tests the raw
   field (`experienceAdapter.ts:52-53`); TV tests the resolved URL. An override
   that is present but unresolvable yields no poster, so the row must not claim a
   portrait frame — otherwise the frame goes portrait while the card falls back to
   landscape art, reproducing the crop by a different route. **The fix does not
   port verbatim without this.**

5. **Render off the new field.** Extract a resolver taking
   `Pick<WatchHomeSection, "isPosterRail">` so reading `orientation` through it is
   a compile error. `HomeShelf.tsx` calls it.

6. Keep `orientation` as-is for parity; document it as **not** the card-shape signal.

## Constraints

- **Do NOT change `orientation`'s producers or values.** It is sync-parity with the
  shared model and other consumers may read it. The fix is additive.
- **Do not port TV's dimensions.** Mobile's portrait is 3:4 (`HomeCard.tsx:45-48`);
  TV's is 2:3. This ticket is about the _signal_, not the geometry.
- Mobile has no hover preview — TV's `!isPortrait` preview gate has no analogue.
- Do not touch `apps/tv`.

## Verification

- **Mutation-test the guards, and confirm the mutation landed before trusting a
  green run.** A `sed`/edit that silently matches nothing plus a green suite reads
  as a false exoneration. `grep` the mutated literal first.
  - Reverting the resolver to read `orientation` must FAIL tests.
  - Flipping the fallback path's `isPosterRail` to `true` must FAIL tests.
- **Fix the assertion that pins the bug**: `src/lib/__tests__/watchHomeModel.test.ts:116`
  must assert `isPosterRail === false` and a landscape card shape for `advent`,
  keeping `orientation === "vertical"` for parity.
- Assert the **disagreeing** case — a poster-less `collection` block and the
  config-fallback path. Prod data makes the producers agree, so a simulator
  screenshot is not evidence for this bug.
- `pnpm --filter @forge/mobile test` and `typecheck` green.
- Simulator: confirm the three poster rows still render portrait with their
  posters, and that the other rows are unchanged.
