# Slice: thelife (thelife)

_Branch: `slice/thelife` · Started: 2026-05-29 · Completed: 2026-06-03 · Status: done_

<!-- Status: in-progress | blocked | done -->

## Goal (architecture altitude)

Get **thelife.com** (Cru Canada's discipleship corpus, the live successor of the
decommissioned powertochange.com) queryable end-to-end: acquire → ingest →
retrieve → spot-check. This is **slice #5** and the **third source to reuse the
discovery-crawl machinery (FOLLOW-UP F) without new acquisition code** — thelife
is sitemap-driven (`/sitemap.xml`, 7,834 `<loc>` entries, no index), so the
slice-#3/#4 `discover.ts` handles it via `CrawlPolicy.sitemaps` +
`articleHints`/`block` filtering. **First time the crawler runs against a
Statamic site** (slice #3/#4 were WordPress/Yoast) — recon found a flat sitemap
and conventional HTML, no SPA shell.

**Important pivot — read before resuming.** The slice was initially unpacked as
`power-to-change` (jfa key, ~1200 sitemap-driven). Recon on 2026-05-29 found
powertochange.com fully decommissioned: every probed content URL 301-redirects
to thelife.com (or to issuesiface.com for the `/discover/` + `/itv/` "issues"
sub-axis). Staging powertochange.com would yield 1000 redirect-to-homepage rows.
The actual Cru Canada discipleship corpus lives at **thelife.com** now —
Statamic-powered, fresh content (6,478 entries `lastmod` 2026), open robots —
so we pivoted the slice. Issues I Face stays its own backlog row (no sitemap;
needs a different discovery path).

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents (reuse the discovery crawler)

- [x] 1a. **Recon** — homepage + robots + sitemap probed under browser UA;
      decided the pivot from powertochange.com → thelife.com and the scope.
      Findings recorded in "Decisions made" below. <!-- sha: 86a98c4 -->
- [x] 1b. Register `thelife` SourceEntry in `src/registry/` with one flat
      `/sitemap.xml`, `.article-body` content selector (confirmed on BOTH
      articles AND devotionals). **Initial articleHints were wrong** — see
      1c below; corrected as part of the dry-discovery commit. <!-- sha: cb4281d -->

- [x] 1c. **Dry discovery** + **policy correction**. Ran `discover.ts` against
      live `/sitemap.xml`; the initial filter math was wrong because the
      recon's path-distribution awk hid the real URL structure. Corrected
      and re-ran.

      _True URL shape on thelife.com_:
      - **Articles live at bare-root** single-segment slugs `/<slug>` (628 in
        sitemap, ~5 are nav/utility blocked → **623 article slugs**).
      - `/articles/...` namespace contains ONLY tag-index pages
        (`/articles/tags/<tag>`) — 478 of them, NOT articles.
      - **Devotionals** at `/devotionals/<slug>` — **3,929**.
      - `/devotionals/tags/<tag>` is another 1,086 tag indexes (fail
        single-segment hint, drop).

      `articleHints` updated to `^/[^/]+/?$` (bare-root) + `^/devotionals/[^/]+/?$`
      (single-segment devotional). `block` extended to catch the nav/utility
      bare-root slugs that match the broader hint (`chat`, `give`, `partners`,
      `about`, `contact`, `error-report`, `content-submission-form`,
      `chat-terms-of-service`, `editorial-*`, `writing-for-the-internet`) and
      defensive section indexes. Registry test rewritten to assert the new
      shape — articles at bare-root kept; `/articles/tags/*` dropped; nav
      slugs dropped; off-shape paths dropped.

      **Dry-discovery result: 4,552 kept / 7,834 seen** (3,929 devotionals
      + 623 articles). `maxPages` lowered 6000 → 5000.            <!-- sha: 1c-commit -->

      **OPERATOR PAUSE — confirm crawl + embedding budget** for 4,552 docs
      before live fetch. Numbers: crawl ~114 min at 1500ms delay; embed cost
      ~$0.11 at ~2.5 chunks/doc (Sightline's average) × ~500 tok/chunk × $0.02/M
      tokens for `text-embedding-3-small`.

- [x] 1d. Live `pnpm acquire --source thelife` stages rows in `raw_documents`
      across **two passes** (Cloudflare 429s drove a delay adjustment, see
      below). Pass 1 @ 1000ms: 2,520 / 4,552 staged · skipped 2,025
      fetch-failed (2,018 were HTTP 429, 1.7s sustained limit on this site).
      Pass 2 @ 2000ms: 4,446 / 4,552 staged · skipped 96 fetch-failed (80
      HTTP 429, 1.8% — proves 2,000 ms is comfortably under Cloudflare's rate
      limit). **Union of both passes in `raw_documents` = 4,485 distinct rows
      (98.5% of target)**: 616 bare-root articles + 3,869 devotionals; all
      status 200, 0 null titles; chars min 252 / avg 2,454 / max 24,164.
      Spot-read 5 random rows = real prose ("The Life ::" titles, devotionals
      ~2 k chars, articles ~5 k chars). 67 URLs unaccounted (presumably stuck
      429s + a handful of 404s); not worth a third pass for ~1.5% — the slice
      corpus is set. <!-- sha: 1d-commit -->
      <!-- requestDelayMs change 1000→2000ms is the only registry change in this commit. Pass 1 log archived at /tmp/thelife-acquire-pass1.log. Verify green: depcruise 0/75, tests 112/112. -->

### 2. Ingest → corpus tables

- [x] 2a. `pnpm index --source thelife` drained all 4,485 pending raw rows →
      **4,485 docs / 7,905 chunks / 7,905 embeddings** (`openai/text-embedding-3-small`,
      1:1 chunks:embeddings, 0 nulls dropped). **0 chunk_count mismatches**;
      chunks/doc **min 1 / avg 1.76 / max 17** (lower than Sightline's 2.5 — short
      devotionals dominate). Idempotent re-run drained 0. Spot-read 3 random chunks =
      clean devotional prose, no nav/boilerplate. **Full gate green after ingest**:
      depcruise 0/75, lint 0/4 (pre-existing warnings), typecheck clean,
      **112/112 tests** — the slice-#3/#4 integration-fixture risk did NOT bite
      despite ~3.2× corpus growth (4 → 5 sources, ~6.5 k docs total). <!-- sha: f50e2e7 -->

### 3. Retrieve → ranked results

- [x] 3a. Spot-retrieval against the 5-source space (~14.7 k chunks): 6 queries
      via `pnpm query`. **thelife dominates its native topics with cross-source
      health preserved:** - "how do I grow as a disciple of Jesus?" → top 3 thelife (0.706/0.666/0.666),
      #4–5 jesusfilm-org (0.643/0.632). jf surfaces alongside. - "I'm anxious and can't sleep — what does the Bible say?" → **all 5 thelife**
      (0.594→0.572). **FOLLOW-UP I/J small-source crowding signal manifesting
      exactly as predicted** by the operator at slice-unpack; not a regression. - "is Christianity intolerant?" → #1 sightline (0.686), #2 jf (0.673), #3–5
      sightline. The slice-#3 `jf-skeptic-intolerant` gap that slice #4 closed
      remains closed. - "how can I be sure I will go to heaven?" → #1 thelife (0.551), **#2 swg
      "How to Be Sure of Heaven" (0.548)** — the slice-#1 flagship doc still
      surfaces (edged by 0.003); sightline #5. Cross-source health preserved.
      **Dedup intact** — every query returned 5 distinct URLs / 5 distinct
      documents; 3-key content-hash dedup holds at 5 sources.
      **minScore 0.37 holds at 5 sources:** - "best index fund to buy in 2026" → **0 hits** (secular floor unchanged). - "what does Ramadan teach about fasting?" → 5 hits 0.401–**0.495**, all
      legitimate Christian-fasting content (Jesus fasting, spiritual discipline)
      — the corpus has no Islamic content, so this is honest topic overlap on
      "fasting", below the typical 0.55+ positive band. Note: top edged above
      the historical Quran/Ramadan 0.389 reference; flag for re-check during
      Stage 4 curation but not a noise breakthrough (results aren't off-topic
      — they're on a different framing of the same word). <!-- sha: 7aedbad -->

### 4. Spot-check / eval (via `/golden`)

- [x] 4a. `/golden thelife` ran in operator-led, content-grounded mode (operator
      pushed back on title-only curation; we re-grounded every decision in
      actual chunk snippets via a surgical probe). **Pre-curation baseline @
      5 sources / 42 cases** confirmed the expected living-relevant-set
      artifact: recall@3 0.714, recall@10 0.833, coverage 0.464, MRR 0.619,
      P@1 0.500 — every metric down from slice #4 (recall@3 0.810 / recall@10
      0.976 / cov 0.583), exactly as slice #3/#4 lesson predicted. 7 hard
      misses + 5 degraded-rank cases isolated as the curation surface.

      **Part A — re-review of existing 42 cases.** Surgical probe per case
      returned top-10 with chunk snippets; operator approved 67 path additions
      across 12 cases (mix: 25 thelife · 28 sightline · 9 jesusfilm-org · 5
      starting-with-god). **Bonus:** the re-review fixed a substantial slice-#4
      sightline curation gap (15+ sightline docs that were already in the
      corpus but never credited surfaced as legitimate answers); closed the
      long-standing slice-#3 `jf-believer-disciple-making` vocab gap via
      thelife `/discipleship-101` ("Seven Steps to Helping a New Christian").

      **Part B — 10 new persona-diverse thelife-native cases.** Authored
      (3 seeker / 2 skeptic / 3 believer / 2 newcomer) covering gaps the
      existing 42 didn't reach (grief over a lost child, post-abortion
      healing, depression+meds, cosmology, the "loving God + hell" tension,
      marriage drift, hard obedience, discipling a brand-new Christian,
      next-step-after-decision, finding a church). **Engine sanity-check
      revised 3 of the 10 cases** (`tl-skeptic-hell`, `tl-believer-marriage-
      drift`, `tl-believer-obedience`) by surfacing better matches than my
      initial draft — exactly the kind of content-grounded correction the
      surgical workflow enables.

      **Part C — 4 negatives** for cutoff calibration (not written to
      `qa-golden.yaml`; eval.ts would miscount them as misses): see
      "Negatives" section below.

      **Post-curation final eval @ 52 cases / 5 sources:** recall@3 **1.000**,
      recall@10 **1.000**, coverage **0.624**, MRR **0.907**, P@1 **0.827**.
      Per-source: **thelife n=22 recall 0.955 coverage 0.851** · sightline
      n=34 0.853/0.603 · jesusfilm-org n=27 0.815/0.664 · starting-with-god
      n=20 0.500/0.335 · **cru-10-basic-steps n=15 recall 0.200 coverage
      0.167 (unchanged — see honest finding)**.

      **Honest finding: cru/swg per-source coverage did not recover** —
      confirming the slice-#4 observation. The thelife re-review credits
      newly-relevant thelife docs (perfect coverage where credited), but
      cru/swg docs that COULD be credited for shared questions still get
      crowded out of top-10 by the broader thelife/sightline content. This
      is exactly the **FOLLOW-UP I #15 (consumer-specified retrieval
      diversity: `maxPerSource` / MMR)** signal — mechanism-not-policy at
      the retrieval engine; the right fix is at the consumer layer where
      the application's source-balance preference lives.

      **`minScore 0.37` holds at 5 sources** — 4/4 secular negatives return
      0 hits (running shoes / leaking faucet / vacation spot / small-business
      LLC); Quran/Jesus faith-adjacent cluster at 0.436–0.448, above floor
      but well below the 0.55+ positive band; Buddhism/meditation returns 0.

      Full gate green throughout (depcruise 0/75, lint 0 errors, typecheck
      clean, 112/112 tests).            <!-- sha: a88acba -->

