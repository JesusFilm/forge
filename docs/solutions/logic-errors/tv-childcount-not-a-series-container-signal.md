---
title: "TV misroutes feature films with chapter children to the series screen — a record's own children are not a container signal"
module: "apps/tv — series/watch routing (apps/mobile has a related, still-unfixed variant at src/lib/isSeriesRecord.ts)"
date: "2026-07-28"
problem_type: logic_error
category: logic-errors
component: frontend_stimulus
severity: high
symptoms:
  - "Opening JESUS (61 children) renders the series detail screen badged SERIES, billing its own chapter clips as '61 episodes'"
  - "The series screen's primary CTA plays the record's own dub, so 'Play Trailer' actually plays the entire ~2-hour feature film"
  - "Search and Home cards show '61 EP' / '61 episodes' beside a 'Feature Film' kind line for the same title"
  - "Ten catalog films with chapter-clip children (JESUS, Book of Acts, The Savior, Life of Jesus/Gospel of John, Magdalena, ...) all misroute the same way — eight feature films and two short films"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "apps/tv/src/lib/isSeriesRecord.ts"
  - "apps/tv/src/lib/watchRedirect.ts"
  - "apps/tv/src/components/series/seriesScreenState.ts"
  - "apps/tv/src/components/home/homeCardRouting.ts"
  - "apps/tv/src/components/search/searchResultPath.ts"
  - "apps/tv/src/components/search/searchDisplay.ts"
  - "apps/tv/src/lib/videoQueries.ts"
  - "apps/tv/src/lib/watchHome/model.ts"
  - "apps/mobile/src/lib/isSeriesRecord.ts"
  - "CONCEPTS.md"
tags:
  - "tv"
  - "mobile"
  - "series-routing"
  - "watch-redirect"
  - "feature-film"
  - "child-count-predicate"
  - "concepts-md"
  - "domain-modeling"
---

# Feature films billed as series — a two-way routing decision expressed by two predicates that could disagree

## Problem

The TV app classified a Video as "series-shaped" with "labelled SERIES/COLLECTION, **or** has children". That rule lived in two functions — `isSeriesRecord` counting `episodes.length` and `isSeriesSearchResult` counting `childCount`, depending on which payload the caller held. The has-children clause encodes a domain rule this catalog does not obey: a feature film carries its own chapter clips as child videos while remaining ONE playable film. JESUS has 61 children, Book of Acts 73, The Savior 55, Life of Jesus (Gospel of John) 49, Magdalena 46 — ten such titles in the survey below, each observed to carry its own published HLS.

So every entry point that consulted `childCount` — search results, Home cards, deep links — sent those films to `/series`, the container surface, where a two-hour film was presented as a season of television.

Underneath the wrong rule sat a structural fault that is the more portable lesson. The `/watch` → `/series` redirect and the `/series` → `/watch` bounce are meant to be exact inverses: whatever one sends away, the other must keep. `resolveWatchRedirect` was already label-only, while `isSeriesRecord` / `isSeriesSearchResult` also counted children. Two predicates for one two-way decision, disagreeing on exactly the film-with-chapters case — which is why a film could _settle_ on the series screen instead of bouncing straight back to `/watch`. Had both seams shared one predicate, the worst outcome would have been a redirect loop that surfaces immediately in dev, not a quietly wrong page that shipped.

## Symptoms

- JESUS opened a series detail page badged "SERIES" and billed its 61 chapter clips as "61 episodes".
- That screen's primary CTA is "Play Trailer" — it plays the record's own dub. On a film-parent, "Play Trailer" started the entire two-hour feature.
- Home and search cards read "61 EP" / "61 episodes" directly beside a "Feature Film" kind line — the two labels on the same card contradicted each other.
- Ten real catalog titles were affected, not an edge case: JESUS (61), Book of Acts (73), The Savior (55), Life of Jesus / Gospel of John (49), Magdalena (46), and five more.

## What Didn't Work

**Keeping the routing and just fixing the badge.** Tempting, because the "61 episodes" string is the visible defect. Rejected: the CTA would still read "Play Trailer" for a two-hour film, and the rail heading would still say "Episodes". The badge is a symptom of being on the wrong screen, and repainting it would have hidden the routing fault rather than removed it.

**Routing on "does this record have its own playable dub".** Semantically the most correct test — containment is really about whether the record has standalone media of its own. Not available: the routing payload (search results, Home cards) carries only `label` and `childCount`, never dub or HLS data, and fetching dubs to make a routing decision is far too expensive on the press path. The label is the only containment signal that reaches the decision point, which is what makes label-only the right call rather than a compromise.

**Trusting `childCount` as a signal at all was already known to be fragile.** (session history) Earlier search-restoration work found admin's `watchSearch` left `label` and `childCount` null on roughly 40 of 40 sampled results after the `Query.search` retirement — a predicate that ORs in `childCount > 0` is only as trustworthy as admin's willingness to populate the field, and degrades silently in _both_ directions: never-true on search, always-true-for-the-wrong-reason on feature films. That null-payload behaviour was re-confirmed against production during this fix, which is why the search-chip half of the label-aware count nouns is correct but currently latent.

