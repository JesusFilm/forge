---
title: "Measure a blast radius from the rendered production site when the database is unreachable"
date: 2026-08-28
category: best-practices
module: apps/web
problem_type: best_practice
component: development_workflow
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A review concludes a change's blast radius is unmeasurable because the working environment (git worktree, local dev) has no Admin GraphQL or database credentials"
  - "The change affects a population of public, already-deployed Next.js pages reachable from a public sitemap"
  - "The change keys on data already embedded in each page's rendered output or RSC flight payload, not only in a database column reviewers cannot query"
  - "Multiple reviewers independently defer the same measurability question instead of re-deriving it from public production evidence"
related_components:
  - apps/web
tags:
  - verification
  - blast-radius
  - sitemap
  - rsc-payload
  - no-backend-access
  - code-review
---

# Measure a blast radius from the rendered production site when the database is unreachable

## Context

PR #2095 (`fix(watch): rank standalone carousel parents by label, not relation order`, open against `main` and unmerged as of this writing) changed which parent container a standalone `/watch/<slug>.html` page opens its sibling carousel on. Before it, the default parent was whichever one admin's `Video.parents` returned first — sorted by `VideoRelation.order`, which is _the child's index inside each parent_, not a ranking between parents. After it, `rankSelectableCarouselParents` (`apps/web/src/lib/content.ts:2866-2875`) does a stable two-tier sort that promotes any parent whose own `label` normalizes into `CONTAINING_WORK_PARENT_LABELS` — the set `["FEATURE_FILM", "SERIES"]` at `apps/web/src/lib/content.ts:2839`.

The obvious question — _how many live pages does this actually reorder?_ — was declared unanswerable. Five reviewers, including an independent cross-model peer, agreed: the count needs a query over `VideoRelation` joined to parent labels, the worktree has no Admin GraphQL credentials, so it cannot be run here. The change shipped with the blast radius unknown, recorded as the first deferred Open Question in `docs/plans/2026-08-28-0941-fix-standalone-carousel-parent-ranking-plan.md:75`.

That conclusion was wrong, and the reason it was wrong generalizes. `apps/web` is a Next.js App Router site. Every rendered page embeds an RSC flight payload in its HTML carrying the serialized props of the client tree — and for this change, those props _were_ the inputs to the decision. The data needed to answer the question was already published on the public internet, 1,154 times over.

## Guidance

When a change's blast radius appears to need a backend you cannot query, check first whether the rendered production site already carries the deciding fields. For a Next.js App Router app the check is concrete: does the serialized payload contain the props the change keys on? If yes, the whole population is a `curl` loop away — no credentials, no VPN, no read replica.

The method that worked, in order:

### 1. Take the population from the sitemap, not a sample

`https://www.jesusfilm.org/watch/sitemap.xml` is a sitemap _index_: it lists child sitemaps, one `<sitemap><loc>` per chunk (`renderWatchSitemapIndex`, `apps/web/src/lib/watch-sitemap.ts:347-359`), each served by `apps/web/src/app/sitemap/[id]/route.ts` and chunked from the SEO manifest (`apps/web/src/lib/watch-seo-manifest.ts`). Ten chunks were live on 2026-08-28. Filtering the union to one-segment English URLs — `^https://www\.jesusfilm\.org/watch/[^/]+\.html$` — yields 1,154 pages. (`/watch` is the app's `basePath`; see `apps/web/watch-base-path.mjs:6`.)

That is the _entire_ standalone English population, not a sample, which is what makes the resulting counts an answer rather than an estimate. Route-shape filtering matters: the two- and three-segment URLs in the same sitemap are contextual episode routes, where a canonical parent comes from the URL and this ranking is never reached (`buildSiblingCarouselBlock` returns on the canonical-parent branch first, `apps/web/src/lib/content.ts:2896-2909`).

### 2. Fetch with compression, then unescape before parsing

`curl -sS -L --compressed` per page. Inside the HTML the flight payload is embedded as JavaScript string literals, so its quotes arrive escaped as `\"`. Unescape before you attempt any structural parse, or every brace-matcher and JSON reader you point at it will disagree with the bytes.

### 3. Discriminate record kinds by SHAPE, grounded in the types — not by field order

Parent and child objects in the carousel block are distinguishable structurally. A `CarouselParent` (`apps/web/src/lib/content.ts:2669-2683`) is `documentId`, `slug`, `title`, `children`, and optionally `label`. A `WatchChild` (`apps/web/src/lib/content.ts:180-203`) is `documentId`, optional `order`, `slug`, `title`, `label`, `images`, `durationSeconds`, `muxPlaybackId`, and the blur-data-URL fields.

The load-bearing discriminator is **`children`**: only a parent has it. Do not use `label` — both types carry it. Do not use `order` as a positive parent test either; it is optional on `WatchChild` (`content.ts:183`) and simply absent on parents. And treat the _order of keys_ in the observed payload as an artifact of the serializer, not a contract: it happened to read `{"documentId":..,"slug":..,"title":..,"children":[` for parents and `{"documentId":..,"order":N,"slug":..}` for children, which is a useful eyeball heuristic and a terrible parser.

### 4. Use a conditionally-serialized field as the population filter

`selectableParents` is the standalone-only picker list. It is emitted only on the third branch of `buildSiblingCarouselBlock` (`apps/web/src/lib/content.ts:2931-2940`), reached only when the route supplied no canonical parent _and_ the video's own admitted children number fewer than two (`content.ts:2896`, `content.ts:2912`; the route's gate is `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx:1006-1013`). Every entry in it has already passed per-parent eligibility in `selectableParentsForStandaloneVideo`: the parent must have at least two manifest-admitted children and must actually contain the current video (`page.tsx:296-334`, gate at `:315-318`).