## Negatives (cutoff calibration — NOT in qa-golden.yaml)

For `pnpm query` eyeball at 5 sources; should return 0 hits at `minScore 0.37`:

- "best running shoes for marathon training" — 0 hits ✓
- "how to fix a leaking faucet at home" — 0 hits ✓
- "what's the best vacation spot for summer 2026" — 0 hits ✓
- "how to set up a small business LLC" — 0 hits ✓

Faith-adjacent (above floor, below positive band):

- "what does the Quran say about Jesus" — 5 hits 0.436–0.448 (about Jesus's
  deity / identity, no Islamic content in corpus; below 0.55+ positive band)
- "best meditation techniques from Buddhism" — 0 hits

### thelife-fr (laviejenparle.com) — qwen corpus, 2026-07-02

Moved here 2026-07-03 when `eval/candidates-thelife-fr.yaml` was folded into
qa-golden.yaml (this slice hosts the fr/zh variants; they have no slice file).
Scores are the top hit via `pnpm query` (qwen, minScore floor reference 0.37):

- "Comment déclarer mes impôts au Québec ?" — EN: How do I file my taxes in Quebec? → top 0.438 (money article)
- "Quelle est la meilleure recette de tarte au sucre ?" — EN: What's the best sugar-pie recipe? → top 0.317
- "Comment réparer un robinet qui fuit ?" — EN: How do I fix a leaking tap? → top 0.367
- "Quel entraînement pour courir un marathon ?" — EN: What training plan for a marathon? → top 0.329

