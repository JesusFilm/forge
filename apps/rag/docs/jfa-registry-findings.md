# Findings: jesusfilm-ai's source registry (how sources were really gathered)

_Captured 2026-05-25, during slice #2. **Read this before picking the next source
or deciding how to crawl one.** We hit two recurring forks — *discovery-crawl vs
hand-listed seeds*, and *Cloudflare-walled sources* — and this is the institutional
memory so we don't re-derive it each slice._

> **Forge migration note (2026-09-04):** this is historical reconnaissance, not
> a current source-status tracker or executable runbook. Use the Forge registry
> in `apps/rag/src/registry`, `docs/source-status.yaml`, and
> `docs/source-map.yaml` for current truth. The observations and hazards below
> remain useful provenance for those records.

> **Stance unchanged:** jfa is a **behavioral reference, not a port target**
> (STATUS, 2026-05-22). We learn what worked and reuse the _curation_ (the
> expensive human part — which URLs, which selectors, which sources block bots).
> We do **not** transplant jfa's files. Adopting its crawl-policy _shape_ is a
> real architecture decision, teed up below — not yet taken.

## Where the intel lives (jfa)

```
apps/api/src/sources/registry.ts                 ~20 source entries (the gold)
apps/api/src/sources/sync.ts                      registry → source_inventory DB rows
apps/api/src/sources/{everystudent,startingwithgod}-language-sites.json   multilingual sibling domains
apps/api/scripts/registry-check.js                no-network CI smoke test of allow/block policies
apps/api/src/ingest/{policy,robots,http-cache,scheduler}.ts   the ingestion foundation (we deferred robots + http-cache)
```

## Model 1 — discovery-crawl policy, not a hand-listed article set

Our slice #1 (Starting With God) hardcoded **40 exact article paths** in
`seedPaths`. jfa instead declares a _policy_ per source and lets a crawler
**discover** the article set:

| Field                                                                    | Role                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `seeds[]`                                                                | entry points — **frequently the `sitemap.xml` itself** + a few index/category pages, not every article |
| `allow[]`                                                                | regexes; a URL must match ≥1 to be kept (usually the host/scope)                                       |
| `block[]`                                                                | regexes to drop: `login\|donate\|cart\|account\|wp-admin\|feed\|*.pdf/jpg/... \|?utm_`                 |
| `articleHints[]`                                                         | regexes for "this is a content article, not nav/index"                                                 |
| `contentSelectors[]`                                                     | ordered CSS selectors for the main container (first match wins)                                        |
| `sitemaps[]`                                                             | explicit sitemap list (used by Sightline)                                                              |
| `maxPages`, `requestDelayMs`, `minContentLength`, `maxChunksPerDocument` | crawl limits                                                                                           |

So you curate **rules + a sitemap seed**, and discovery fills in the pages — the
only way the big corpora (GotQuestions ~1500, Sightline ~2500, FamilyLife ~15000)
are tractable. Our current code does **not** discover; it fetches exactly the
`seedPaths` listed. That's fine for small static sources, a dead end for large ones.

## Model 2 — one domain → many scoped source _keys_

A domain is **not** one source. cru.org is ~10 entries, each with a `scopePath`:

```
cru-about, cru-org (=/train-and-grow/), cru-10-basic-steps, cru-beginning-with-god,
cru-transferable-concepts, cru-classics, cru-pathways,
cru-oneness-in-diversity, cru-oneness-ethnic-cultural, cru-oneness-generational,
cru-compassionate-and-faithful
```

`getSourceForUrl(url)` routes a URL to the entry whose `scopePath` is the **longest
matching path prefix** (entries with no scope match the whole domain at length 0).
Each scope gets its own `defaultTags` / `defaultCategory` / `rights`. This is why
"do Cru" really means "do a chosen Cru _scope_" — and why slice #2 can be just
`cru-10-basic-steps` (12 curated URLs) without crawling all of cru.org.

## Trust + ingestion mode are first-class

- `trust`: `owned | partner | trusted | evaluating | blocked`
- `ingestionMode`: `html-scrape | api | manual | rss | blocked`
- `crawlableSources()` = `html-scrape` **and** has a `crawl` block. `blocked`/`manual`/`api`
  entries are registered for **rights/notes/routing** but never crawled.

## Per-source intel (reuse this curation)

