---
title: "TV Home portrait rails cropped landscape cinematic — `orientation` is a sync-parity field, not the card-shape signal"
module: "apps/tv — watch home rails (sibling instance in apps/mobile)"
date: "2026-07-15"
problem_type: logic_error
category: logic-errors
component: frontend_stimulus
severity: medium
symptoms:
  - "Home rail cards render a ~31%-wide left-edge sliver of the video's landscape cinematic inside a 2:3 portrait frame"
  - 'Card shape derived from `WatchHomeSection.orientation === "vertical"` — a field with three independent producers where only one implies poster art'
  - "Reproduces only on the config-fallback path (Experience absent/errored/empty) or for a poster-less `collection` block — invisible against current prod data"
  - "Full test suite green and a live-data simulator screenshot both look correct"
  - "The test suite declared the invariant and pinned its violation four lines apart"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "apps/tv/src/lib/watchHome/model.ts"
  - "apps/tv/src/lib/watchHome/experienceAdapter.ts"
  - "apps/tv/src/lib/watchHome/config.ts"
  - "apps/tv/src/components/home/homeRailVariant.ts"
  - "apps/mobile/src/lib/watchHome/experienceAdapter.ts"
tags:
  - "tv"
  - "watch-home"
  - "portrait-rail"
  - "orientation-field"
  - "poster-rail"
  - "card-shape"
  - "discriminator-field"
  - "sync-parity"
  - "mutation-testing"
---

# TV Home portrait rails cropped landscape cinematic — `orientation` is a sync-parity field, not the card-shape signal

## Problem