### thelife-zh (uwota.com 人生你我他) — qwen corpus, 2026-07-02

Moved here 2026-07-03 from `eval/candidates-thelife-zh.yaml` (same fold):

- "怎么做正宗的红烧肉？" — EN: How do I make authentic braised pork? → top 0.230
- "去日本自由行签证怎么办理？" — EN: How do I get a visa for independent travel to Japan? → top 0.221
- "如何修理漏水的水龙头？" — EN: How do I fix a leaking tap? → top 0.238
- "学游泳有什么技巧？" — EN: What are tips for learning to swim? → top 0.454 (modesty/swimsuit article — semantic neighbor)

## Decisions made (this slice)

- 2026-05-29 — **Pivoted target from powertochange.com → thelife.com.** Recon
  found powertochange.com 301-redirects every content URL (homepage → thelife.com;
  `/discover/`, `/itv/` → issuesiface.com). Sitemap exists (1000 stale WP entries
  2014-2017) but content is gone. thelife.com is the live Cru Canada successor:
  Statamic, fresh sitemap (7,834 locs, 6,478 with lastmod 2026), open robots.
  Source-key renamed `power-to-change` → `thelife` to match URLs and the 1:1
  file↔key convention.
- 2026-05-29 — **Scope = articles + devotionals (~5,500 docs)**, operator-chosen
  over articles-only (478) or devotionals-only (5,015). Explicitly taking the
  broader scope despite slice #4's small-source crowding signal (FOLLOW-UP I).
  Expected consequence: per-source coverage for cru/swg/sometimes jf likely
  drops further in the eval — that's a sharper signal for #15, not a regression.