**Nulling a positional focus ref to fix a related stale-index bug** surfaced on the same branch. Rejected during review: the trim effect must NOT reset `focusedRowRef`, because nulling it there disarms the re-anchor path the ref exists to serve. The asymmetry is now pinned by a guard test so a later "symmetry cleanup" has to argue with a failing test (`apps/tv/src/components/home/homeFocusSeam.guard.test.js`).

## Solution

**Collapse to one predicate.** `apps/tv/src/lib/isSeriesRecord.ts` now exports `isSeriesLabel` and nothing else — a strict-uppercase `Set(["SERIES", "COLLECTION"])` membership test. Both child-counting predicates are gone. Every TV consumer keys on that single function — the two routing seams (`apps/tv/src/lib/watchRedirect.ts`, `apps/tv/src/components/series/seriesScreenState.ts`), the two press-path routers (`apps/tv/src/components/home/homeCardRouting.ts`, `apps/tv/src/components/search/searchResultPath.ts`), and the display surfaces that gate hover-preview and count nouns (`apps/tv/src/components/home/HomeCard.tsx`, `apps/tv/src/lib/watchHome/model.ts`, and their siblings).

Both routing seams state the invariant in their own comments — `watchRedirect.ts` in its module header, `seriesScreenState.ts` in the `resolveLeafBounce` docstring — so a future edit to either has to read the reason. The header records that sharing the one predicate "is what makes them exact inverses and unable to loop; a second predicate would break that".

**Carry the chapters across rather than dropping them.** Routing a film to `/watch` would have stranded its 61 chapter clips, so the watch screen gained them:

- `GET_VIDEO_BY_SLUG` selects the record's own `children` **on the operation, not on the shared `watchVideoFragment`** (`apps/tv/src/lib/videoQueries.ts`) — the fragment is reused by the series query, and widening it there would have inflated every consumer's payload. The selection is field-for-field with `GET_SERIES_BY_SLUG`'s children so one normalizer serves both, and the derived `NormalizableChildRel` type makes a dropped field a compile error rather than an empty rail.
- A shared `buildChildren` normalizer (`apps/tv/src/lib/normalizeVideo.ts`) feeds both the series episode rail and the new watch chapter rail; `normalizeVideo` exposes it as `chapters`.
- `EpisodeRail` is parameterized by a noun object — `EPISODE_NOUN` vs `CHAPTER_NOUN` — which swaps heading, eyebrow, and the Datadog action name (`series-episode` / `film-chapter`) in one place.

**Make the count nouns label-aware.** `buildMetaLabel` picks "episode" or "chapter" off the raw label (`apps/tv/src/lib/watchHome/model.ts`), so JESUS reads "61 chapters" on a Home card and matches its own watch page. Search chips do the same: `${count} EP` for a labelled container, `${count} CH` otherwise (`apps/tv/src/components/search/searchDisplay.ts`).

**Evidence the narrowing is safe.** A survey of the catalog (935 videos) run during the fix found 109 records with children: 55 SERIES, 44 COLLECTION, 8 FEATURE_FILM, 2 SHORT_FILM (summing to 109, with the 8 + 2 non-container parents being the ten films). No real container was labelled anything other than SERIES or COLLECTION, so label-only routing loses nothing against the catalog as surveyed; each of the ten film-parents was observed to carry its own published HLS. **All of these figures — the totals, the ten-title count, and the HLS observation — came from live queries against the deployed admin API and are not reproducible from the tree.** Treat them as a point-in-time observation, and re-survey before relying on them to justify a further narrowing.

**The regression test uses the real titles.** `apps/tv/src/lib/isSeriesRecord.test.ts` enumerates jesus/61, book-of-acts/73, life-of-jesus-gospel-of-john/49, the-savior/55, magdalena/46, my-last-day/1 rather than a synthetic `{ label: "FEATURE_FILM", childCount: 1 }`. Note what is and is not load-bearing: the test asserts on the **label** of each row, and the child counts sit in the table as documentation of why the rule is what it is — they are not themselves asserted. That is the intended split (the predicate no longer reads counts at all), but do not read the table as coverage of the counts. A separate case pins the strict-uppercase branch — the fixture where only that branch can match, since a case-folding predicate would accept `"series"` and the wire never sends it.

## Why This Works

One predicate is not a tidiness preference here; it is what makes recurrence structurally impossible. With `resolveWatchRedirect` and `resolveLeafBounce` reading the same function, the two seams cannot disagree by construction — there is no state in which one says "this is a container" and the other says "this is a leaf". The previous shape allowed exactly that disagreement, and the disagreement is what let a film come to rest on the wrong screen. A single shared predicate degrades the worst case from "wrong page, silently" to "redirect loop, loudly" — and a loop cannot even form, because the two branches partition on the same boolean.

Label-only also matches where the decision is made. Routing happens on a press, from a payload that has `label` and `childCount` and nothing else. Of those two fields, only `label` carries information about containment; `childCount` describes structure, and in this catalog structure and containment are independent. Deriving a containment answer from a structure signal was the original error, and no amount of care at the call sites would have fixed it.

## Prevention

