---
title: "Cross-client home-hero web parity via a wire-label eligibility gate (TV + mobile approximate web's hls gate)"
date: 2026-07-13
category: architecture-patterns
module: apps/tv + apps/mobile watchHome hero
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Multiple clients (web + native) build the same client-owned, day-seeded home-hero pool queue from a shared playlist sequence but fetch different GraphQL fragments"
  - "A richer client gates hero eligibility on a per-child field (e.g. build-time hls stream) that leaner native clients deliberately omit and therefore cannot replicate"
  - "You must approximate the unavailable gate with a coarser wire signal (e.g. a label/type enum) to converge content parity, accepting a few over-included items"
  - "Cross-client parity is guarded by a golden test regenerated from a client's real queue-builder output, never hand-written"
tags:
  [
    tv,
    mobile,
    watch-home,
    hero,
    web-parity,
    eligibility-gate,
    gql-tada,
    golden-test,
  ]
---

# Cross-client home-hero web parity via a wire-label eligibility gate (TV + mobile approximate web's hls gate)

## Context

The Forge watch-home hero renders on three clients — web (`apps/web`), mobile (`apps/mobile`), TV (`apps/tv`). All three build the hero from the _same_ 12-group playlist (`WATCH_HOME_PLAYLIST_SEQUENCE`) via the _same_ deterministic, day-seeded round-robin, so on any given day they should show the same set of videos. During PR #1534 (branch `feat/tv-home-hero-parity`) a live side-by-side of the three running apps showed they did **not** agree: TV and mobile were surfacing collection/series _container_ tiles that web never shows, and — more surprisingly — the Christmas short films that web shows were _missing_ from TV/mobile entirely.

The friction was that the divergence had two independent causes and the fix went through several pivots before landing. The first instinct was to expand containers into their episodes (hero shows an episode); that was wrong — web shows the _parent_ film. The second was to emit the parent film for everything; that still leaked the collection/series containers web drops. The final shape was a label gate, and only after that landed did the missing Christmas shorts reappear — for a non-obvious reason (see "the reachability trap" below).

The root cause is that the three clients **gate hero eligibility on different signals**:

- **Web** (source of truth) gates on a build-time `hls` stream. Its hero fragment omits child variants/`hls`, so every _child_ fails the `hls` check and web falls back to emitting the _parent_; and a collection/series container whose parent carries no playable `hls` stream is dropped. Net effect: web's hero = playable parent films + parent short films, no containers.
- **TV and mobile** use a **lean** bulk fetch that deliberately omits variants/`hls` to avoid a ~9.5 MB payload (see the mobile dub-payload learning). They therefore _cannot see `hls` at all_ and physically cannot replicate web's gate. Without a gate they emitted every parent, containers included.

## Guidance

**1. When a consumer can't fetch the field the source-of-truth gates on, approximate the gate with a proxy signal that IS in the lean payload.** Web gates on `hls`; the lean clients don't have it, but they do have the wire `label` enum. The clients approximate web's playability gate with a label check, dropping the container labels and keeping the individually-playable ones:

```ts
// TV: apps/tv/src/lib/watchHome/heroQueue.ts  (eligibleCardsForSource)
// mobile: apps/mobile/src/lib/watchHome/model.ts  (eligibleSlidesForSource)
if (parent.label === "COLLECTION" || parent.label === "SERIES") return []
```

Feature films are kept _even when they have chapter-children_ — the JESUS film (`1_jf-0-0`) has ~61 children but its parent is emitted as one hero tile, not 61 episodes. Accept up front that a proxy is an approximation, not an equivalence, and record the accepted trade-off (see the trade-off note below).

**2. Beware "fixed-size queue + last-position pool" reachability.** The hero queue has a _fixed_ target of 7 slots (`WATCH_HOME_HERO_QUEUE_TARGET = 7`, `apps/tv/src/lib/watchHome/heroQueue.ts`; mobile `carouselSequence.ts`) and appends a synthetic `shortFilms` pool **last** (TV `heroQueue.ts`, mobile `model.ts`). The round-robin fills the 7 slots from the pools in order and stops. When the collection/series pools were still populated they consumed all 7 slots _before the round-robin ever reached the last-position shortFilms pool_ — so the Christmas shorts never appeared. **Dropping the earlier pools (via the label gate) is what makes the later pool reachable.** Changing an earlier pool's _membership_ silently changed whether a later pool was _reached at all_. When you edit any pool in a bounded round-robin, reason about downstream reachability, not just that pool's own output.

**3. Regenerate cross-client goldens from the REAL producer, never by hand.** The parity test asserts TV's ordered `coreId` queue against a golden. That golden must be produced by running _mobile's_ real `buildWatchHomeHeroQueue` over a shared fixture (via a throwaway test that prints its output), not hand-authored. A hand-authored golden only proves "TV matches my guess"; a producer-generated golden proves "TV matches mobile." The shared fixture is deliberately built to include a FEATURE_FILM-with-children **and** a COLLECTION **and** a SERIES, so the golden encodes the real contract: films-with-children are kept, containers are dropped.

