# Slice: Jesus Film Project (jesusfilm-org)

_Branch: `slice/jesusfilm-org` · Started: 2026-05-26 · Status: done_

<!-- Status: in-progress | blocked | done -->

## Goal (architecture altitude)

Get Jesus Film Project (jesusfilm.org) queryable end-to-end: acquire → ingest →
retrieve → spot-check. This is **slice #3** and the source that triggers
**FOLLOW-UP F** — the declarative **discovery-crawl** model. Slices #1–2
hand-listed exact paths; jesusfilm.org (~1,200 pages, owned) is too large for
that, so Stage 1 builds discovery (sitemap seed → allow∧articleHints filter →
drop block) once, for every large source after it. §3 already declares
Acquisition _owns_ `allow`/`block` fetch policy; this finishes that.

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents (the discovery-crawl build)

- [x] 1a. Extend `CrawlPolicy` with discovery fields (`sitemaps`/`allow`/`block`/`articleHints`); keep `seedPaths` working so SwG + Cru still validate. Registry types + registry test. <!-- sha: 1002dc9 -->
      <!-- seedPaths now optional; seedUrls() + acquire.ts log + registry test hardened; +1 discovery-shape test (79 total). -->
- [x] 1b. `src/acquisition/discover.ts`: fetch sitemaps via injected `Fetcher`, parse sitemap + sitemapindex (node-html-parser, recurse index→children), keep URLs matching allow∧articleHints, drop block, cap at maxPages. Fakes-only tests (canned XML). <!-- sha: 2dabb74 -->
      <!-- discoverUrls(deps, policy) → {urls, sitemapsFetched, totalSeen}; cycle guard + 404-skip + maxPages cap; 5 fakes-only tests (84 total). node-html-parser handles sitemap XML — no new dep. -->
- [x] 1c. Wire discovery into `acquireSource` (discovery entries crawl discovered URLs; `seedPaths` entries unchanged). Fakes-only test: a discovery entry crawls the discovered set. <!-- sha: 7798079 -->
      <!-- resolveAcquireUrls(): sitemaps→discoverUrls (∪ any seedPaths), else seeds; capped at maxPages. +1 acquireSource discovery test (85 total). -->
- [x] 1d. Probe jesusfilm.org sitemap + a real article DOM (read-only); register `jesusfilm-org` entry with confirmed `contentSelectors` + `maxPages`. <!-- sha: 6f12fce -->
      <!-- Probed: WP/Yoast, Cloudflare-200 (no wall). Corpus = ~351 /blog/ posts; /give/+page-sitemap+.kml filtered. Entry: owned, sitemap_index.xml seed, allow same-host, articleHints /blog/<slug>/, block robots-disallows+/give/+.kml/.pdf, content .entry-content (strip related-posts). maxPages 400 (operator: full crawl). +1 registry test (86 total). -->
- [x] 1e. Live crawl → `raw_documents`; spot-read content is real article prose, not nav/boilerplate. (Budget approved: full ~351.) <!-- sha: 1e-commit -->
      <!-- Discovery: sitemap_index.xml → 4 child sitemaps, 417 locs seen → 349 kept (2 bare /blog/ index pages + all /give/ + .kml correctly dropped). Crawl: staged 349/349, 0 skips. raw_content chars min 1796 / avg 9443 / max 45980. All 349 titles populated; 0 bodies start with nav text; largest (parables-of-jesus) is clean prose end-to-end. -->

### 2. Ingest → corpus tables

- [x] 2a. `pnpm index --source jesusfilm-org` drains raw_documents → documents/chunks/embeddings; counts sane; idempotent re-run drains 0. <!-- sha: 2a-commit -->
      <!-- 349 inserted / 0 skipped → 349 docs / 2114 chunks / 2114 embeddings (1:1, no null-embeds dropped); chunks/doc avg 6.1. Single model openai/text-embedding-3-small; 0 chunk_count mismatches. Idempotent re-run drained 0. Data-only step → unit gate unchanged (86 tests, green). -->

### 3. Retrieve → ranked results

- [x] 3a. A real query returns ranked, cited jesusfilm.org hits in the now-3-source space. <!-- sha: 3a-commit -->
      <!-- "parables of Jesus" → 5 cited jesusfilm.org articles, top 0.712. "share the gospel/witness" → 5 evangelism articles (0.65–0.69). Dedup intact (distinct URL/doc), scores healthy. Cross-source health: "assurance of heaven" → 4 swg + 1 jf (swg holds); "new-believer daily prayer" → 4 jf + 1 swg, **0 cru** (cru step-4 prayer displaced — carry to Stage 4 per-source coverage). Retrieval is source-agnostic + prebuilt; no code change. -->

### 4. Spot-check / eval

