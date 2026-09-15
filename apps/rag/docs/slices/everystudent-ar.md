# Slice: EveryStudent — Arabic (everystudent-ar)

_Branch: `slice/everystudent-ar` · Started: 2026-07-25 · Status: done_

<!-- Status: in-progress | blocked | done | deferred (mirrors the RowStatus contract) -->

## Goal (architecture altitude)

Get EveryStudent's **Arabic** banner (everyarabstudent.com) queryable end-to-end:
acquire → ingest → retrieve → spot-check. This is slice #9, the **second walled
source** (Firecrawl, ADR-0012) and the **first Arabic content in the corpus** —
so it is also the first real test of rare-language retrieval since the #17/#75
mechanism was verified.

Scope is the Arabic domain only. `everystudent-fr` (questions2vie.com) is a
separate key and a later slice (ADR-0006, #112).

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 0. Unblock the gate (pre-slice)

- [x] Repair the #17/#75 canary — STATUS.md gated this slice on it <!-- sha: 55bfd7f -->

### 1. Acquire → raw_documents

- [x] Register `everystudent-ar` (walled, seed-only, 68 seeds) + fakes-only tests <!-- sha: 04f2d20 -->
- [x] Live Firecrawl crawl of the 68 seeds → `raw_documents` — **67/68 staged** <!-- sha: 69573a5 -->
- [x] Verify: row count, Arabic article prose (not nav/boilerplate), selectors bound <!-- sha: 69573a5 -->

**Stage 1 evidence (2026-07-25).** Staged **67 of 68** seeds; the single skip is
`/v/video7.html` (status 200, too-thin — a genuine media stub under
`minContentLength: 250`). 67 rows / 67 distinct `canonical_url` / 0 null-or-empty
titles / 0 non-200 / 0 already-ingested. Chars min 1,239 · avg 6,442 · max
23,906. Sections: **`/a/` 61** (avg 6,806 ch) · **`/v/` 4** (3,278) · **root 2**
(1,661).

**Cost: exactly 68 credits at exactly 1.00 cr/page** (896 → 828). The
tightened-wall risk (5 cr/page, ~340 total) did not materialise — measured live
at 1.10 cr/page over the first 10 pages and settling to 1.00 over all 68.

**Extraction verified** on `/a/answer.html`: a short breadcrumb ("معرفة الله"),
then title, subtitle, then clean article prose, closing on genuine Scripture
footnotes (1 John 5:14, Isaiah 59:1-2, …). `.content4` DOES bind on this host —
#112's shared-template claim holds. Residual chrome is a trailing "شارك مع أخرين"
("Share with others"), a few words at the tail — the same class as the English
sibling's leftover, noted and not re-crawled.

**`/john.html` (1,473 ch) and `/pack.html` (1,849 ch) both cleared
`minContentLength`** and are kept — the provisional call at unpack resolved in
their favour without a wasted credit.

**Language pre-flight (offline, free, before ingest):** `decideLanguage` over all
67 staged bodies predicts **65 `ar` / 2 `null`**, and **0 out-of-declared-set
warnings** — the `languages: ["ar"]` declaration is correct. The 2 nulls are both
`/v/` testimony pages, NOT flagship articles:

- `/v/gods-help.html` → `ar` at **0.718**, just under the 0.75 gate;
- `/v/personally.html` → **`ur` at 0.716** — Urdu shares Arabic script, so this
  is script confusion rather than a content problem.
  Null rate **3.0%**, well under English's 7.7%, and the unpack-time prediction
  (Arabic script is largely unambiguous to tinyld) held. Per standing policy these
  two are **excluded from the eval** and otherwise left alone — no sweep, nothing
  to fix; the dashboard's null count is the record.

### 2. Ingest → corpus tables

- [x] Drain `raw_documents` → documents / chunks / chunk_embeddings (qwen3) <!-- sha: 4219cb5 -->
- [x] Verify: 1:1 counts, `documents.language = 'ar'` (invariant 6), idempotent re-run <!-- sha: 4219cb5 -->
- [x] Report the null-language count as evidence (expected: 2) — no sweep, no fix <!-- sha: 4219cb5 -->

**Stage 2 evidence (2026-07-25).** Drained all **67 pending → 67 docs / 283
chunks / 283 embeddings** (`qwen/qwen3-embedding-8b`, 1536d) — perfect 1:1, **0
`chunk_count` mismatches**, 67 distinct `canonical_url`, single embedding model.
Chunks/doc avg 4.22 (min 1, max 16). By section: **`/a/` 61 docs / 272 chunks**
(avg 4.46) · **`/v/` 4 / 9** (2.25) · **root 2 / 2** (1.00). Idempotent re-run
drains **0**. **10 transient OpenRouter embed timeouts, all recovered inside the
retry policy** (#64, same as slice #8) — longest chain was 3 attempts; no doc
lost.

**Language (invariant 6) — the offline pre-flight held exactly: 65 `ar` / 2
`null`.** The two nulls are precisely the two predicted `/v/` testimony pages
(`/v/gods-help.html`, `/v/personally.html`) — no new surprises at ingest. This is
the **first Arabic in the corpus** and per-document detection labelled it
correctly off the content, not the URL path or `<html lang>`. Null rate **3.0%**
vs English's 7.7%. Per standing policy these two are excluded from the eval,
left alone, and the dashboard's null count is the record — no sweep.

**Extraction spot-read** (`/a/answer.html`, `ar`): chunk 0 opens with the short
breadcrumb "معرفة الله" then the title "هل يستجيب اللـه لصلواتنا؟" and real
article prose; chunk 2 is mid-body carrying Scripture footnote markers. Genuine
article text, not nav.

**Corpus now: 10 sources / 11,621 docs / 33,937 chunks** (11 null-language docs
total — 9 everystudent en + these 2).

**Latent finding (NOT on the live path, not this slice's to fix):** `chunks.search_tsv`
is `to_tsvector('english', text)` and `keywordSearch` hardcodes
`websearch_to_tsquery('english', …)`. Arabic (and the existing `zh`) get no
useful stemming there. **`keywordSearch` has no caller in the retrieval context**
— the Retriever is pure vector search (invariant 5) — so nothing on the live path
is affected. It only becomes real if hybrid retrieval is ever wired; noted here
so that work starts informed. Predates this slice (`thelife-zh` already sits in
the same tsvector).

### 3. Retrieve → ranked results

- [x] An Arabic query returns ranked, cited hits from this source <!-- sha: ee60ecd -->
- [x] `language:"ar"` returns ONLY Arabic; minScore 0.37 re-checked at 10 sources <!-- sha: e1c9159 -->

**Stage 3a evidence (2026-07-25) — Arabic is retrievable, and the space is
genuinely cross-lingual.** Three real Arabic questions against the **whole
10-source corpus**, no filters, `topK=5 minScore=0.37`, no code changes:

| Question (ar)                              | Top everystudent-ar hit | Score / rank  |
| ------------------------------------------ | ----------------------- | ------------- |
| من هو يسوع؟ (Who is Jesus?)                | `/a/isjesus.html`       | 0.609 @ **2** |
| هل الله موجود؟ (Does God exist?)           | `/a/isthere.html`       | **0.732 @ 1** |
| كيف أتعامل مع القلق والخوف؟ (anxiety/fear) | `/a/coronavirus.html`   | **0.643 @ 1** |

Every hit came back **ranked and cited** (title + canonical URL + source name),
and the snippets are real Arabic article prose, not nav.

**The headline finding: qwen3 retrieves ACROSS languages, unfiltered.** An Arabic
question pulls back semantically-matching documents in whatever language holds
the best answer:

- _Who is Jesus?_ → Sightline **English** at 1/3/5, Arabic at 2/4.
- _Does God exist?_ → Arabic sweeps **1–4**, and #5 is
  `everystudent.com/features/is-there-a-god.html` — the **English original of the
  very same article**, matched to its own Arabic translation across the language
  boundary. Slice #8 and slice #9 content aligning is about as clean a
  cross-lingual proof as the corpus can offer.
- _Anxiety/fear_ → **four languages in one top-5**: `ar` #1, **`zh` #2**
  (thelife/UWOTA 克服恐惧 "Overcome Fear"), **`fr` #3** (laviejenparle
  "Ce monstre que l'on appelle peur"), `ar` #4, `en` #5 — all genuinely on the
  fear theme.

This is the embedding model behaving correctly, not a defect — but it is exactly
why `docs/eval-approach.md` requires **`language:` pinned on every case whose
only relevant source is multilingual**. Unpinned, an Arabic case would be scored
against a corpus that legitimately answers it in Chinese.

**Rare-language retrieval works post-#17/#75.** This is the first Arabic
retrieval since the canary repair, i.e. the first live exercise of the
`hnsw.iterative_scan = strict_order` mitigation against a genuinely rare language
(65 `ar` docs among 11,621). Arabic docs are not being lost in the graph — they
take rank 1 outright on two of three questions.

One transient OpenRouter query-embed timeout on the first attempt, recovered on
re-run — the same #64 class as ingest's 10, on the query path this time.

**Stage 3b evidence (2026-07-25) — the `ar` filter is airtight and minScore 0.37
holds at 10 sources.**

_Filter._ `--language ar` returned **100% Arabic on every run**, including the
decisive test: an **English** question (`"how can I find peace with God?"`)
under the `ar` filter returned 5 Arabic `everystudent-ar` docs and nothing else
— so the filter binds on the **document**, not on the query language, and
composes correctly with cross-lingual retrieval. On `"من هو يسوع؟"` the three
English Sightline docs that held ranks 1/3/5 unfiltered are gone, leaving 5/5
Arabic. Rank-1 scores are **identical** filtered vs unfiltered (0.643 on the
anxiety query), so the filter prunes without perturbing scoring.

_Mechanism (not just the sample)._ `corpus-search-store.ts:62` applies
`eq(documents.language, filter.language)` — a strict SQL equality. Other
languages **and** `NULL`s are excluded by construction under three-valued logic.
This is the same mechanism the standing null-exclusion policy rests on, now
confirmed on the live path: neither of the 2 null `/v/` docs can ever surface
under a `language:` scope.

_Corpus language distribution at 10 sources:_ en 10,554 · es 500 · zh 332 ·
fr 159 · **ar 65** · null 11 (= 11,621). Arabic is **0.56% of the corpus** —
which is what makes the rank-1 results above meaningful for #17/#75: a genuinely
rare language is not being lost in the HNSW graph.

_minScore._ Re-derived from the Arabic score distribution per
`docs/eval-approach.md` §4 (non-English negatives before changing the default):

| Probe                               | Top score         | Verdict                               |
| ----------------------------------- | ----------------- | ------------------------------------- |
| Positives (3 real questions)        | **0.538 – 0.732** | —                                     |
| Cooking rice/pasta                  | 0.239             | clean reject                          |
| World Cup schedule                  | 0.219             | clean reject                          |
| Learning Python                     | 0.349             | clean reject (closest clean negative) |
| Five pillars of Islam + dawn prayer | **0.382**         | crosses — see below                   |
| Writing a CV / job application      | **0.466**         | **not a negative** — see below        |

**Recommendation: keep minScore 0.37 unchanged.** The clean secular noise floor
tops out at **0.349** and the positive floor is **0.538** — 0.37 sits inside a
comfortable ~0.19 gap. Neither crossing is band encroachment:

- **0.466 "write a CV" is a TRUE POSITIVE, not a false one.** The corpus really
  contains `everyarabstudent.com/a/jobinterviews.html` ("The 10 most common job
  interview questions"). A badly-chosen probe, not a cutoff failure.
- **0.382 (five pillars / dawn prayer) is by-design adjacency.** The hits are
  "Will worshipping any other god make a difference?" (0.382), "Knowing God
  personally" (0.366), "Does God answer our prayers?" (0.357) — this source is
  explicitly apologetics _written for Muslim readers_, so a question about
  worship and prayer legitimately surfaces them. Worth knowing it sits only
  0.012 above the cutoff; it is the tightest faith-adjacent margin recorded so
  far and the number to watch when `everystudent-fr` lands.

**Bonus: slice #8's flagged English near-miss is largely explained.** STATUS
recorded a resume-writing negative reaching 0.505 as "the faith-adjacent band's
closest approach yet". Re-probed here, that question is **not a clean negative
for this corpus at all** — hiring/career content exists across four sources
(`familylife/…/now-hiring` at 0.466, the Arabic job-interviews doc at 0.416,
cru and everystudent job-themed pages). Wording differs from slice #8's exact
probe, so this does not disprove the 0.505 reading — but it does mean the
approach was toward _real_ documents rather than noise creeping at the cutoff.

### 4. Spot-check + eval

- [x] `/golden everystudent-ar` — Arabic cases with English question translations
      AND translated retrieved-set blocks; `language: ar` pinned on every case <!-- sha: 1b22945 -->
- [x] Whole-corpus eval; confirm no prior-source regression <!-- sha: 1b22945 -->

**Stage 4 evidence (2026-07-25).**

_Part A — re-review was a provable NO-OP; there was no regression surface._
Adding 67 Arabic docs regressed **nothing**, confirmed two independent ways:

- **Structurally.** All 106 pre-existing cases resolve to a language (en 78 · fr 10
  · zh 10 · es 8, **0 unscoped**), and `corpus-search-store.ts:62` is a strict
  `eq(documents.language, …)`. An Arabic doc is therefore **ineligible by
  construction** for every prior case — it cannot displace a credited doc.
- **Empirically.** Zero `everyarabstudent` documents appear anywhere in the
  106-case results, and the headline metrics reproduced slice #8 exactly across
  two full runs (recall@3 0.953 · recall@10 1.000 · coverage 0.702 · MRR 0.828 ·
  P@1 0.698).

This is the first slice where a new source **could not** disturb prior answer
keys — the "new source regresses the eval" pattern of slices #3/#5 is structurally
impossible for a language that no prior case is scoped to.

⚠️ **Eval jitter identified — `everystudent` 0.818 ↔ 0.773 is NOT a regression.**
The only per-source number that moved traced to a single credited doc:
`everystudent/forum/contradictions.html` in `jf-skeptic-bible-contradictions` sits
at **rank 10, score 0.648, with rank 11 at 0.647** — a **0.001** gap at the exact
top-10 cutoff. Both eval modes are individually reproducible (whole-corpus gave
4/5 twice; `--source everystudent` gave 5/5 twice, matching slice #8's 0.818
exactly), so the flip is float noise in the query embedding between sessions, not
retrieval nondeterminism and not the Arabic ingest. **Per-source metrics at small
n carry ~±0.045 of boundary jitter that we have been reading as exact.**

_Part B — 12 Arabic cases / 27 credits, authored corpus-side._
Relevant sets were built by reading **all 65 Arabic documents** (titles + openings,
full text where borderline) BEFORE consulting the engine — the anti-circularity
rule from slice #7. The engine probe then _checked_ the sets rather than authoring
them. Personas: skeptic ×4 · seeker ×5 · newcomer ×2 · believer ×1.

**Judge panel: 52 pairs × 3 lenses = 156 judgements, coverage COMPLETE** (the
code validator hard-fails on any missing pair × lens; zero holes this run, unlike
slice #8's 7). **Max panel spread 0.35 against a 0.5 escalation threshold → 0
escalations** — the slice-#7 convergence caveat holds for a third time; do not
read panel agreement as corroboration.

🔑 **DECISION — entry gated on RELEVANCE only; soundness routed to an issue.**
The slice #7/#8 both-axes-at-0.75 rule **breaks structurally on a single-source
language**:

| gate                     | credits     | cases left empty |
| ------------------------ | ----------- | ---------------- |
| relevance ≥0.75 only     | **27 / 52** | 2 / 14           |
| rel ≥0.75 + snd ≥0.65    | 21 / 52     | 2 / 14           |
| rel ≥0.75 + snd ≥0.70    | 14 / 52     | 4 / 14           |
| both ≥0.75 (slice #7/#8) | 6 / 52      | **9 / 14**       |

In slices #7/#8 the corpus held nine English sources, so striking a low-soundness
doc left other credited docs standing — the gate _filtered_ a key. Here
`everystudent-ar` is the only Arabic source and cases are necessarily `ar`-scoped,
so a soundness veto **deletes** the key. It would also mark the engine wrong for
returning the genuinely best-matching document: `/a/childraped.html` scored
**relevance 0.91 — the highest pair in the panel — on soundness 0.52**. And
excluding a doc from an answer key never stopped the RAG serving it, so the
exclusion buys no user protection while blinding the retrieval metric. Mean
soundness across the 52 pairs was **0.703**, systematically below every prior
source; those findings are filed as
**[#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)** (the #78 analogue).

**Dropped 2 of 14 drafted cases** (no relevance-passing doc, both honest corpus
gaps the panel surfaced): `esar-believer-next-step` — all four candidates address
_pre_-believers, so this source has no discipleship next-step content; and
`esar-seeker-astrology` — `/a/strange.html` is a testimony narrative (rel 0.71),
not a direct answer.

**Arabic-scoped eval (n=12): recall@3 0.917 · recall@10 1.000 · coverage 0.979 ·
MRR 0.938 · P@1 0.917** — 11 of 12 cases at rank 1. The two imperfections were
both predicted from the probe and are honest, not artefacts: `esar-seeker-emptiness`
ranks 4 because `/a/wolves.html` (a wait-for-marriage piece) out-ranks the
purpose/beauty docs, and `esar-newcomer-who-is-jesus` covers 3/4 because
`/a/whodoyousay.html` sits at rank 14 — a real vocabulary gap, surfaced by
deliberately phrasing the question with the Quranic **عيسى** while the documents
say **يسوع**.

**Final whole-corpus eval @ 118 cases / 10 sources: recall@3 0.949 · recall@10
1.000 · coverage 0.730 · MRR 0.839 · P@1 0.720.** Coverage, MRR and P@1 all rose;
recall@3 dipped 0.004 solely from the rank-4 emptiness case. **Every prior source
is unchanged** (cru 0.861/0.636 · everystudent 0.773/0.693 · familylife
0.913/0.745 · jf 0.667/0.537 · sightline 0.783/0.563 · swg 0.458/0.375 · thelife
0.878/0.634 · thelife-fr 1.000/0.817 · thelife-zh 1.000/0.867). **Per-language:
`ar` 0.979** · en 0.641 · es 0.938 · fr 0.817 · zh 0.867, **0 unscoped**.

**Negatives (slice-file record, NOT in qa-golden.yaml):** cooking rice 0.239 ·
World Cup schedule 0.219 · learning Python 0.349. Known non-negatives that cross
0.37 and are _not_ encroachment: "write a CV" 0.466 (**true positive** —
`/a/jobinterviews.html` exists) and "five pillars of Islam" 0.382 (by-design
adjacency for a source written for Muslim readers; **0.012** above the cutoff, the
tightest faith-adjacent margin recorded — the number to watch when
`everystudent-fr` lands). **minScore 0.37 unchanged.**

⚠️ **FLAKY TEST OBSERVED at the Stage-4 gate — `tests/retrieval.integration.test.ts`,
the #79 `includeDocument` case. 1 red in 13 runs; NOT reproducible on demand.**
The gate's first run came back **431/432**; twelve subsequent runs (6 of the file
alone, 5 of the full suite, plus the closing gate) were all green, so the slice
closed green — but the red was real and is recorded here rather than waved off.

_Diagnosis (strong, not confirmed)._ The fixture seeds and queries with
**`oneHot(0)` — a SPARSE vector** (`:322`, `StubEmbedder(oneHot(0))` at `:327`).
That is **the same bug class `55bfd7f` fixed earlier in this very slice**: sparse
query vectors are not reliably HNSW-reachable once the corpus is large (measured
then: a dense vector at cosine 0.068 returns 15 rows, a one-hot at 0.113 returns
**0**, and `ef_search=1000` does not rescue it). The canary repair rebuilt _its_
fixture on deterministic dense vectors preserving the same geometry; **this
sibling was left on one-hot**. The failing assertion was consistent with `buried`
coming back undefined — i.e. the doc was not returned at all, which is the
sparse-unreachability signature rather than a content mismatch. It surfaced only
in the **full suite** (a later swarm test floods the source with 60 rows), and
this slice just grew the corpus by 283 chunks — the slice-#3 lesson that a _data_
stage can redden tests with zero code changes.

_Recommended fix (deliberately NOT taken here — out of Stage-4 scope, and the
gate is green):_ port `55bfd7f`'s treatment to this fixture — dense deterministic
vectors preserving the same ranking geometry. Cheap, and it removes a ~1-in-13
CI failure rather than leaving the suite to fail for reasons unrelated to the
change under test.

ⓘ **Tooling finding — `pnpm eval` inherits the fast-fail QUERY retry policy.**
`docs/ops/embed-retry-policy.md` files `pnpm eval` under the query posture
(`QUERY_EMBED_MAX_ATTEMPTS=2`, 4 s timeout) that exists for `/v1/search` latency.
An offline 118-case batch has no latency SLA and **no resume**, so one transient
OpenRouter blip discards the whole run — it killed two runs on 2026-07-25 before
being worked around with `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000`
(env only, no code change). Filed as a FOLLOW-UP; the fix is a batch posture for
the eval scripts, not a change to the serving path.

## Decisions made (this slice)

- 2026-07-25 — **Own source key, not a language of `everystudent`.** One domain =
  one source (ADR-0006). No operator question needed; follows `thelife-fr`/`-zh`.
- 2026-07-25 — **`fetchStrategy: "firecrawl"`.** Re-probed live: homepage and
  `/sitemap.xml` both 403 with the Cloudflare block-page signature (`Attention
Required`); only `robots.txt` answers. Same wall as the English sibling.
- 2026-07-25 — **Seed-only, 68 of 84 mapped URLs.** Discovery was already paid
  for via `/v2/map` (#114); re-discovering would re-pay for what we hold.
  Dropped: 11 `/m/*` menu indexes, 4 `/bible/**.pdf` (html-scrape can't read a
  PDF, and it's public-domain Scripture), the bare homepage. Kept `/john.html`
  and `/pack.html` provisionally — `minContentLength: 250` drops them if they're
  link-only chrome.
- 2026-07-25 — **robots.txt is `Allow: /` with no disallows** (checked live),
  unlike everystudent.com which carries a real disallow list. Nothing dropped on
  robots grounds.
- 2026-07-25 — **Null-language docs are EXCLUDED from the eval — standing
  policy, not a decision this slice made.** Nulls are an expected, permanent
  outcome in every source (honest ADR-0007 blanks); we cannot know their
  language, so a `language:`-scoped expectation on one is unreturnable by
  construction. They are never credited, they are never swept during a slice
  (`pnpm lang:sweep` is a **prod** corrective tool), and they are not lost — the
  dashboard carries a per-source null count. Recorded as a standing rule
  2026-07-25 in `skills/slice` v11, `skills/golden` v6
  (Guardrail #3a) and `docs/eval-approach.md`, because it had been re-asked at
  every new source. For context, the risk here is small anyway: tinyld reads
  Arabic prose at confidence **1.0 with no runner-up**, versus the 0.605–0.771
  `en`/`hi` confusion behind slice #8's 9 nulls.
- 2026-07-25 — **The #17/#75 canary was a fixture artifact, not an engine
  fault.** Sparse query vectors are not HNSW-reachable at corpus scale (a random
  _dense_ vector at cosine 0.068 returns 15 rows; a one-hot at 0.113 returns 0,
  and `ef_search=1000` doesn't rescue it). The shipped `iterative_scan =
strict_order` mitigation is load-bearing and works: a real `en` query vector
  with a `language='zh'` filter returns 15 rows with it, 0 without. Fixture
  rebuilt on dense vectors; gate green at 426/426, then 432/432.

## Open question / blocker

- none. The Firecrawl spend was approved and is now **done** (68 credits, 828
  remain — `everystudent-fr`'s ~87 still fits this period, which ends
  2026-08-21).

## Notes carried in from #112 / the English slice

- **Cost guard:** measured 1 credit/page on this host (#114). Watch the credit
  delta over the first few pages — if it reads 5 cr/page, Cloudflare has
  tightened; stop and re-plan.
- **Prod promotion is the bulk-copy path, NOT `acquire:production`** — that would
  re-pay Firecrawl. `bash scripts/copy-raws.sh --source everystudent-ar` →
  `pnpm index:production` → `pnpm eval:production`. See `docs/ops/copy-raws.md`.
- **Multilingual eval:** `ar` cases need an English translation of the question
  and a translated retrieved-set block (`AGENTS.md`, `docs/eval-approach.md`),
  and `language: ar` pinned so `caseLanguage()` can derive a scope.
- **Selector claim is unverified on this host.** #112 says `.content4`/`.content4b`
  is shared across all three banners; confirm on the first Arabic fetch.

## Prod promotion (2026-07-25) — DONE via the #115 bulk-copy path

`everystudent-ar` is the **second source promoted through `copy-raws.sh`** and the
first Arabic content in the prod corpus. `acquire:production` was deliberately NOT
run — it would re-pay the 68 Firecrawl credits already spent at Stage 1. Mechanism:
`docs/ops/copy-raws.md`.

Sequence run against prod (`zephyr.proxy.rlwy.net`):

1. **Copy** — `copy-raws.sh --source everystudent-ar` copied **67 rows** local→prod
   (0 → 67, all landing `ingested_at IS NULL` — the gotcha-fix held). Verified by
   the same deterministic ordered row-level digest used for the English slice:
   `md5(string_agg(md5(row) ORDER BY canonical_url))` over all 11 copied columns
   returned **`712a93db56ff2affd2a89583b02c56a1`** on **both** sides at 67 rows,
   i.e. row-for-row equality, not merely matching totals. Secondary evidence also
   matched the Stage-1 acquire record exactly: 431,585 total chars (avg 6,442 · min
   1,239 · max 23,906), 0 empty titles, 0 non-200.
   - ⚠️ **Pin `SET TIME ZONE 'UTC'` on both sides when digesting.** `fetched_at` and
     `last_modified` are `timestamptz`, so their `::text` rendering inside
     `md5(row::text)` is **session-TimeZone dependent** — an unpinned session can
     report a spurious mismatch on a byte-identical copy. Not a hazard the English
     run happened to hit; worth carrying forward for `everystudent-fr`.
2. **Embed** — `index:production --source everystudent-ar` drained all 67 pending
   → **67 docs / 283 chunks / 283 embeddings** on `qwen/qwen3-embedding-8b`, an
   exact match of the local corpus, with **0 `chunk_count` mismatches** and the
   language split preserved (**65 `ar` / 2 null** — the same two `/v/` testimony
   pages). Confirmed beyond aggregate totals by a **per-document fingerprint**
   (`canonical_url|language|chunk_count|content_hash` digested in url order):
   **`a271be3a8d61801cb5c15136d3c41f80`** on both sides, so every doc landed with
   an identical chunk split and language label, not just the right grand total.
   Prod corpus 11,594 → **11,661 docs** / 33,733 → **34,016 chunks**.
   - OpenRouter was in a slow spell again (#64): **34 corpus-embed retry lines**
     across the run, longest chain reaching **attempt 6 of 10**. Every one
     recovered inside the patient corpus policy — **0 docs lost, exit 0**. This is
     the third prod ingest to be saved by the raised `EMBED_MAX_ATTEMPTS` default.
3. **Smoke** — `retrieve:production` on three real Arabic questions reproduced the
   Stage-3 local results within float noise: "هل الله موجود؟" → `/a/isthere.html`
   **rank 1 @ 0.732** (local 0.732); "كيف أتعامل مع القلق والخوف؟" →
   `/a/coronavirus.html` **rank 1 @ 0.644** (local 0.643). **Unscoped**,
   "من هو يسوع؟" put `/a/isjesus.html` at **rank 2 @ 0.607** (local rank 2 @ 0.609)
   with three English Sightline docs at ranks 1/3/5 — the cross-lingual competition
   pattern from Stage 3 holds in prod, so the Arabic source is genuinely findable in
   the shared 10-source space rather than only inside its own `--source` filter.
4. **Certify** — `eval:production --source everystudent-ar` reproduced the local
   Stage-4 numbers **exactly, to three decimals**: recall@3 **0.917** · recall@10
   **1.000** · coverage **0.979** · MRR **0.938** · P@1 **0.917**, 11 of 12 cases at
   rank 1 with `esar-seeker-emptiness` at rank 4 — the same single rank-4 case.
   Record: `eval/results-2026-07-25-everystudent-ar-keep.md`.
   - 🔑 **Zero prod-vs-local drift here, and that is structural, not luck.** The
     English promotion showed a ~0.09 recall gap that was correctly read as corpus
     drift (prod carried ~40 more docs across thelife/sightline/jf-org). These
     cases can't drift that way: every one pins `language: "ar"`, and
     `corpus-search-store.ts:62` is a strict `eq(documents.language, …)`, so the
     only documents eligible to compete are `everystudent-ar`'s own 65 `ar` docs —
     byte-identical on both sides. **An `ar`-scoped eval measures the source in
     isolation by construction.** Corollary for `everystudent-fr`: French will
     have `thelife-fr` as a genuine competitor, so expect real drift there and do
     **not** read this exact match as the new normal.
   - `eval:production` again needed `QUERY_EMBED_MAX_ATTEMPTS=10
QUERY_EMBED_TIMEOUT_MS=15000` to finish — 9 query-embed retries fired, one
     chain reaching attempt 4. The default fast-fail policy (#118) would have
     discarded the batch, exactly as on the English run. **Two for two: #118 is not
     an occasional annoyance on this path, it is the expected posture** for a
     promotion eval during a slow spell.

⚠️ **Live pastoral hazard now in prod, tightening [#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123).**
The prod smoke test for "كيف أتعامل مع القلق والخوف؟" ("how do I deal with anxiety
and fear?") returned **`/a/endingthe8th.html` at rank 4 @ 0.431** — the suicide and
self-harm page with **no professional help signposted**. #123 recorded this as a
content-soundness finding; the promotion turns it into an observed retrieval
result, i.e. a distressed Arabic-speaking reader asking a plainly in-scope question
is served that page **today**. Retrieval is behaving correctly (the document really
is topically relevant) — the defect is in the document, so the fix belongs to #123
and not to the engine. This is the promotion's most action-worthy outcome.

## Resume hint (for a cold start)

**SLICE COMPLETE + PROMOTED TO PROD 2026-07-25.** `everystudent-ar` is queryable
and evaluated in the 10-source local space (67 docs / 283 qwen3 chunks, 12 golden
cases / 27 credits, `ar` coverage **0.979** at recall@10 **1.000**, minScore 0.37
unchanged) **AND live in the prod corpus** (67 docs / 283 chunks, prod eval
identical to local — see "Prod promotion" above). Nothing to resume.

Remaining operator decisions: (1) **merge** — the branch is still unmerged and
unpushed, so prod is carrying this source _ahead_ of `main`; (2) **[#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)**,
now live-confirmed in prod (see the hazard note above); (3) the queued
`everystudent-fr` slice (~87 credits, 828 remain, period ends 2026-08-21).

**Never `acquire:production` for this source** — it is walled, and the credits are
already spent. See `docs/ops/copy-raws.md`.

Open follow-ups this slice created: **[#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)**
(content soundness — `/a/endingthe8th.html` is the time-sensitive item: suicide
and self-harm content with no professional help signposted; ~~and it ships to prod
with the source~~ — **it has now shipped, and the prod smoke test returned it at
rank 4 for an anxiety question**, see the hazard note above) and the `pnpm eval`
batch-retry-posture FOLLOW-UP (now **twice** confirmed on the promotion path — #118
raising is the expected posture, not a workaround).

Last verify: green @ 2026-07-25 (depcruise 100/0, lint clean, typecheck clean,
db:check in sync, status:check valid, tests 432/432).
Branch: `slice/everystudent-ar` (unmerged; promotion recorded on the same branch —
unlike the English slice, whose promotion landed separately on `ops/copy-raws`).