TV Home gained curated 2:3 portrait poster rails (branch `feat/tv-portrait-home-rails`, PR #1579 — **open, not merged** as of writing). The first implementation (branch commit `235c8a06`) selected the card's **shape** from `WatchHomeSection.orientation === "vertical"`. But `orientation` has **three producers and only one of them implies poster art**, so on the paths where the other two fire, the video's landscape cinematic got framed at 2:3 with `contentFit="cover"` + `contentPosition="top left"` (`apps/tv/src/components/home/HomeCard.tsx:168-169`) — cropping it to a ~31%-wide left-edge sliver. The exact failure the feature existed to prevent, inverted.

The three producers of `orientation: "vertical"`, at the current tree:

| #   | Producer                                                                                                                                              | Poster-backed? |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | `isPortraitPosterRail(rawItems)` — every item resolves an override poster (`apps/tv/src/lib/watchHome/experienceAdapter.ts:81-86`, applied at `:142`) | **Yes**        |
| 2   | `mapVariant("collection")` → `{ layout: "grid", orientation: "vertical" }` (`apps/tv/src/lib/watchHome/experienceAdapter.ts:70-71`)                   | No             |
| 3   | Two config-declared sections (`apps/tv/src/lib/watchHome/config.ts:161` and `:195`), carried through `apps/tv/src/lib/watchHome/model.ts:376`         | No             |

Producers 2 and 3 are **layout/sync-parity signals** (they mirror mobile's model, where "vertical" means a vertical _grid_). They say nothing about art. Reading shape off `orientation` silently promoted both into art guarantees.

The geometry, grounded in `HOME_CARD_DIMS` (`apps/tv/src/components/home/HomeCard.tsx:35-41`): the landscape card is `400 × 187.5` (2.13:1 — the cinematic's aspect); the portrait card is `260 × 390` (2:3). Covering 2.13:1 art into a 260×390 frame scales it to height 390, giving width `390 × 2.133 ≈ 832`. Visible: `260 / 832 ≈ 31%`, anchored top-left.

**Exposure.** Producer 3 fires whenever `resolveWatchHomeModel` returns the `configModel` (`apps/tv/src/lib/watchHome/experienceAdapter.ts:202-213`) — i.e. the Experience is absent, errored, or yields zero rails. Producer 2 fires for any poster-less `collection` block. Neither is exotic; both were simply not what the simulator was pointed at. The defect was caught and fixed on the branch and never reached production.

## Symptoms

- Portrait (2:3) Home cards showing a narrow vertical strip of a wide cinematic image instead of a poster.
- Reproduces only on the config-fallback path or for a poster-less `collection` block — **not** against the prod Experience as it stands on 2026-07-15.
- Full suite green; a live-data simulator screenshot looked correct.
- The suite simultaneously declared the invariant and asserted the bug (see below).

## What Didn't Work

- **A live-data simulator screenshot.** Verified against prod on 2026-07-15 (`watchSetting.homepageExperience`, locale `en`): all three poster rails carry an override on _every_ item (6/6, 4/4, 4/4), so producer 1 is the only one that fires and all three producers agree. The screenshot was correct and proved nothing about producers 2 and 3. This is the load-bearing failure — the verification method that normally catches TV render bugs is structurally blind here, because the discriminator's producers only diverge on data prod does not currently have.
- **A green test suite.** The suite had **no assertion on the config path's rail shape at all** — verified by mutation below.
- **Reading the tests for a contradiction.** The suite _contained_ the bug's refutation and nobody noticed: it declared "a portrait FRAME implies portrait ART on every rendered card" a few lines from an assertion that pinned the inverted behavior ("still honours variant=collection with no posters at all", asserting `orientation` vertical for a poster-less block). Both statements were true of the code; only one was true of the intent. A declared invariant sitting next to an assertion that violates it is not self-cancelling — it reads as two passing tests.

## Solution

Branch commit `42ef0c22` gives the decision **its own required field**, set from the same value the behavior consumes.

**1. A dedicated, required `isPosterRail`** (`apps/tv/src/lib/watchHome/model.ts:101-117`), with `orientation` explicitly demoted in-place:

```ts
export type WatchHomeSection = {
  // ...
  // Sync-parity with mobile. NOT the card-shape signal: `orientation` also reads
  // "vertical" for poster-less config/`collection` sections, whose art is
  // landscape. Render off isPosterRail (resolveHomeRailVariant); never re-wire.
  layout: "rail" | "grid"
  orientation: "horizontal" | "vertical"
  showSequenceNumbers: boolean
  // Every card carries curated portrait art, so the rail may render 2:3. Set only
  // from the resolved override poster the cards show, so frame and art cannot
  // disagree. False on the config path (landscape cinematic only).
  isPosterRail: boolean
  cards: WatchHomeCard[]
}
```

**2. ONE value gates BOTH the frame and the art.** In `blockToSection` the decision is made once, from `rawItems` — not from surviving cards, so a dropped item can't turn a mixed rail into a poster rail (`apps/tv/src/lib/watchHome/experienceAdapter.ts:119-122`, `:142-144`):

```ts
const posterRail = isPortraitPosterRail(rawItems)
// ...
orientation: posterRail ? "vertical" : orientation,  // mobile sync-parity only
isPosterRail: posterRail,                            // the render signal
```

and the same `posterRail` selects the card's art (`apps/tv/src/lib/watchHome/experienceAdapter.ts:107`):

```ts
// Gated on the SAME value as the 2:3 frame, so frame and art can't diverge:
// a landscape rail keeps the video's cinematic (as before this feature).
imageUrlOverride: posterRail ? resolveOverridePosterUrl(item) : null,
```

Frame and art now derive from one expression. Divergence is not merely untested — it is unrepresentable.

**3. The config path hard-codes `false`** (`apps/tv/src/lib/watchHome/model.ts:378-381`), with the reasoning at the site:

```ts
// No curated poster on this path (video cinematic only), so a portrait
// frame would crop. config.ts's two `orientation: "vertical"` sections are
// mobile layout parity, NOT an art guarantee — see WatchHomeSection.
isPosterRail: false,
```

**4. An extracted resolver whose signature makes the bug a compile error** (`apps/tv/src/components/home/homeRailVariant.ts:10-14`), following the `homeCardRouting.ts` precedent of React-free `.ts` predicates:

```ts
export function resolveHomeRailVariant(
  section: Pick<WatchHomeSection, "isPosterRail">,
): HomeCardVariant {
  return section.isPosterRail ? "portrait" : "landscape"
}
```

The `Pick<>` is the guardrail: reading `orientation` through this function **does not typecheck**. Single call site at `apps/tv/app/index.tsx:450`.

Making `isPosterRail` **required** (not `?: boolean`) forced every construction site to decide — the typecheck caught a fixture during the fix. Branch commit `e9f06772` carries review fixes (stopping the poster from seeding the 16:9 hero; pinning the config path).

## Why This Works

The root cause is not "we read the wrong field" — it's that a **sufficient-only signal was routed through a field with other producers**. `isPortraitPosterRail` is _sufficient_ for `orientation === "vertical"` but not _necessary_: producers 2 and 3 also produce it. Implication runs one way, so reading the field backwards ("vertical ⟹ posters") inverts the guarantee on exactly the inputs the sufficient producer didn't generate.

The fix restores a biconditional. `isPosterRail` has exactly one producer (`isPortraitPosterRail`, via the single `posterRail` binding), and that same binding selects the art — so `isPosterRail === true` ⟺ every card carries an override poster, by construction rather than by convention.

Note also that TV's `isPortraitPosterRail` tests the **resolved** URL (`resolveOverridePosterUrl(item) != null`, `apps/tv/src/lib/watchHome/experienceAdapter.ts:81-86` → `apps/tv/src/lib/experienceHydration.ts:108-112`), a deliberate tightening over mobile, which tests the raw field (`apps/mobile/src/lib/watchHome/experienceAdapter.ts:52-53`). An override that is present but unresolvable (e.g. `javascript:alert(1)`) yields no poster, so the rail must not claim a portrait frame — otherwise the frame goes 2:3 while the card falls back to landscape art, reproducing the same crop by a different route.

**Scope the claim honestly.** Even fixed, the guarantee is "frame ⇔ _authored-override_ art", not "frame ⇔ portrait art": `resolveImageUrl` validates the **scheme**, never the aspect ratio. An editor who authors landscape images as overrides on every item still flips a rail to 2:3 and crops it — no deploy, no failing test. That is a platform-wide content contract (web and mobile gate on the same signal), not a TV defect, but the code cannot enforce it.

## Prevention

**The general rule: a shared sync-parity / bookkeeping field must never double as a render/behavior discriminator.** Give the decision its own required field, set from the same value the behavior consumes. Before branching on any field, count its producers — if >1 and they don't all imply the thing you're about to do, you need a new field, not a new condition. Symptoms that you're about to make this mistake: the field's name describes _layout or data shape_ while your branch decides _behavior_; the field exists "for parity with `<other app>`"; the field is optional with a `?? default`.

**Mutation testing is the verification that mattered** — and it is the only thing here that distinguishes a real guard from a decorative one. Measured against the tree at `e9f06772`:

- Reverting `resolveHomeRailVariant` to read `orientation` → **5 tests fail across 2 suites** (`homeRailVariant.test.ts` + `model.test.ts`).
- Flipping the config path's `isPosterRail` to `true` (`apps/tv/src/lib/watchHome/model.ts:381`) → **2 tests fail** (`builds primary-collection sections from one level of children`, `slices a limitChildren source to its first child, not the parent`). Both previously passed **silently** — they exercised the config path without asserting its shape, which is precisely why a green suite missed the bug.

**A search that finds nothing proves nothing until you prove the search ran.** This trap fired twice while producing this very document, in two different tools:

- A mutation attempt used `sed`, which silently matched nothing; jest then reported all-green. Read as-is, that is a _false exoneration_ — it "proves" the guards are worthless and would have justified deleting them. A mutation test that fails to mutate is indistinguishable from a test suite that doesn't care.
- A `grep` for `orientation` assertions ran against `apps/mobile/src/lib/watchHome/model.test.ts` — **a path that does not exist** (mobile's is `apps/mobile/src/lib/__tests__/watchHomeModel.test.ts`). Zero hits was written up as "no assertions at all". The truth was the opposite: mobile asserts `orientation` on both paths. A grep against a missing file and a grep against a clean file return the same thing — nothing.

Both are the same shape as the bug this document is about: a signal that is _sufficient_ for your conclusion when it fires, but which you read backwards as _necessary_. Confirm the instrument engaged — `grep` the mutated literal, `ls` the file you searched — before believing a negative result.

**The guards now in the tree**, each carrying the reasoning so a future edit can't quietly revert it:

- `apps/tv/src/components/home/homeRailVariant.test.ts` — `stays landscape for orientation=vertical without poster art`; `goes portrait for a poster rail even when orientation is horizontal`
- `apps/tv/src/lib/watchHome/model.test.ts` — the two config-declared `orientation: "vertical"` sections (advent, lumoVertical), each asserting `isPosterRail === false` **and** `resolveHomeRailVariant(section) === "landscape"`
- `apps/tv/src/lib/watchHome/experienceAdapter.test.ts` — `does NOT make a poster-less variant=collection a poster rail`, asserting `orientation === "vertical"` (parity, unchanged) _and_ `isPosterRail === false` _and_ that the cards keep their hydrated landscape art

**When prod data makes your producers agree, the simulator is not evidence.** A live-data screenshot only exercises the producer prod data happens to trigger. Assert the _disagreeing_ case in a unit test — that's the case with no screenshot.

## Still Open — apps/mobile carries the identical shape, unfixed

Mobile has the same three producers flowing into `orientation`, and renders shape off it directly:

- `apps/mobile/src/components/home/HomeShelf.tsx:38-39` — `const variant: HomeCardVariant = section.orientation === "vertical" ? "portrait" : "landscape"` (portrait = 3:4 on mobile, `apps/mobile/src/components/home/HomeCard.tsx:45-48`)
- Producer 1: `apps/mobile/src/lib/watchHome/experienceAdapter.ts:130` — `orientation: isPortraitPosterRail(rawItems) ? "vertical" : orientation`
- Producer 2: `apps/mobile/src/lib/watchHome/experienceAdapter.ts:37` — `mapVariant("collection")` → `orientation: "vertical"`
- Producer 3: `apps/mobile/src/lib/watchHome/fallbackConfig.ts:99` and `:133` — two sections declaring `orientation: "vertical"`, carried through `apps/mobile/src/lib/watchHome/model.ts:357`

Mobile has **no separate poster signal** — no `isPosterRail` equivalent exists anywhere in `apps/mobile/src` (verified by grep; the only `posterRail` hit is a local variable in a test). `orientation` is the whole story, so the sufficient-but-not-necessary inversion is unguarded.

Mobile's tests do **not** have TV's coverage hole — and that is the more interesting finding. Mobile asserts `orientation` on **both** paths:

- `apps/mobile/src/lib/watchHome/__tests__/experienceAdapter.test.ts:100` — a poster rail is `"vertical"`; `:116` — a mixed rail stays `"horizontal"`
- `apps/mobile/src/lib/__tests__/watchHomeModel.test.ts:116` — `expect(advent?.orientation).toBe("vertical")` on the config path

That last assertion is the trap. `home-collection-bibleproject-advent` is a **poster-less config section**, and mobile renders shape straight off `orientation` (`HomeShelf.tsx:38-39`). So the test asserts vertical for a section whose cards carry only Cinematic art — pinning the crop as intended behavior, exactly as TV's suite did before the fix. Coverage is not the protection; asserting the _right field_ is. A suite can assert a discriminator thoroughly and still cement the bug, because the assertion encodes what the code does, not what the product needs.

Two exposure routes: the poster-less `collection` block (prod's Experience has none as of 2026-07-15) and the config-fallback path (reached when the Experience is absent/errored/empty). Route 2 is the one to watch — it is a live crop the moment the Experience fails, not a hypothetical. Note the fix does not port verbatim: mobile's `isPortraitPosterRail` tests the raw `imageOverrideUrl` field (`:52-53`), so a port should adopt TV's resolved-URL tightening at the same time.

## Related Issues

- **PR #1579** (open against `main`, **not merged** as of writing) on branch `feat/tv-portrait-home-rails`. Cite the PR, not the SHAs: the branch commits below are pre-merge and will be rewritten by the repo's squash-merge, so they will not exist on `main`. For the record at time of writing — `235c8a06` introduced the bug, `42ef0c22` fixed it, `e9f06772` carried review fixes; branched from `498c9e8b`.
- `docs/solutions/architecture-patterns/cross-client-hero-parity-eligibility-gate.md` — **prior instance of this same shape in the same watch-home module**: a wire field (`label`) pressed into service as a coarser signal than it can bear (an hls-gate proxy) for hero-pool eligibility. Two instances under `apps/tv/src/lib/watchHome/` makes this a recurring failure mode there, not a one-off.
- `docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md` — the adjacent doc for the SDUI experience-detail surface. Same landscape-cropped-into-portrait _symptom_, different root cause: there the override → `imageUrl` → video-art precedence is a deliberate working design (video art is last precisely because it is landscape). This learning extends that precedence chain onto the Home rail.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home for "every typed discriminator branch needs a test where ONLY that branch can match." Same family: the config path had no test that could only pass on the config path, so deleting its behavior failed nothing.
- `docs/plans/2026-07-08-003-feat-tv-home-experience-parity-plan.md` — the parent plan whose U4/KTD2 shipped the `mapVariant` layout/orientation mapping. This fix is a follow-on correction to that code, not a contradiction: the plan's own `model.ts` comment declared `orientation` "not yet wired to any TV renderer".
- `docs/roadmap/topic-experiences/feat-246-tv-home-experience-content-parity.md` — the parent roadmap ticket (in-progress) for this feature area.
- `apps/tv/src/components/home/homeCardRouting.ts` — the React-free `.ts` predicate precedent `homeRailVariant.ts` follows.