So the field does two different jobs, and conflating them will skew your counts:

- **Presence** of `selectableParents` marks the population whose rail is owned by an external parent at all. One eligible parent is enough for the key to be serialized — the condition is `selectableParents.length > 0`, not `>= 2`.
- **Length ≥ 2** is the population that can _change_, because `rankSelectableCarouselParents` returns its input untouched below two entries (`content.ts:2869`).

A conditionally-serialized field is the cheapest population filter you will ever get: its mere presence in the HTML is a server-side predicate you did not have to re-implement.

### 5. Expect the payload to carry the PRE-change shape, and plan a second hop for anything the change adds

This is where the technique bites. Production is running the code _before_ your change — that is exactly what makes it a valid baseline — but it therefore cannot contain any field your change introduces. Here, `label` on `selectableParents` entries was added by the PR itself (`label: filteredParent.label`, `page.tsx:331`; `git log -S 'label: filteredParent.label'` confirms PR #2095 is the only change to touch that line). The live payload had no parent labels at all.

The recovery: each distinct parent's `label` was resolved by fetching _that parent's own_ `/watch/<parent-slug>.html` once and reading the top-level record `label` off its `WatchBody`/`HeroPlayer` block — 47 extra fetches for the whole corpus. That works because `WatchVideoRecord` carries `label` (`content.ts:322`) and `pruneWatchVideoForClient` empties only `parents`, `children`, `childDubLanguages`, `studyQuestions`, and `bibleCitations` — `variants` is replaced with a single pruned entry rather than emptied — and spreads everything else through (`page.tsx:116-133`). Carousel blocks are not pruned at all — they fall to `default: return block` in `pruneMergedWatchBlocksForClient` (`page.tsx:178-179`).

Corollary: the second hop is temporary. Once PR #2095 deploys, `selectableParents[].label` is in the payload and the same measurement is a single pass.

### 6. Parse arrays structurally. Never regex-slice a serialized payload

**This is the near-miss, and it is the part of this technique most likely to hurt you.**

An earlier, sloppier pass of this same method produced a _wrong answer that reached the user and caused a false bug report_. The goal was to list a parent's children; the implementation took N entries by slicing forward from a flat text offset. The slice ran straight off the end of one parent's `children` array and into the adjacent parent's, and the tool dutifully reported 12 phantom "duplicate" children. The two parents had 29 and 49 children; concatenated, 78 — and the overlap read as duplication.

Bracket-matching the array — track depth, respect string literals, respect backslash escapes inside them — gave the correct answer: 29 and 49 children, no duplicates in either parent. That correction is recorded in the plan's Scope Boundaries (`docs/plans/2026-08-28-0941-fix-standalone-carousel-parent-ranking-plan.md:65`).

A flight payload is one long line of densely packed sibling records with no delimiters your regex knows about. Any offset-based slice silently splices neighbouring records, and the failure mode is not an exception — it is a plausible-looking number. Parse the array as a structure, and sanity-check every count against a second, independently derived figure before you report it.

## Why This Matters

The reviewers were not careless; the framing was. "This needs a database query" is a statement about one _route_ to the answer, and it silently became a statement about the answer's _availability_. A rendered site is a materialized view of the database, published, cached, and free to read. For any change whose decision inputs are serialized into the page, the production HTML is a legitimate — and in some ways better — data source than the database: it reflects what users actually see, and it is filtered to exactly the pages that render.

The payoff on this run was concrete. Three of the four deferred Open Questions in the plan became answerable, and one adversarial reviewer concern was actively **falsified**: the argument was that `SERIES` and `COLLECTION` are used interchangeably by editors, so promoting `SERIES` could rank a playlist above the film a clip belongs to. The data says the opposite — all ten `SERIES` parents in the corpus are genuine multi-part works, and every playlist-shaped container is a `COLLECTION`. That is a class of reviewer objection which argument cannot settle and 1,154 fetches can.

It also matters as a discipline correction in the other direction. The near-miss shows the technique has a sharp edge: it produces numbers with no schema, no type checker, and no test to catch a parsing error, so a wrong answer looks exactly like a right one. The mocked-vs-real discipline in `CLAUDE.md` applies to your _reader_ here as much as to production code — the parser is the untested surface.

This is the third member of a family of "verify `apps/web` without a backend" techniques alongside the two in the user's auto memory: a jsdom probe over the real component tree (DOM/SSR-byte counts, but no LCP), and an iframe harness for a real 390px mobile render. All three trade backend access for a different real substrate.

## When to Apply

Reach for this when **all** of these hold:

- The change's decision inputs are values that reach the client — props, serialized records, IDs, labels, ordering keys — rather than server-only state.
- You need a _population_ answer ("how many pages does this move?", "which values actually occur?", "is this field ever null in practice?") rather than a per-request behavioural one.
- The site publishes an enumerable URL set (sitemap, route manifest, index page) so you can claim coverage instead of a sample.
- The measurement is one-shot decision support for a review or a plan, and a point-in-time answer is enough.

Do **not** reach for it when:

- The field you need is server-only, pruned before serialization, or added by the change under review (see §5 — that one is recoverable with a second hop, the other two are not).
- You need a repeatable gate. This is a manual read, not CI. Nothing re-runs it, and nothing fails when the answer drifts.
- The population is large enough that polite crawling matters. 1,154 + 47 sequential `curl`s against your own production site is fine; six figures is a conversation with whoever owns the origin.

### Scope limits to state honestly in whatever you write up

Every number produced this way inherits four caveats, and they belong next to the numbers, not in a footnote:

1. **English, one-segment pages only.** Other languages were not scanned; the same clip in another audio language can have a different manifest-admitted parent set (`withCompatibilityAdmittedCarouselChildren`, `page.tsx:198-227`, filters children per selected language).
2. **A point-in-time read**, dated, not a repeatable gate. Re-capture before trusting the figures again.
3. **It measures what production RENDERS**, which is a cached ISR view — not necessarily current database state. A recent editorial change may not be reflected yet.
4. **The parse is the untested surface.** Cite the parsing strategy (structural, not offset-based) alongside the counts so a reader can judge them.

## Examples

### The measurement

English standalone pages, production, read 2026-08-28:

- **1,154** English one-segment `/watch/<slug>.html` pages in the sitemap — the whole population.
- **200** of them carry two or more eligible parents, i.e. the population `rankSelectableCarouselParents` can reorder at all.
- **43** actually change their default container under the new ranking.
- Of the **157** that do not move: **81** already opened on a film or series (admin's `VideoRelation.order` happened to agree), and **76** have only `COLLECTION` parents, so no tier promotion is possible.

### The label distribution — the falsified objection

Only three labels are _ever_ used as a parent container across the corpus:

| Parent label   | Distinct parents |
| -------------- | ---------------- |
| `COLLECTION`   | 32               |
| `SERIES`       | 10               |
| `FEATURE_FILM` | 5                |

`SHORT_FILM`, `EPISODE`, `SEGMENT`, and `TRAILER` never appear as a parent. All ten `SERIES` parents are genuine multi-part works — `rivka` (~235 children), `walking-with-jesus-africa` (~148), `following-jesus-india` (~148), `new-believer-course` (~146), `reflections-of-hope` (~129) — and every playlist-shaped container is a `COLLECTION`. The reviewer's interchangeability concern does not hold in this data.

This also partially answers the plan's second Open Question (`plan:76`, whether `SHORT_FILM`/`EPISODE` should join the promoted tier): today, neither label ever occupies a parent slot, so adding them would be a no-op on the current corpus.

### The ties

44 pages resolve to two _promoted_ parents, where the tie falls back to admin's `VideoRelation.order` — the very key the change calls coincidence (`plan:78`, the fourth Open Question). Every one of those 44 is the same pair: `magdalena-2` and `magdalena`, two cuts of one film. That reframes the open question from "unbounded ambiguity" to "one known duplicate-edition pair", which is a scoping decision rather than a design hole.

### The near-miss, concretely

Offset-slicing the payload for a parent's children:

- reported: 12 duplicate children in the resurrection collection
- actual: 0 duplicates; two adjacent parents with 29 and 49 children, spliced into 78 by a slice that crossed the array boundary

Bracket-matching with string-literal and escape awareness returned the correct 29/49. The wrong answer had already reached the user as a bug report by then.

## Related

- `docs/solutions/logic-errors/join-order-column-is-not-a-ranking-in-the-reverse-direction.md` — the bug this technique was applied to. Companion, not duplicate: that doc covers the ranking-direction defect and its test layers, this one covers how its real-world impact was measured.
- `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md` — closest sibling in shape: verify from evidence already available rather than from a fresh probe that looks impossible.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the repo's META doc on mocked-vs-real evidence. The offset-slicing near-miss in §6 is the same trap family it catalogs, applied to an ad-hoc production-inspection script rather than a test fixture.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — sibling in spirit (get real evidence, not a proxy), different axis: page-load performance rather than data correctness.
- `docs/plans/2026-08-28-0941-fix-standalone-carousel-parent-ranking-plan.md` — the plan whose first Open Question this technique answered.