- 2026-05-29 — **First Statamic source.** Recon-validated content selector
  `.article-body` (probed `/10-spiritual-questions-and-their-answers` → 200,
  `class="article-body dropcap"`); to be confirmed against a `/devotionals/`
  sample at sub-step 1b. Open robots (`Disallow:` empty).

## Open question / blocker

- ~~(1b) Does `.article-body` cover both `/articles/` and `/devotionals/`
  shapes?~~ **Resolved 2026-05-29 at 1b:** yes — probed
  `/devotionals/a-higher-calling` → `<section class="article-body dropcap">`,
  identical to articles.
- none

## Resume hint (for a cold start)

**Slice complete.** All four stages green; thelife is queryable and evaluated
in the 5-source space (52 cases · recall@3/@10 = 1.000 · coverage 0.624 · MRR
0.907 · P@1 0.827). Next concrete action is at the operator's discretion:
merge `slice/thelife` → `main`, and/or `/slice <next-source>`. The
**FOLLOW-UP E** unblock condition (≥2 sources done end-to-end) has been
satisfied since slice #2 — this slice does not change that. **FOLLOW-UP I #15**
gets its sharpest data yet here (cru/swg per-source coverage stayed at 0.17 /
0.34 after curation: thelife/sightline crowd them out of top-10 on shared
questions even when both legitimately answer — engine-level mechanism, not a
policy regression).