**A domain classification with a two-way routing consequence should be ONE predicate, shared by both directions.** Whenever code has an A→B redirect and a B→A bounce, find the predicate each one reads. If they are different functions — even functions that "obviously agree today" — that is the bug waiting to happen. The failure mode is silent: content settles on the wrong side instead of ping-ponging where you would notice.

**A wrong glossary entry actively teaches future agents the wrong rule.** `CONCEPTS.md` had encoded the defective rule as canonical vocabulary — "a Video whose label is SERIES or COLLECTION, **or any record with children**". An agent that greps the glossary before touching routing would have re-derived the exact predicate this fix deleted. The entry is corrected on this branch to say series-shaped means the label is SERIES or COLLECTION, full stop, with children explicitly called out as not evidence. Treat the glossary correction as part of the fix, not as follow-up paperwork.

**Regression tests for catalog-shaped bugs should use real catalog rows.** A synthetic `{ label: "FEATURE_FILM", childCount: 1 }` fixture proves the branch shape and nothing about the data. The real titles and their real child counts also document _why_ the rule is what it is, so the next reader sees that JESUS has 61 children and is still one film.

**When narrowing a predicate, survey the corpus before you narrow.** The "109 records with children, 55 SERIES / 44 COLLECTION / 8 FEATURE_FILM / 2 SHORT_FILM" breakdown is what turned "label-only feels right" into "label-only loses nothing." Without it, deleting the `childCount` clause is a guess about unlabeled containers that may or may not exist.

## Status and remaining exposure

Shipped in **PR #1767** (`fix(tv): show feature films as films, not series`), which is **OPEN and unmerged** as of this writing — CI green, branch `fix/tv-feature-film-series-label`. Nothing described here is reachable from `main` yet.

**`apps/mobile` carries a related variant, live** — but do not port this fix mechanically. `apps/mobile/src/lib/isSeriesRecord.ts` retains both `isSeriesRecord` (label OR `episodes.length > 0`) and `isSeriesSearchResult` (label OR `childCount > 0`). Live consumers are the search route in `apps/mobile/app/(tabs)/watch.tsx` and Home cards in `apps/mobile/src/components/home/HomeCard.tsx`; the redirect in `apps/mobile/app/watch/[slug].tsx` uses `isSeriesRecord`, while `apps/mobile/src/components/home/HomeScreen.tsx` routes on `isSeriesLabel` alone — the same two-predicate asymmetry TV just removed. Mobile's lean `/watch` fragment omits children, so `episodes` is `[]` there today and that path is _incidentally_ label-only; the bug is latent and one fragment widening away from waking up.

Two constraints make the mobile port a different job, not a copy-paste:

- **Mobile deliberately runs two predicates for two different purposes.** (session history) Earlier Library-grouping work added a stricter SERIES-only helper _alongside_ `isSeriesLabel`, precisely because `isSeriesLabel` treats SERIES and COLLECTION alike — correct for navigation, wrong for download-folder grouping. Collapsing mobile's predicates indiscriminately risks reintroducing the inverse bug (breaking legitimate COLLECTION-as-series navigation). Identify which uses are _navigation_ and which are _grouping_ before touching either.
- **JFP overloads COLLECTION.** (session history) A data-reality investigation flagged that COLLECTION is used both for unordered film-bags and for genuinely episodic containers. TV's label-only rule was validated against the catalog survey above; mobile's grouping surfaces need their own check rather than inheriting that conclusion.

Mobile's `isSeriesLabel` also case-folds over lowercase literals, whereas TV's is strict uppercase against the wire enums. TV chose strict deliberately — case-folding lets lowercase fixtures pass falsely, so a test written against `"series"` would go green while production sends `"SERIES"`.

## Related

- `docs/solutions/architecture-patterns/cross-client-hero-parity-eligibility-gate.md` — prior art for the correct rule on the same entity: the home-hero eligibility gate already drops COLLECTION/SERIES by label alone and deliberately keeps feature films. The principle was right there; this bug is what happens when a second surface derives it independently and gets it wrong.
- `docs/solutions/logic-errors/tv-home-orientation-field-overloaded-card-shape-signal.md` — different bug, same meta-pattern: one field silently overloaded as a signal it does not actually carry.
- `docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md` — admin's `Video.parents`/`Video.children` `@relation` labels are inverted on `main` (deliberately deferred). Not the cause of this bug, but it is why `buildChildren` self-filters and dedupes rather than trusting the relation, so the chapter rail is correct both before and after that fix.
- `docs/solutions/architecture-patterns/tv-home-single-admin-experience-migration-20260712.md` — contains a now-stale parenthetical asserting that a real `childCount` implies correct series routing.
- `docs/solutions/performance-issues/tv-mobile-series-detail-overfetch-and-childdublanguages-index-20260619.md` — benchmarks `jesus` as a legitimate series-detail load. Post-fix `jesus` no longer reaches that screen, so its example is historical; its composite-index recommendation still applies to genuine high-fan-out series.
- Root `CLAUDE.md`'s mocked-shape-vs-real-contract discipline covers the testing half: the real-catalog fixture table is the production-contract companion to the synthetic branch-shape cases.