**4. Prefer a fail-CLOSED allow-list for eligibility gates.** The shipped label gate is a fail-_open_ deny-list — it drops two known container enums and keeps everything else. Web's real gate is the opposite posture: a positive "include only if playable" check. A fail-_closed_ allow-list (`keep only FEATURE_FILM / SHORT_FILM`) would match web's posture and the sibling `shortFilms` scan (which already positively selects on `label === "Short film"`), and would not silently leak a new container into the hero if admin later adds or renames a container enum, or a null-label regression slips through. This is a hardening consideration, not a current defect: today's schema has only those two container enums and the shipped gate was verified on-device.

## Why This Matters

This is content-parity correctness on the single most prominent user-facing surface — the home hero is the first thing every viewer sees on every platform, and the three clients are supposed to be showing the same programming. A container tile that opens to a list, where web shows a playable film, is a visibly worse hero on TV/mobile.

Two of the failure modes here are the kind code review does not catch:

- **The reachability trap is invisible in the diff.** The label gate change and the "Christmas shorts now appear" outcome are in _different pools_; nothing in the changed lines mentions shorts. Only running the real queue reveals the coupling.
- **A hand-authored golden gives false confidence.** It turns green whether or not TV actually matches mobile, so it can pass while parity is broken. Generating it from the real producer is what makes the test load-bearing.

## When to Apply

- Any multi-client feature where clients fetch **different projections** of the same source (a rich server projection vs. a lean mobile payload) and one client gates on a field the others don't fetch.
- Any **fixed-size round-robin (or top-N) with appended pools**, where editing one pool's membership can change whether later pools are reached.
- Any **cross-client golden / parity fixture** — always generate it from the real producer, and make the fixture exercise every discriminator branch the gate cares about.

## Examples

**The gate, before → after.** Before: both clients emitted the parent for every source, containers included. After (the label gate, cited above): `eligibleCardsForSource` (TV, `heroQueue.ts`) and `eligibleSlidesForSource` (mobile, `model.ts`) short-circuit `return []` on `label === "COLLECTION" || label === "SERIES"`, then normalize and emit the parent card for everything else. Note the gate reads the raw wire `label` on the fetched input — not the display-text label — so it matches the admin enum literally.

**The golden.** `apps/tv/src/lib/watchHome/__fixtures__/heroQueueParity.golden.json`:

```json
{
  "nowIso": "2026-07-13T15:00:00.000Z",
  "coreIds": ["1_jf-0-0", "sf-standalone"]
}
```

The paired fixture (`heroQueueParity.fixture.json`) carries four top-level records: `1_jf-0-0` (FEATURE_FILM, with EPISODE children), `8_NBC` (COLLECTION, with children), `GOMattCollection` (SERIES, with children incl. a self-referential row), and `sf-standalone` (SHORT_FILM, no children).

**Reachability walk-through over that fixture.** Pool building uses the top-level-only source map (TV `buildHeroSourceMap`; mobile's `videoByCoreId`), so children like `8_NBC`'s `CS1` are not addressable as playlist sources. Applying the label gate to the 12-group sequence:

- Group 0 `["1_jf-0-0"]` → FEATURE_FILM → **kept** (one pool with `1_jf-0-0`)
- Group 2 `["8_NBC"]` → COLLECTION → dropped
- Group 3 `[…"GOMattCollection"]` → SERIES → dropped; siblings absent from the fixture
- All other groups → sources absent → empty, filtered out
- Synthetic `shortFilms` pool (appended last) → `sf-standalone` → **kept**

Two surviving pools. The round-robin (target 7, dedupe on `coreId`) picks `1_jf-0-0`, then reaches the last-position shortFilms pool and picks `sf-standalone`, then every further slot is a dedupe-skip → `["1_jf-0-0", "sf-standalone"]`, exactly the golden. This is the minimal proof of both invariants at once: the film-with-children is kept while both containers drop, **and** the last-position shorts pool is reached only because the container pools dropped out. In production the same mechanic is what un-hid the Christmas shorts.

**The accepted trade-off.** A deny-list label gate over-includes a few feature films that web drops _only_ because they lack an `hls` stream (e.g. Magdalena). The owner explicitly chose "web's videos plus a couple of extra feature films" (Option 1) over an exact match, because emptying the container pools is also what frees the shortFilms pool to surface — the same move buys both the shorts and the slight over-inclusion.

**Successor.** feat-160 moves hero curation into the admin Experience. When it lands it retires this client-side config + gate duplication (the LIVE `WATCH_HOME_PLAYLIST_SEQUENCE` in `apps/tv/src/lib/watchHome/config.ts` and its mobile twin), so the proxy-gate approximation becomes unnecessary rather than something to keep in sync.

## Related

- `docs/solutions/architecture-patterns/tv-home-single-admin-experience-migration-20260712.md` — the RAILS migration that moved TV's home _body_ onto the admin Experience. The hero was **deliberately left config-sourced** there (the adapter skips `WatchHomeHeroBlock`); this parity work is the distinct, complementary follow-up of making that still-client-owned hero match web/mobile.
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md` — the fail-closed-by-construction pattern that guidance #4 (prefer an allow-list) draws on: make the safe outcome a property of the wiring, not of a deny-list operators must keep exhaustive.
- `docs/solutions/conventions/tv-mobile-clients-consume-only-public-admin-queries.md` — the public-only lean-fetch posture that structurally denies the client the `hls` field, forcing the label-gate approximation.
