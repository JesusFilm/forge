# Slice: EveryStudent — English (everystudent)

_Branch: `slice/everystudent` · Started: 2026-05-25 (blocked) · Restarted: 2026-07-24 · Status: done_

<!-- Status: in-progress | blocked | done | deferred (mirrors the RowStatus contract) -->

## Goal (architecture altitude)

Get **everystudent.com (English)** queryable end-to-end: acquire → ingest →
retrieve → eval. This is the first slice to acquire a **walled** source — the
per-source work is a registry entry plus driving the existing pipeline, with
`fetchStrategy: "firecrawl"` (ADR-0012) as the only new thing under it.

**Scope is one domain.** ADR-0006 makes one domain = one source key, so the
Arabic (`everyarabstudent.com`) and French (`questions2vie.com`) banners are
**separate keys and separate later slices**, not part of this one. Planned in
[#112](https://github.com/JesusFilm/jesusfilm-rag/issues/112).

## Language plan

1. **Domains → source keys.** everystudent.com → `everystudent` (this slice) ·
   everyarabstudent.com → `everystudent-ar` · questions2vie.com →
   `everystudent-fr`. Three domains, three keys, three slices — the
   `thelife` / `thelife-fr` / `thelife-zh` pattern. Not a judgment call.
2. **Declared language set: `["en"]`.** All 167 mapped URLs on this domain are
   English (#114); the international siblings live on their own domains, and
   `/menus/intl.html` — the page that links out to them — is blocked as an
   index page. This is the _expected_ set, a cross-check only.
3. **Language is detected per document at ingest** from the content
   (`ingestion/detect-language.ts`), never from `languages[0]`, the URL path, or
   `<html lang>` (architecture invariant 6, ADR-0006 / #68).

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents

- [x] Correct the stale `blocked — needs a JS-capable fetcher` claims in this file, `sources.md`, and `source-status.yaml` (all predate #109); document the conditional `FIRECRAWL_API_KEY` in `.env.example`. <!-- sha: efcafd5 + this -->
- [x] **Cost-guard probe (3 credits, 1016 → 1013).** Both assumptions were wrong, in opposite directions — see "Decisions made". Rate re-confirmed at **1 credit/page** (3 pages, 3 credits). <!-- sha: 0fde91a -->
- [x] Add the `everystudent` `SourceEntry`: `fetchStrategy: "firecrawl"`, hand-listed `seedPaths` (**117**, lifted from #114 — **never re-map**), `.content4`/`.content4b` selectors + a chrome-tuned strip list. Wired into `SOURCES`; tests split into `everystudent.test.ts` (the §5.5 300-line cap, following `cru.test.ts`). <!-- sha: 0fde91a -->
- [x] Live `pnpm acquire --source everystudent` → **117/117 staged, zero skips**, 117 credits (1013 → 896) at a measured **1.00 cr/page**. All status 200, 0 null titles, 117 distinct URLs. Chars min 507 / avg 7,203 / max 22,711. <!-- sha: 0673cf9 -->

### 2. Ingest → corpus tables

- [x] Live `pnpm index --source everystudent` → **117 docs / 550 chunks / 550 embeddings** (`qwen/qwen3-embedding-8b`, 1:1, 0 chunk_count mismatches); idempotent re-run drains 0. Language detected per document: **108 `en` · 9 `null`** — see the Stage 2 evidence below. <!-- sha: 99e9696 -->

### 3. Retrieve → ranked results

- [x] Live `pnpm query` → everystudent ranks **1–2 on its own seeker topics**, cross-source health preserved, `minScore 0.37` holds at 9 sources. No code changes. See the Stage 3 evidence below. <!-- sha: b988d0d -->

### 4. Eval + spot-check

- [x] `/golden` content-grounded Stage 4 (first agent-driven run, v4): probed all 68 en cases + drafted 10 native cases; **3-lens judge panel over 230 (case, doc) pairs / 160 whole documents**; both axes gated ≥ 0.75 in code; operator gated the fork (exclude the 9 null docs), the spend, and the write. **85 credits approved → qa-golden.yaml 96 → 106 cases** (31 gap-fixes on 14 prior cases + 10 everystudent-native cases, 54 multi-source credits). <!-- sha: 12bc5b6 + this -->
- [x] Whole-corpus `pnpm eval` @ 106 cases: recall@3 **0.953** · recall@10 **1.000** · coverage **0.703** · MRR 0.828 · P@1 0.698; everystudent n=22 recall 0.818 / coverage 0.739; 4 negatives re-confirm **minScore 0.37**. `eval/results-2026-07-24.md` is the post-curation run (results files are gitignored point-in-time artifacts; the durable pre-curation baseline is this file's "Stage 4 pre-curation baseline" section, committed at `9f53b36`). <!-- sha: 12bc5b6 + this -->
- [x] Spot-check: 9 of 10 native cases rank 1 (astrology rank 2); negatives 0-hit or the 0.37–0.51 faith-adjacent band. Recorded in `sources.md` (→ Evaluated). <!-- sha: 12bc5b6 + this -->

**Out of this slice:** prod promotion via the #115 bulk-copy path (acquire local
→ ingest + eval local → copy `raw_documents` with `id`/`ingested_at` omitted →
`index:production`). It happens _after_ Stage 4, on a separate operator
go-ahead. **Never run `acquire:production` for this source** — that re-pays
Firecrawl.

## Decisions made (this slice)

- 2026-05-25 — Source = **EveryStudent**, leanest remaining of the short list. _(Superseded in scope: the slice now covers the English domain only.)_
- 2026-05-25 — **Seed sourcing = hand-curate.** Still true, for a new reason: #114 already paid to enumerate the site via `/v2/map`, so re-discovering it would cost credits for nothing.
- 2026-07-24 — **Hand-listed `seedPaths`, not a sitemap discovery crawl.** `/sitemap.xml` is 403 to plain HTTP, and the 167-URL inventory from #114 is preserved. Discovery through Firecrawl would re-pay for knowledge we already hold.
- 2026-07-24 — **149 seeds from the 167 mapped.** Dropped: the homepage, `/contact.php`, `/donate`, `/quiz`, `/sitemap.html`, the bare `/podcasts` index, 10 `/menus/*` index pages, and `/features/search.html` + `/podcasts/search.html`. Kept `/videos/jobsearch.html` (a real article that only _looks_ like a search page). No robots-disallowed path appears in the mapped set.
- 2026-07-24 — **`/podcasts/*` (32) DROPPED as duplicates — the probe's real finding.** The worry was that podcasts/videos were media stubs. They are not: both carry full transcripts. But a `/podcasts/` page is the _read-aloud of an article that already exists_ — `/podcasts/loneliness.html` is "LISTEN TO ARTICLE: What to Do with Loneliness" and shares **93.8% of its 12-word shingles** with `/wires/loneliness.html`. 18 of the 32 share an exact article slug; most of the rest are renames (`whowas` ↔ `who-was-jesus`, `isthere` ↔ `is-there-a-god`, `political-views` ↔ `the-politics-of-jesus`). Keeping them would have spent 32 credits to add 32 near-duplicate documents that the doc-level content hash cannot collapse — the same near-duplicate problem slice #4 hit with Sightline's annually-republished devotionals. **149 → 117 seeds.**
- 2026-07-24 — **`/videos/*` (17) KEPT.** Genuine unique testimony transcripts, not stubs: `/videos/lacey-sturm.html` is a ~4.1k-char first-person account with no article twin. ⚠️ The few with a `-video` suffix (`know-God-video`, `kindness-of-god-video`) may echo their article counterpart — not probed; check at Stage 4.
- 2026-07-24 — **Strip list tuned beyond boilerplate.** `sitelevel_noindex` (the site's own no-index wrapper around share links + related-article cards) and `.fccell` (the "FEATURE CLOSE" CTA table — "I just asked Jesus into my life…" — appended verbatim to every article). Measured: −359 chars on an article, −275 on a video, articles now ending cleanly on their own last line. This is the slice-#2 accordion-TOC citation-quality problem fixed at the source rather than discovered at eval.
- 2026-07-24 — **No `block` array.** It would be dead config: `block` filters _discovered_ URLs and a seed-only source discovers none. robots.txt compliance is enforced by a test over `seedPaths` instead.
- 2026-07-24 — **`lang:sweep` is periodic maintenance, NOT a per-slice step — the 9 nulls stay (operator).** A mislabel (or an honest blank) is accepted as the normal cost of never guessing; the sweep runs occasionally, when the corpus-wide null count grows large enough to be worth an LLM pass. It is explicitly not part of closing a slice. **Consequence to hold in mind at Stage 4:** these 9 docs are invisible to `language:"en"`-scoped queries, so keep everystudent eval cases unscoped by language (the source is monolingual, so nothing needs the filter) — otherwise the eval measures the gate, not retrieval.
- 2026-07-24 — **Funded from the personal Firecrawl account** (Free tier; 1,016 credits confirmed live, cycle ends 2026-08-21). ~117 credits for this domain (after the podcast drop), ~292–338 for all three — roughly 3× headroom, no upgrade (#116). Prod resolves its key via docker secret pull, never `.env`.
- 2026-07-24 — **The 9 null-language docs are EXCLUDED from all eval credits (operator, at the Stage-4 fork).** The Stage-2 plan ("keep everystudent cases unscoped") turned out mechanically impossible: `caseLanguage()` has no unscoped pin — any case whose relevant sources intersect to `{en}` runs `language:"en"`-scoped, so crediting a null doc bakes in a permanently unreturnable expectation. Options were sweep-now / exclude / credit-anyway; operator chose **exclude**, honoring the "sweep is periodic maintenance" decision. Measured cost: `es-seeker-loneliness` credits **zero** everystudent docs (the real answer, `/wires/loneliness.html`, is null), and the flagship apologetics docs stay out of the answer keys until a future `lang:sweep` + re-review.
- 2026-07-24 — **Stage-4 candidate rules (operator-approved):** Part A = everystudent-scoped deep probe, score ≥ 0.58 ∪ already-in-top-10, nulls excluded → 107 pairs; Part B = whole-corpus en-scoped top-20 ≥ 0.55 + es-scoped ≥ 0.5 → 122 pairs. One surgical top-up (marcia-montenegro × astrology) after the panel exposed `/faq/astrology.html` as a redirect stub whose answer doc sat 0.002 under the floor.
- 2026-07-24 — **Judge panel: 141 of 230 pairs (61%) rejected as sound-but-off-question** — the Guardrail-#6 tripwire, a higher rate than slice #7's 48%. **0 soundness failures** (lowest mean 0.68, on a rejected pair; no #78-grade findings). **0 escalations** — max panel spread 0.20 across 690 relevance scores, the known single-base-model convergence caveat; agreement was not read as corroboration.

## Stage 1 evidence (Acquire — GREEN 2026-07-24)

`raw_documents` for `everystudent`: **117 rows / 117 distinct canonical_url**,
all status 200, 0 null titles. Content chars min 507 · avg 7,203 · max 22,711.
Spot-read across three page shapes returned real article prose, no Cloudflare
interstitial. Cost: **117 credits, exactly 1.00/page** (1,013 → 896) — the
tightened-wall risk did not materialise.

| Section         | Docs | Avg chars |
| --------------- | ---: | --------: |
| `/wires/`       |   47 |     8,371 |
| `/features/`    |   20 |    15,338 |
| `/videos/`      |   17 |     3,195 |
| `/forum/`       |   14 |     3,499 |
| `/faq/`         |   13 |   **702** |
| `/journeys/`    |    4 |     6,660 |
| 2 root articles |    2 |     1,735 |

**Two things to carry into later stages:**

1. **`/faq/*` is a thin band** — 13 docs averaging 702 chars (507 min). They
   clear `minContentLength: 250` and are genuine Q&A answers, but each will
   likely chunk to 1. Watch whether they earn top-10 slots at Stage 4 or just
   dilute; do **not** pre-emptively drop them (slice #6's `/equip/` retention
   decision was made on eval evidence, not a guess).
2. **A little chrome survives extraction** — a leading breadcrumb ("Spiritual Qs
   / FAQ", "Find God"), a "Listen to article | Share this article" line, and a
   `▶` on video pages. All are bare `<p>`/text with no class to target, so no
   selector can strip them; they are a few words at the head of chunk 0. Noted,
   not chased — re-crawling 117 pages to shave a breadcrumb is not worth 117
   credits.

## Stage 2 evidence (Ingest — GREEN 2026-07-24)

**117 docs / 550 chunks / 550 embeddings** (`qwen/qwen3-embedding-8b`, 1536d) —
perfect 1:1, 0 `chunk_count` mismatches, idempotent re-run drains 0. Corpus now
**9 sources / 11,554 docs / 33,654 chunks**. 76 transient OpenRouter embed
timeouts all recovered inside the retry policy (#64); zero data loss.

Chunks/doc avg 4.70 (min 1, max 15):

| Section         | Docs | Chunks |      Avg |
| --------------- | ---: | -----: | -------: |
| `/wires/`       |   47 |    251 |     5.34 |
| `/features/`    |   20 |    192 |     9.60 |
| `/videos/`      |   17 |     39 |     2.29 |
| `/forum/`       |   14 |     35 |     2.50 |
| `/journeys/`    |    4 |     17 |     4.25 |
| `/faq/`         |   13 | **13** | **1.00** |
| 2 root articles |    2 |      3 |     1.50 |

The Stage-1 prediction held exactly: **every `/faq/` doc chunks to 1.**

### ⚠️ Finding — 9 docs unclassified, and they are the site's _best_ articles

`documents.language`: **108 `en`, 9 `null`** (7.7%). Counter-intuitively the 9
are not the thin ones — they are among the **largest** (5.7k–26k chars) and
include some of EveryStudent's flagship pieces: `/features/bible.html`,
`/features/faith.html` (Beyond Blind Faith), `/wires/atheist.html` (How an
Atheist Found God), `/wires/who-is-god.html`, `/wires/loneliness.html`,
`/wires/jesus-in-islam.html`, `/forum/trinity.html`,
`/features/martin-luther-king-jr.html`, `/features/whypick.html`.

**Cause: the tinyld confidence gate, not the content.** All nine are plainly
clean English prose; re-running the detector over their leading 2,000 chars
returns `en` as the top candidate every time, at **0.605–0.771** — clustered
just under `CONFIDENCE_GATE = 0.75` — with a spurious `hi` runner-up (0.12–0.29)
that is a tinyld quirk, not anything in the text. `DETECTION_FLOOR_CHARS` is not
involved (all are far above 500). So this is ADR-0007 working as designed: a
`null` is an honest "not confidently detected", never a guess.

**Why it still matters:** a `null`-language doc is excluded from
`language:"en"` filtered searches (SQL three-valued logic) while staying
retrievable unfiltered. Nine of this source's strongest apologetics articles are
currently invisible to any language-scoped query — which is exactly the shape of
query Stage 4 eval uses.

**Context:** the rate itself is unremarkable — cru ingested at 7.8% null. But
**every other source in the local corpus now reads 0.0%**, because the ADR-0009
LLM sweep (`pnpm lang:sweep`, PRs #92/#95/#96) drained them 190 → 0.
everystudent is simply the first source ingested since that sweep, so it is the
lone outlier and the remedy is an existing, proven tool.

## Stage 3 evidence (Retrieve — GREEN 2026-07-24)

Spot-retrieval against the 9-source space via `pnpm query`. **No code changes** —
the Retrieval context absorbed a ninth source unmodified.

**everystudent owns its axis, without burying anyone.**

- _"how do I deal with loneliness?"_ → everystudent `/wires/loneliness.html`
  **rank 1 @ 0.723**, then cru 0.696, thelife 0.656 + 0.653. A clean win with the
  incumbents still present.
- _"how can an atheist come to believe in God?"_ → everystudent takes **ranks 1
  and 2** (0.709 / 0.701) with cru at 3 — the source's strongest genre.
- _"is there a God?"_ → cru 0.656, everystudent 0.653, everystudent 0.631,
  sightline 0.611. Four-way spread across three sources; nothing crowded out.

**Cross-source health preserved at 9 sources.** No query returned an
everystudent-only page; cru, sightline and thelife all still surface where they
legitimately answer.

**`minScore 0.37` holds.** _"how to fix a leaking kitchen faucet"_ → **0 hits**.
_"best index funds for retirement"_ → 1 hit @ 0.384, a Chinese thelife article
about investing for children — a genuine topical match sitting just above the
floor, the same faith-adjacent 0.38–0.44 band prior slices recorded. Not a
cutoff failure.

**Checked, and NOT a problem:** cru's _"Is There a God?"_ (rank 1) and
everystudent's _"Is There a God? Six Reasons…"_ (rank 2) share a title and an
author (Marilyn Adamson — EveryStudent's founder), which looked like a
cross-source duplicate. It is not: the cru page is a **234-word stub** (223
12-word shingles vs everystudent's 3,155) and the two share only **8.1%** of
their text. Worth a Stage-4 look for a different reason — the stub out-ranks the
full article that actually answers the question, by 0.003.

**The null-language consequence, measured.** Unfiltered, `/wires/atheist.html`
("How an Atheist Found God") is **rank 1 @ 0.709** for the atheist query. Adding
`--language en` **removes it entirely** — the single best answer disappears and
everything below shifts up. This is the concrete cost of the 9 unclassified
docs, and the reason it must not be mistaken for a retrieval bug at Stage 4.

## Stage 4 pre-curation baseline (2026-07-24)

`pnpm eval` @ **96 cases / 9 sources**, `eval/results-2026-07-24.md`.
everystudent shows **n=0** — no case credits it yet; that is the curation work.

| Metric    | Slice #7 close | Pre-curation now |
| --------- | -------------- | ---------------- |
| recall@3  | 0.938          | **0.938**        |
| recall@10 | 1.000          | **1.000**        |
| coverage  | 0.689          | **0.681**        |
| MRR       | 0.814          | 0.800            |
| P@1       | 0.677          | 0.656            |

**The near-absence of a dip is itself the finding.** Every prior slice took a
real pre-curation hit from the living-relevant-set artifact (jesusfilm
recall@10 0.85; thelife recall@3 0.71). Here it is essentially flat, because 117
docs against 11,437 barely perturbs the ranking. everystudent is a small, dense
source rather than a bulk one — so expect Stage 4's gains to come from
**crediting genuinely-relevant everystudent docs on existing cases**, not from
repairing a regression.

**⚠️ `starting-with-god` is the weakest source: recall 0.409 / coverage 0.318.**
Slice #1's founding source keeps being displaced from top-10 by larger sources on
shared topics — the FOLLOW-UP I ([#15](https://github.com/JesusFilm/jesusfilm-rag/issues/15))
`maxPerSource`/MMR pattern, sharpening since slice #4. everystudent competes on
exactly swg's subject matter (basic gospel / seeker questions), so watch this
number after curation: a further drop is mechanism, not content failure.

**Fixed during this stage — a pre-existing silent bug.** The run reported one
`(unscoped)` case, meaning it searched the whole multilingual corpus instead of
being language-scoped. `tl-newcomer-decision`'s only relevant source is
`thelife`, which declares `["en", "fr"]`, so `caseLanguage()` intersected to two
languages and derived none. All five of its relevant docs are `en`; pinned
`language: "en"`. **en n=67 + 1 unscoped → en n=68, 0 unscoped.** Dates to slice
#5 and only became ambiguous once thelife declared French — exactly the trap the
`/slice` playbook records after slice #7.

**Eval aborts on a transient OpenRouter blip — worth a follow-up.** The first
run died at case 18 of 96 (`AbortError`) because `pnpm eval` inherits the
_serving_ query-embed policy from [#103](https://github.com/JesusFilm/jesusfilm-rag/pull/103):
`QUERY_EMBED_MAX_ATTEMPTS=2`, `QUERY_EMBED_TIMEOUT_MS=4000`. Fail-fast is right
when a user waits on a search; for a 96-case batch it discards all completed work
on one blip. Both are env-configurable, so the re-runs used
`QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000` — **no code change**.
A batch context borrowing an interactive latency budget looks like a real gap;
filed at slice close as [#118](https://github.com/JesusFilm/jesusfilm-rag/issues/118).

## Stage 4 evidence (Eval — GREEN 2026-07-24)

**The pre-curation prediction held exactly:** gains came from crediting, not
regression repair. Post-curation @ **106 cases / 9 sources** (`pnpm eval`,
`eval/results-2026-07-24.md`):

| Metric    | Pre-curation | Post-curation |
| --------- | ------------ | ------------- |
| recall@3  | 0.938        | **0.953**     |
| recall@10 | 1.000        | **1.000**     |
| coverage  | 0.681        | **0.703**     |
| MRR       | 0.800        | 0.828         |
| P@1       | 0.656        | 0.698         |

**everystudent: n=0 → n=22, recall 0.818 / coverage 0.739.** All 10 native
cases pass — 9 at rank 1, astrology at rank 2. The 4 everystudent recall
misses are deep credits displaced by cross-source competition on shared
topics (the FOLLOW-UP I mechanism, not a content failure).

**Every prior en source moved UP, none down** (the slice-#5/#6 pattern
re-confirmed at 9 sources): cru 0.828→0.861 recall / 0.576→0.636 coverage ·
thelife 0.857→0.878 / 0.593→0.634 · sightline 0.756→0.783 / 0.541→0.563 ·
**swg 0.409→0.458 / 0.318→0.375** — the feared everystudent-displaces-swg
drop did not materialize; two swg docs (`/new-life/jesus.html`,
`/new-life/connect.html`) were newly credited on everystudent-native cases,
a slice-#1 curation gap closed as a side-effect. jf unchanged. Per-language:
en n=78 coverage 0.644 (was 0.603), es/fr/zh untouched, **0 unscoped**.

**minScore 0.37 holds at 9 sources.** Negatives: _"best exercises for lower
back pain"_ and _"what programming language should I learn first?"_ → **0
hits**; _"how do I train my puppy to stop biting?"_ → 3 hits 0.373–0.442
(familylife child-discipline adjacency); _"how do I write a resume with no
work experience?"_ → 5 hits 0.425–**0.505** (college/career docs). That 0.505
is the closest a negative has come to the positive band (≥0.55) — the
faith-adjacent band creeps up as life-practical content grows; watch it at
the next source.

**Curation-quality findings:**

- **`/faq/*` stubs judged substanceless, as Stage 1 predicted** — the two
  probed (`/faq/astrology.html`, `/faq/loneliness.html`) pose the question
  and defer to a `/wires/` article; the panel rejected both as answers
  (rel 0.47/0.57) while the `/wires/` targets were approved where labeled.
- **`/faq/LGBTQ.html` REJECTED** (rel 0.45 / sound 0.73) despite being the
  engine's rank-1 hit on `swg-skeptic-gods-love` — a deliberate, recorded
  uncredited-top-hit; do not "fix" it by crediting at the next re-review
  without re-judging.
- `/journeys/then.html` (life after death) missed the Part-B candidate floor
  by 0.02 for `es-seeker-fear-of-death` — a re-review candidate next slice.
- The judge rubric used is preserved at
  `docs/prompt-samples/2026-07-24-jfrag-slice8-judge-rubric.md`.

### Negatives (cutoff calibration — live in this file, never qa-golden.yaml)

1. "how do I train my puppy to stop biting?"
2. "how do I write a resume with no work experience?"
3. "best exercises for lower back pain"
4. "what programming language should I learn first?"

## Open question / blocker

- none open. _(The Stage-2 sweep question was DECIDED — see "Decisions made".)_

## Known caveat — not a blocker for this slice

`pnpm test` is **425/426** on this machine. The failure is
`tests/retrieval.integration.test.ts › "language filter must not starve"` — the
FOLLOW-UP J [#17](https://github.com/JesusFilm/jesusfilm-rag/issues/17) /
[#75](https://github.com/JesusFilm/jesusfilm-rag/issues/75) canary, which
asserts that a language-filtered search still finds in-language rows hidden
behind a wall of out-of-language neighbours.

It is **data-dependent, not a code defect**: the same test passes 5/5 against an
empty scratch database and is green in CI (fresh DB), but fails against this
machine's 11,437-doc / 33,104-chunk local corpus. Slice #6 recorded the same
canary firing at 23.5k chunks; the corpus has since grown to 33k.

**Why it is noted here rather than fixed here:** it is pre-existing, unrelated to
acquiring a source, and English-only work cannot trip the failure mode. **It must
be investigated before the `everystudent-ar` / `everystudent-fr` slices**, which
are exactly the small-language-drowning-in-English case the canary exists to
warn about (30,136 `en` chunks vs 460 `zh` today). Open question when we get
there: is the fixture's cosine-0.99 cluster an artifact no real query produces,
or a real ceiling on rare-language retrieval?

**This slice's gate is therefore "green apart from the #17 canary."**

## History — why this slice was blocked for two months

Blocked 2026-05-25 at Stage 1: everystudent.com serves a Cloudflare JS managed
challenge, and the plain HTTP fetcher (undici, no JS engine) cannot earn the
`cf_clearance` cookie. At the time the homepage returned 200 while every content
path returned 403; the site has since tightened, and **the homepage and
`/sitemap.xml` are now 403 too** — only `robots.txt` answers plain HTTP.

Nothing about the wall got easier. What changed is our side: ADR-0012 / #109
added Firecrawl as an opt-in per-source fetch strategy, and #114 verified the
existing `FirecrawlFetcher` clears all three EveryStudent domains **unmodified**.
The route from wall to plan is mapped in
[#112](https://github.com/JesusFilm/jesusfilm-rag/issues/112).

⚠️ **Detection lesson (ADR-0012, re-confirmed by #114):** do **not** classify a
wall by the presence of the `challenge-platform` script — Cloudflare injects it
into _successful_ responses too, so it false-positives on CF-fronted-but-served
sources like thelife and cru. Use `attention required` /
`cf-browser-verification` / `just a moment` plus the status code.

## Prod promotion (2026-07-24) — DONE via the #115 bulk-copy path

everystudent is the **first source promoted to prod through `copy-raws.sh`**
(the walled-source route; `acquire:production` was deliberately NOT run — it
would re-pay Firecrawl). Mechanism + ops writeup: `docs/ops/copy-raws.md`; the
5th-stage handoff now lives in the slice skill (v10).

Sequence run against prod (`zephyr.proxy.rlwy.net`):

1. **Copy** — `copy-raws.sh --source everystudent` copied **117 rows** local→prod.
   Verified identical by a deterministic ordered row-level digest over all 11
   copied columns — `md5(string_agg(md5(row) ORDER BY canonical_url))` returned
   `867068cb…57c6` on both local and prod (117 rows), i.e. row-for-row equality,
   not merely matching aggregate totals. Rows landed `ingested_at IS NULL` (the
   gotcha-fix — `id`/`ingested_at` omitted so prod regenerates the uuid and
   leaves the row drainable).
2. **Embed** — `index:production --source everystudent` drained all 117 pending
   → **117 docs / 550 chunks / 550 embeddings**, an exact match of the local
   corpus. (OpenRouter's embed endpoint was slow that day — every batch timed out
   once then succeeded on retry; the patient corpus-embed policy rode it out.)
3. **Certify** — `eval:production --source everystudent`: recall@10 **0.955**,
   coverage 0.628; everystudent n=22 **recall 0.727 / coverage 0.648**, native
   `es-*` cases mostly rank 1 (only `es-newcomer-astrology` missed). Record:
   `eval/results-2026-07-24-everystudent-keep.md`.
   - The ~0.09 recall gap vs this slice's local 0.818 is **corpus drift, not a
     promotion defect**: prod carried ~40 more docs across thelife (+30),
     sightline (+9), jf-org (+1) than the local corpus at run time, and those
     extra neighbours compete in the shared cases. everystudent's own content is
     identical on both sides.
   - `eval:production` needed `QUERY_EMBED_MAX_ATTEMPTS=10 QUERY_EMBED_TIMEOUT_MS=15000`
     to finish — the default fast-fail query-embed policy (#118) aborted the batch
     on the first timeout during the provider-slow spell.

**ADR checkpoint (from #115):** the bulk-copy path has now been run once, which
was the condition for revisiting whether it earns an ADR. That call is now
unblocked (deferred within this PR; not raised here).

## Resume hint (for a cold start)

**SLICE COMPLETE + PROMOTED TO PROD 2026-07-24.** everystudent is queryable and
evaluated in the 9-source space (106 golden cases) AND live in the prod corpus
(117 docs / 550 chunks). Nothing to resume. Remaining operator decisions:
(1) ~~merge~~ + ~~prod promotion~~ **DONE** (see "Prod promotion" above);
(2) the queued `everystudent-ar` / `everystudent-fr` slices, both **gated on the
`#17`/`#75` canary investigation**; (3) a future `lang:sweep` + re-review to
bring the 9 excluded null-language docs (incl. `/wires/loneliness.html`,
`/wires/atheist.html`) into the answer keys. Last verify: green apart from the
`#17` canary @ 2026-07-24. Branch: slice/everystudent (merged); promotion on
`ops/copy-raws`.