- [x] 4a. `/golden jesusfilm-org` + re-review existing `relevant` maps (the set is living); `pnpm eval` recall + coverage @ top-10; record per-source coverage across 3 sources. <!-- sha: 4a-commit -->
      <!-- Curated via /golden (operator approved all, 2026-05-26): Part A re-reviewed 11 existing cases (+jf docs to their relevant maps), Part B added 12 new persona-diverse jf cases (3 newcomer/3 skeptic/4 believer/2 seeker). qa-golden.yaml now 32 cases. -->

#### Stage 4 results (2026-05-26)

**Curated eval (3 sources, 32 cases, top-10):** recall@3 **0.906** · recall@10 **0.938** · coverage **0.803** · MRR **0.777** · P@1 **0.656**.
Per-source: jesusfilm-org **0.913** (n=23) · starting-with-god 0.833 (n=18) · cru-10-basic-steps 0.714 (n=14).

The curation **resolved the pre-curation drop**: the pre-curation run on the _stale_ 20 cases scored recall@3 0.75 / recall@10 0.85 / coverage 0.746 — a stale-living-set artifact, not a retrieval regression. After re-reviewing the relevant maps, the 3 displaced misses (gospel/witnessing/prayer) all pass (rank 1/1/3). recall@10 0.938 vs slice-#2's 1.00 is the 2 honest misses below, not a regression.

**2 honest misses (not gamed):**

- `jf-skeptic-intolerant`: the "only way / intolerant" framing pulls the genuinely-relevant _uniqueness/deity_ cluster (5-key-teachings, did-jesus-claim-to-be-god, was-jesus-lord-liar-or-lunatic) ahead of the specific `is-christianity-intolerant` doc. Well-answered, expected doc out-ranked. Could extend the relevant set; left honest.
- `jf-believer-disciple-making`: vocabulary gap — "help someone _grow in faith_" retrieves evangelism/relationship content, not the `disciple-making` docs (which lean on the word "disciple" the persona phrasing avoided). A real retrieval limitation; guardrail-#1 working as intended.

**minScore 0.37 holds (FOLLOW-UP A re-confirmed @ 3 sources):** secular negatives (index funds / faucet / cricket) return nothing above cutoff; faith-adjacent Quran/Ramadan peeks to 0.389 (admitted by 0.37, cut by 0.4 — the weak-adjacent behavior the principle expects). No change.

**Negatives (cutoff calibration — kept out of qa-golden.yaml; eval.ts would miscount them as misses):**

- "What's the best way to invest in index funds for retirement?" → nothing ≥ 0.37
- "How do I fix a leaking kitchen faucet?" → nothing ≥ 0.37
- "What are the rules of cricket?" → nothing ≥ 0.37
- "What does the Quran teach about fasting during Ramadan?" → top 0.389 (faith-adjacent; below the positive cluster)

## Decisions made (this slice)

- 2026-05-26 — Source key is `jesusfilm-org` (matches jfa curation + our `cru-10-basic-steps` precedent), not the name-slug `jesus-film-project`.
- 2026-05-26 — Build the discovery crawler now (FOLLOW-UP F) rather than hand-listing a sub-scope. Operator-confirmed; jesusfilm.org is the named trigger source.
- 2026-05-26 — Parse sitemaps with the existing `node-html-parser` (sitemaps are trivial `<url><loc>` XML), **not** a new `fast-xml-parser` dep. Refines the earlier suggestion once we saw extract.ts already pulls node-html-parser.
- 2026-05-26 — Crawl budget: full crawl (maxPages 400, all ~351 /blog/ posts). Operator-chosen.
- 2026-05-26 — The Stage-4 pre-curation eval drop is a **stale living-relevant-set artifact, not a retrieval regression** (diagnosed: misses are displaced by valid jf answers). Fix is curation via `/golden`, per the documented LIVING-set workflow — not a retrieval/minScore change.

## Open question / blocker

- none — slice complete (all 4 stages green + evaluated).
- Optional refinements (not blockers): (a) extend `jf-skeptic-intolerant`'s relevant
  set to credit the uniqueness/deity docs the "only way" framing legitimately pulls;
  (b) `jf-believer-disciple-making` documents a real "grow in faith"↔"disciple"
  vocabulary gap — a candidate signal if hybrid/keyword search (FOLLOW-UP B) is taken up.

## Resume hint (for a cold start)

DONE. Slice #3 complete: discovery crawler (FOLLOW-UP F) built + fakes-tested;
jesusfilm-org acquired (349) → ingested (349 docs / 2114 chunks) → retrievable →
evaluated (32-case curated eval: recall@10 0.938, coverage 0.803, jf per-source
0.913). Next: operator's call to merge `slice/jesusfilm-org` → `main`, then
`/slice sightline-ministry` (rides the now-built discovery crawler). Branch: slice/jesusfilm-org.
