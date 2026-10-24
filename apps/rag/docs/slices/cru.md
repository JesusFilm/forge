# Slice: Cru — consolidated, one domain one source (`cru`)

_Branch: `slice/cru` · Started: 2026-07-09 · Closed: 2026-07-14 · Status: done_

<!-- Status: in-progress | blocked | done -->

## ✅ DONE 2026-07-14 — all four stages green

2,444 docs / 8,497 qwen3 chunks, queryable in en + es + fr. Eval @ 96 cases:
recall@10 **1.000** · coverage **0.689** · **cru recall 0.125 → 0.828** (stale answer key, not a
retrieval regression). Per-language: en 0.614 · es 0.938 · fr 0.817 · zh 0.867.

**Engine work this slice:** per-language coverage view (`08acd48`) · candidate fan-out cap bug
(`3418717`). **Findings filed:** [#78](https://github.com/JesusFilm/jesusfilm-rag/issues/78)
content-soundness (18 docs). See "Findings" below for the chunking + Spanish-MT discoveries.

## ✅ UNBLOCKED 2026-07-13 — the language engine landed

Everything this slice paused for is now merged to `main` (and merged into this
branch, commit `86a4d97`):

- **Per-document content-based detection** (`tinyld`) wired into `normalize()` —
  [ADR-0006](../decisions/0006-per-document-language-detection.md), PR #77.
- **Thresholds + `null` policy** — 500-char detection floor, 0.75 confidence gate,
  below either the label is stored **`null`** (never a guess, never a default to the
  declared language) — [ADR-0007](../decisions/0007-language-decision-thresholds-null-policy.md).
  Note: ADR-0007 **dropped the "by-path prior" idea** this slice sketched — there is no
  prior rung at all; content detection or `null`, with out-of-declared-set detections
  stored + warned.
- **`/slice` skill** now carries the deterministic language plan (domains → source
  keys, declared set by inspection, per-doc detection) — no more re-asking.

The section below is the historical pause record, kept verbatim.

## ⛔ PAUSED at Stage 2 — blocked on engine work (2026-07-09, RESOLVED above)

The operator is landing an engine change before this slice ingests:

1. **One domain = one source**, always — no per-case judgement calls.
2. **Language is per-document detection at ingest**, never inferred from the source.
3. `/slice` must fill in a per-source **language plan** during policy investigation
   (`single: es` | `by-path: {…}` | `detect`).
4. **Backfill = a `documents.language` column update. No re-embed.**

**Consequence for this slice: DONE.** `cru-es` has been **folded into `cru`** (both are
`www.cru.org`); its registry file is deleted and all its verified knowledge migrated into
`cru.ts`. Its 537 staged rows were re-keyed with one `UPDATE` — no re-crawl.
`thelife-fr` / `thelife-zh` stay separate — different domains (laviejenparle.com /
uwota.com) — so they already obey the rule.

**Still blocked:** do NOT ingest. `normalize()` still stamps `language = languages[0]`,
so all 537 Spanish rows would be labelled `en`.

**Nothing acquired is wasted.** `raw_documents` has **no `language` column**; language is
assigned only at ingest (`normalize.ts`). The crawl output is language-agnostic and
survives the pivot intact. Backfill needs no re-crawl either: `raw_documents.raw_content`
and `documents.content` are already stored, so a detector can run over them in place.

### ⚠️ Evidence the engine work must not ignore: `<html lang>` LIES

Measured 2026-07-09 on cru.org:

| page                                                             | `<html lang>` | `.article-long-form` | body reads |
| ---------------------------------------------------------------- | ------------- | -------------------- | ---------- |
| `/us/en/train-and-grow/10-basic-steps/4-prayer.html`             | `en-us`       | yes                  | EN ✓       |
| `/mx/es/conoce-a-dios/jesus-dios-o-simplemente-buen-hombre.html` | `es-mx`       | no                   | ES ✓       |
| `/mx/es/…/10-pasos-basicos-…/intro-the-uniqueness-of-jesus.html` | **`es-mx`**   | yes                  | **EN** ✗   |

So `<html lang>` is a **locale marker, not a body-language signal** — it fails on exactly
the same pages the URL path fails on. Two consequences:

- **`by-path` (and `<html lang>`) must not be a trusted rung above detection.** Treat them
  as a _prior_ that body-detection can override, and **log/flag disagreements** — that
  check would have caught the `/10-pasos/` pages automatically instead of by hand.
- **Capturing `<html lang>` into `RawDocument` is not worth a schema change** — it buys a
  signal we've just proven unreliable. Detect from the extracted body, which is already
  persisted.

These three URLs are a ready-made acceptance fixture for the detection cascade.

### ⚠️ Blocking `/10-pasos/` is NOT sufficient — 7.6% of the Spanish path is English

A body-language audit of all **537 staged Spanish-path documents** (SQL over
`raw_documents.raw_content`, after `/10-pasos/` was already excluded):

| bucket           |      docs |
| ---------------- | --------: |
| Spanish body     |       489 |
| **English body** | **39–41** |
| mixed            |         3 |
| thin/unknown     |         4 |

Clustered in `crecer-y-equipar/comparte-evangelio` (**31 of 98**) and
`crecer-y-equipar/vida-y-relaciones` (10 of 194) — e.g. _"State of the Mission: The 21st
Century"_, _"Weaving Social Justice into Cru Movements"_. They share **zero `body_hash`
with any us/en document**, so they are unique articles that were never translated:
**keep them and label them `en`.** A `by-path` rule would mislabel all 39.

**This also corrects an earlier claim of mine in this very slice.** A 30-page spot-check
reported "0/30 English" and was simply unlucky. Sampling cannot establish a per-document
property — which is the whole argument for the engine change.

The English crawl is clean by contrast: 1,877 EN / 0 ES / 28 thin-unknown of 1,905.

## Goal (architecture altitude)

Consolidate Cru into **one `cru` source** covering its whole English spiritual corpus,
absorbing the 12-page `cru-10-basic-steps` hand-list, and add a **`cru-es`** Spanish
sibling. Get both queryable end-to-end in the current **qwen3 multilingual** corpus:
acquire → ingest → retrieve → eval.

**Operator decisions (2026-07-09):** one `cru` key, no second cru source; broad scope
(not just train-and-grow); add `cru-es`; exclude the 28-language `language-resources`
bag for now; no consumers ⇒ downtime tolerated (nuke-and-repave the cru rows).

## Context that changed since the last cru work (READ FIRST on a cold start)

- **Embedding model is `qwen/qwen3-embedding-8b` @ 1536** (ADR-0005, #39), instruction-aware
  queries. Local + prod corpus already re-embedded. Any cru ingest MUST use qwen3 —
  mixing spaces silently breaks retrieval ("query model == document model").
- **Local `.env` was stale** (`openai/text-embedding-3-small`) — fixed in Stage 0.
- **`architecture.md` IS current** on the model swap; **`STATUS.md` / `sources.md` are stale**
  (still describe the 6-source openai world). Refreshing them is part of this slice.
- **Prod is a separate post-merge step** (`docs/ops/prod-ingest.md`, #29). This slice is local only.
- **`tests/retrieval.integration.test.ts` is a flaky canary**, not a gate — FOLLOW-UP J #17.
  It failed once and passed on the next runs with no code/DB change (populated DB only).

## Scope (verified against the live sitemap)

`cru` = us/en, from the `us-en` child sitemap (3,642 locs) → **2,145 URLs** kept:
`/train-and-grow/` (1,842) + `/how-to-know-god/` (114, the seeker/gospel trunk) +
`/blog/` (317). Excluded: `/communities/` 665, `/opportunities/` 399, `/about/` 169
(mostly donor/stewardship admin), store/give/campaigns; non-article media
(`/video/` 50, `/quizzes-and-assessments/` 41, `/audio/`, `/infographics/`);
`/language-resources/` 29 (multilingual — see FOLLOW-UP M).
`/blog/` mirrors train-and-grow's taxonomy but is distinct content: only 24 slugs
overlap, all thin section-index pages that `minContentLength` drops.

`cru-es` = mx/es → **571 URLs** kept: `/conoce-a-dios/` + `/crecer-y-equipar/`, minus
`/10-pasos/`. Regional English mirrors `tt-en` (3,203) and `bb-en` (3,079) are excluded —
identical slugs under a different locale path would duplicate the corpus.

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 0. Prep

- [x] Fix local `.env` → `EMBED_MODEL_ID=qwen/qwen3-embedding-8b` + `EMBED_QUERY_INSTRUCTION`.
- [x] Green baseline on `slice/cru` (263 tests; the 2 #17 integration failures proved flaky, then passed).

### 1. Acquire → raw_documents

- [x] Registry: `cru` (discovery over the 3 us/en trunks) + `cru-es`; delete `cru-10-basic-steps`; tests. <!-- sha: f45f369 -->
- [x] DB migration: dropped `cru-10-basic-steps` (11 docs / 35 chunks / 35 embeds + 11 raw rows), 0 orphans. 8→7 sources.
- [x] Dry discovery: `cru` 2,145 kept / 3,642 seen · `cru-es` 571 kept / 709 seen (the 2nd es sitemap adds 6 unique).
- [x] **Extraction fix** — the first live crawl skipped 59/59 `/how-to-know-god/` too-thin. <!-- sha: b793502 -->
- [x] Live crawl `cru` (English) → **1,905 staged / 240 skipped of 2,145**, exit 0. All status 200, 1,905 distinct canonical_url, 0 null titles; chars min 250 / avg 4,954 / max 52,671 (heaven-and-hell — matches the 52,409 body-fallback prediction). 9× 429 + 5 fetch-fails across 2,145 requests. Skips are hub/index pages.
- [x] Live crawl `cru-es` (571 URLs) — ran under the retired `cru-es` key; its 537 raw rows re-keyed to `cru` with one `UPDATE` (see Fold-in below).
- [x] Un-block `/language-resources/` + add `fr` to the declared set (detection landed). <!-- sha: 19591a1 -->
      **Scope correction by inspection:** the 28 per-language pages are ~90-char
      link-card hubs (external `.cmp-teaser` links) that `minContentLength` drops —
      NOT "gospel content in 28 languages". The section's one real doc is a French
      article. Dry discovery 2,746 kept (was 2,716).
- [x] Resume-crawl the delta → **staged 2/305** (the French article, 3,415 chars, + one
      train-and-grow story that grew past the floor); 300 hub pages re-skipped too-thin
      exactly as predicted, 3 transient fetch-fails. **Stage 1 FINAL: 2,444 rows**
      (1,907 en-path + 537 es-path), all pending. Counts recorded in `sources.md`
      (→ Acquired) + `source-status.yaml` (acquire green ×3 langs).

### 2. Ingest → corpus tables

- [x] `pnpm index --source cru` → **2,444 docs / 8,497 chunks / 8,497 embeddings** (qwen3 @ 1536, 1:1, 0 skipped, chunks/doc avg 3.48); idempotent re-run drains **0**.
- [x] **Invariant-6 evidence (first multi-language single-source ingest):**
      `en` 1,805 (incl. **30 English-bodied `/mx/es/` docs — the audit's predicted class,
      correctly labelled `en`**) · `es` 447 (all es-path) · `fr` 1 (the language-resources
      article) · `null` 190 (7.8%; lengths 250–28k, median 918 — 76 near-floor, 114
      confidence-gated; honest #73 worklist, retrievable unfiltered) · `vi` 1 — the run's
      single ⚠ warning, a detector misfire on genuine 654-char Spanish ("El poder de la
      oración ferviente", conf 0.89): the ADR-0007 sweep's 0.3% wrong-above-gate class,
      #73 cleanup material. es-path total reconciles: 447+30+59+1 = 537 ✓.
- [x] Full gate re-run at new corpus size (~33.2k chunks): depcruise ✓ lint ✓ typecheck ✓
      db:check ✓ **295/295 tests** — the #17 canary did not bite this time.

### 3. Retrieve → ranked results

- [x] Spot-retrieval in the 9-source space (read-only, no code changes):
      **`--language es` pure** — "¿Cómo puedo conocer a Dios personalmente?" → 5/5 Spanish
      cru docs, flagship "Conoce a Dios personalmente" rank 1 @ 0.686. **`--language fr`
      pure** — the new cru French article rank 1 @ 0.763, thelife-fr behind it (cross-source
      fr space coherent). **Cross-source health:** "sure I will go to heaven?" → swg
      flagship **rank 1 @ 0.696** (founding source LEADS after +8.5k cru chunks), cru's
      re-crawled 10-basic-steps assurance lesson #2 — first FOLLOW-UP I #15 _relief_
      signal: broad-cru surfaces where cru-10 was crowded out. cru-native maturity query →
      all-cru top 5 (incl. Spanish "Pasos hacia la madurez" #1 — unfiltered queries mix
      languages by design; the filter is the consumer tool). **minScore 0.37 holds:**
      faucet 0 hits; index-funds 1 honest hit @ 0.391 (a real thelife-zh
      invest-for-kids article — topical overlap, pre-existing); Quran/Ramadan → only
      Christian-fasting docs 0.56–0.59, below the qwen positive band (0.65–0.76; the old
      "0.55+ band" was a 3-small artifact).

### 4. Eval + spot-check

- [x] Re-key golden `cru-10-basic-steps:` → `cru:` (17 refs) + `tests/eval-metrics.test.ts` fixture. <!-- sha: 579b067 -->
- [x] **Per-language coverage breakdown** — ADR-0006 made `cru` the first single source carrying
      several languages, so the per-source view BLENDS en+es+fr and can hide an unhealthy language.
      `coverageByLanguage()` splits them; cases with no derivable language surface as `(unscoped)`
      rather than being dropped (that state is a bug, not a result). <!-- sha: 08acd48 -->
- [x] **Engine bug found + fixed: candidate fan-out was hard-capped at 50.** Any `topK >= 17`
      fetched exactly 50 chunks; the 3-key dedup collapsed those to ~33 docs, so `search` answered
      a request for 100 results with 33 and said nothing. Prod (topK 5) and eval (topK 10) sit under
      the old cap and were never affected — deep-k _curation probing_ is what exposed it, and every
      "not ranked" verdict really meant "not in the top ~33". Ceiling now scales with topK. <!-- sha: 3418717 -->
- [x] **Curation via a 3-lens LLM judge panel** (theologian / pastor / mature Christian), scoring
      every proposed credit on TWO ORTHOGONAL axes — _relevance_ (does it answer THIS question) and
      _biblical soundness_ — both gated at 0.75. **73 of 151 proposals were biblically SOUND but
      OFF-QUESTION**: a soundness-only rubric would have auto-accepted every one into the answer keys
      and quietly corrupted the eval. 73 credits approved (60 passed, 13 reinstated on review).
      Prompt preserved at `docs/prompt-samples/2026-07-14-jfrag-golden-judge-panel.md`.
- [x] `pnpm eval` @ **96 cases** (was 82; +14 — 6 en cru-native, 8 **es: the suite's first Spanish
      cases**). recall@3 **0.938** · recall@10 **1.000** · coverage **0.689** · MRR 0.814 · P@1 0.677.
      **cru per-source recall 0.125 → 0.828, coverage 0.063 → 0.576** with NO engine change — proof
      the 0.125 was a stale answer key (still crediting only the 11 retired 10-Basic-Steps pages
      against a 2,444-doc source), not a retrieval regression.
      **Per-language:** en 0.614 · **es 0.938** · fr 0.817 · zh 0.867 — 0 unscoped. <!-- sha: f8d19d0 -->

**minScore 0.37 holds in Spanish.** Four es negatives (beans, visas, brake pads, World Cup) top out
at **0.308**; the es positive band is **0.622–0.739**. The cutoff sits in a wide dead zone — no change.

**French: deliberately NOT cased.** The sole fr doc is a Cru marketing piece about Google search
behaviour — not doctrinal or pastoral. At n=1 recall@10 is 1.000 _by construction_, so a case would
measure nothing and inflate the multilingual numbers. thelife-fr already carries 10 real French cases.
Recorded here so a future agent does not "fix" the gap.

## Decisions made (this slice)

- 2026-07-13 — **Declared set is `["en","es","fr"]`, by inspection** (ADR-0006's rule): en +
  es trunks, plus fr for the single real `/language-resources/` French article. The other
  27 per-language hub pages never reach ingest (thin), so their languages are NOT declared.
- 2026-07-13 — **`cru-10-basic-steps` YAML row → `deferred` + supersession note**, not
  deleted: prod still serves its rows until this slice's prod cutover, and the status
  tool (correctly) has no row-delete — the note carries the story.
- 2026-07-09 — **One `cru` source, absorb `cru-10-basic-steps`** (operator). Its lesson pages are re-crawled inside `/train-and-grow/`.
- 2026-07-09 — **Scope is broader than train-and-grow.** Scoping to it alone would have dropped `/how-to-know-god/` (the seeker gospel trunk) and `/blog/` — the operator caught this.
- 2026-07-09 — **Sitemap discovery**, not seed+link-follow: cru.org exposes `/sitemap.xml` → per-locale children.
- 2026-07-09 — **`cru-es` is a separate source, not folded into `cru`.** `normalize()` stamps language from `languages[0]`, so one source = one language (the `thelife-fr`/`zh` model). Folding Spanish in would tag it `en`. → FOLLOW-UP M.
- 2026-07-09 — **`/language-resources/` (28 languages) excluded** for the same reason; revisit after FOLLOW-UP M.
- 2026-07-09 — **Embed with qwen3 @ 1536**, not openai — correctness, not preference.

## Findings worth carrying forward

- **The prior "cru.org has no real Spanish content" note over-generalized.** Only
  `/mx/es/.../10-pasos-basicos/` serves untranslated English under Spanish chrome
  (reproduced: English `.article-long-form` template, `lang=EN`). A 30-page sample across
  all six other `/mx/es/` sub-sections found **0** English pages. `registry/index.ts` and
  `sources.md` corrected.
- **cru.org has no single content container.** `article` matches a **9-char stub on every
  page** (this caused the 59/59 skip); `.cmp-text` truncates multi-block articles
  (heaven-and-hell 14%, `full-article.html` 3%); `.cmp-container` can match empty.
  Answer: `.article-long-form` when present, else `<body>` + aggressive strips.
  **Slice #2's selector was verified on 2 lesson pages and never generalized.**
- **AEM chrome is `<div>`-based**, so a `header`/`footer` tag strip misses it. The
  `.cmp-global-picker` alone is ~1,745 chars of country names per page.

## Fold-in — DONE (commit below)

- [x] Deleted `src/registry/cru-es.ts`; **all** its verified knowledge migrated into
      `cru.ts` (the `/10-pasos/` English-body reproduction, the `.category-layout` 138-char
      CTA trap, the `.aem-Grid`/`.cmp-text`/`.cmp-container` first-match traps) — plus the
      corrected sampling claim and the 7.6% audit above.
- [x] `cru.crawl.allow` extended with `^https://www\.cru\.org/mx/es/(conoce-a-dios|crecer-y-equipar)[/.]`;
      `block` keeps `/10-pasos`. Selectors unchanged: `.article-long-form` is absent on mx/es,
      so those pages already take the `<body>` path. `maxPages` 2500 → 3000; both es sitemaps seeded.
- [x] `languages: ["en","es"]` as a **declared set**, with a loud comment that ingest is
      gated on per-doc detection.
- [x] `UPDATE raw_documents SET source_key='cru' WHERE source_key='cru-es'` — 0 collisions;
      now 2,442 rows (1,905 en-path + 537 es-path), all distinct, all pending.
- [x] `cru.test.ts` rewritten: every trap keeps a regression guard, plus new guards for
      the mx/es allow, the `/10-pasos/` block, the tt-en/bb-en mirrors, and
      `getSource("cru-es") === undefined`. `registry.test.ts` now asserts the domain rule.

### Still to do when detection lands — RESOLVED 2026-07-13

- [x] Language plan: the "by-path prior" idea was **dropped by ADR-0007** (no prior rung
      exists — detection or `null`). The plan is now just the declared set on the registry
      entry: `languages: ["en","es","fr"]` (fr = the one real `/language-resources/` article).
- [x] `/language-resources/` un-blocked (`19591a1`) — scope grew by 1 real doc, not ~29
      (the 28 per-language pages are thin link hubs; see Stage 1).
- [ ] `pnpm index --source cru` → Stage 2.

## Open question / blocker

- none — the engine-work blocker resolved 2026-07-13 (ADR-0006/0007 merged; FOLLOW-UP M
  was promoted into those ADRs and removed from `architecture.md` §11, replaced by
  invariant 6 + decision row 10).

## Process gap found this slice (worth folding into the same skill edit)

`/slice`'s verify gate is `depcruise && lint && typecheck && test`, but **CI also runs
`db:check`, `status:check` and `dashboard:verify`**. A slice can go green locally and red in
CI. All three pass on this branch, but the gate should name them.

## Findings that outlive this slice (Stage 4)

**1. Retrieval returns ONE chunk per doc, and cru docs bury their answer.** → [#79](https://github.com/JesusFilm/jesusfilm-rag/issues/79)
(architecture §11 FOLLOW-UP N). The 3-key dedup yields
at most one chunk per document, and cru articles routinely open with a long lead-in anecdote (a swim
team, an Antarctic expedition) before the substance. **≥2 of 3 judges flagged 40 of 151 docs as
`answer_buried`** — right document, useless snippet. This is the most likely mechanical cause of the
register gap and the buried on-ramp pages, and it is an ingest/chunking problem, not a curation one.

**2. 1,375 cru chunks (16.2%) literally begin with the junk string `0 100 0`** ([#79](https://github.com/JesusFilm/jesusfilm-rag/issues/79)) — an AEM widget
artifact the `<body>` fallback extraction picks up. No other source has it (0.0%). It sits at the
_front_ of the embedded chunk, i.e. the highest-signal position. Candidate contributor to (1).

**3. Cru's Spanish corpus is machine-translated to near-unreadability.** All three judge lenses said
so independently. The teaching is orthodox; the prose is broken. Acquire-side quality ceiling on
what Spanish retrieval can ever be worth — not a soundness problem, and it must not be filed as one.

**4. Content soundness → [#78](https://github.com/JesusFilm/jesusfilm-rag/issues/78).** 18 docs below
0.75 soundness (14 cru, 3 thelife ⚠️ _in prod_, 1 familylife). One real pattern: prosperity drift
(tithe → financial return) across **four sources** — a corpus-wide policy question, not a block list.
Three are genuinely harmful and worth raising with Cru as content owners. **Deliberately did NOT
blanket-exclude them from the crawl:** none are heresy (band 0.57–0.73), 4 of the 14 are the
translation problem in disguise, and this was 151 of ~11,500 docs — a sample, not an audit.

**5. Judge-panel caveat.** Max disagreement between the three lenses was **0.25** (escalation
threshold 0.5), so **zero escalations fired**. Three personas on one base model converge far more
than three humans would — the panel buys less independent signal than the design implies. The axis
that genuinely earned its place is **soundness**, which found things relevance never could.

## Resume hint (for a cold start)

**Slice is DONE (2026-07-14).** All four stages green; `source-status.yaml` rolls up to `done` for
en + es + fr. Nothing to resume. Branch `slice/cru`, not yet merged.
Last verify: green (depcruise, lint, typecheck, db:check, status:check, **299/299**).
Last commit: `f8d19d0`. Next: merge decision, then prod cutover (`docs/ops/prod-ingest.md` — the prod
`cru-10-basic-steps` rows are still being served and must be replaced).