| Key                       | Trust   | Mode        | Scale        | On-mission?                    | Notes / hazards                                                                                    |
| ------------------------- | ------- | ----------- | ------------ | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `gotquestions-org`        | trusted | html-scrape | ~1500        | **yes — strongest seeker-Q&A** | flat `content_<Topic>.html` index seeds; articleHints exclude indexes/top20                        |
| `jesusfilm-org`           | owned   | html-scrape | ~1200        | yes                            | resources/stories/blog/learn; `sitemap_index.xml` seed                                             |
| `sightline-ministry`      | partner | html-scrape | ~2500        | yes — apologetics              | explicit `sitemaps[]`; rich `.o-longform-content__content` selectors; skeptic/evidence             |
| `cru-org` (+ scopes)      | partner | html-scrape | bounded each | yes — discipleship/org         | **`cru-10-basic-steps` = 12 ready-made URLs** (← slice #2). cru.org content-reachable (probed 200) |
| `familylife-com`          | partner | html-scrape | ~15000       | yes — marriage/parenting       | WordPress VIP; `sitemaps.xml`                                                                      |
| `powertochange-com`       | partner | html-scrape | ~1200        | yes — discipleship/life-issues | sitemap-driven                                                                                     |
| `knowgod-com`             | partner | html-scrape | ~200         | yes — gospel tracts            | **Angular shell** (JS-rendered) — may need browser rendering                                       |
| `arclight-videos`         | owned   | **api**     | —            | media metadata                 | v2 API, not HTML; routes via jesusfilm-org                                                         |
| `joshua-project`          | trusted | **manual**  | —            | missions data                  | CSV import, not crawl                                                                              |
| `victorybeyondthecup-com` | owned   | html-scrape | ~120         | campaign                       | **Framer-rendered**; multilingual sitemaps                                                         |
| `victory-host-kit`        | owned   | manual      | ~14 files    | campaign                       | Google Drive archive (allow-listed file IDs)                                                       |
| `nextstep-is`             | partner | html-scrape | ~8           | **weak — campaign/tool**       | thin WordPress; invite/prayer/easter/world-cup landing pages                                       |
| `nextstep-support`        | partner | html-scrape | —            | **no — product docs**          | Help Scout; explicitly _not_ for spiritual/doctrinal answers                                       |
| `nextstep-football2026`   | partner | html-scrape | —            | seasonal                       | **own subdomain** `football2026.nextstep.is`; the canonical FOLLOW-UP E exclusion fixture          |
| `nextsteps-toolkit`       | owned   | manual      | —            | training                       | local-file import                                                                                  |
| `curated-references`      | trusted | manual      | —            | mixed                          | staged YouTube/article JSON                                                                        |
| `everystudent-com`        | partner | html-scrape | ~7 seeds     | yes — but **BLOCKED**          | see hazards below                                                                                  |
| `issuesiface-com`         | blocked | **blocked** | —            | —                              | placeholder only; unstable host (www 404, 403/challenge)                                           |

(Languages: `everystudent` has **51** sibling-language domains, `startingwithgod` **31**, in the JSON files. Deferred — English first.)

## Known hazards (we already paid to learn these)

- **Cloudflare / bot walls.** `everystudent-com`'s jfa entry says verbatim: _"Main
  site actively blocks bot traffic… returns 403 on many automated requests.
  Ingestion is via curated article lists, approved archives, or official exports."_
  Our 2026-05-25 probe confirmed it: homepage 200, **every content page 403 with a
  Cloudflare `challenge-platform` JS challenge** our plain undici fetcher can't pass
  (full record in `docs/slices/everystudent.md`). **jfa never cleanly solved this** —
  it relied on curated lists/archives/exports. Expect more of this; `cru.org`,
  `jesusfilm.org`, `nextstep.is`, `sightlineministry.org` all probed **clear** (200,
  no challenge), so it is source-specific, not systemic.
- **JS-rendered shells.** `knowgod-com` (Angular) and `victorybeyondthecup-com`
  (Framer) won't yield content to a plain HTML fetch — they need browser rendering
  or the underlying API.
- **Thin/marketing sites masquerading as content.** `nextstep-is` looked lean by
  homepage size but is ~8 product-marketing pages. **Lesson: probe a real _article_
  page + the sitemap, never just the homepage** — homepage-only recon gave false
  positives for both EveryStudent (reachability) and NextStep (richness).

## Two decisions deferred to "next time" (don't re-derive — decide these)

1. **Adopt jfa's discovery-crawl model?** The STATUS "generic crawler vs per-source"
   call (deferred until 2–3 sources reveal the pattern) is effectively **answered**:
   jfa's `seeds + allow + block + articleHints + contentSelectors + sitemaps` shape is
   the proven model and is required for any source above ~50 pages. Adopting it means
   extending our `CrawlPolicy` type + adding a discovery step to the Acquisition
   context (follow links from seeds; keep allow∧articleHints; drop block). **Trigger:
   the first large source (GotQuestions / Sightline / jesusfilm-org).** Until then,
   `cru-10-basic-steps` and other small curated scopes fit our current `seedPaths` code.
2. **Cloudflare-walled sources — what's the bypass?** Options, in rough order of
   cost: (a) curated archives / official exports (jfa's posture); (b) a Playwright/
   headless `Fetcher` adapter behind the existing port (executes the JS challenge —
   heavy dep, may still lose to a managed challenge); (c) authorized feed/API from the
   owner (EveryStudent is a Cru property). **Decide when a _walled_ source becomes
   required coverage** — right now only EveryStudent (1 of the short list) is walled,
   so it stays `blocked` and we move on.

## What we were doing then (slice #2)

`cru-10-basic-steps` — 12 ready-made curated URLs from jfa, on our **current**
`seedPaths` model (no crawler rebuild). Cru is content-reachable. This proves the
2nd source end-to-end and unblocks per-source eval + FOLLOW-UP E. The two decisions
above are explicitly **not** taken in this slice.
