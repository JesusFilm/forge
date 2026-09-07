# Slice: EveryStudent — French (everystudent-fr)

_Branch: `slice/everystudent-fr` · Started: 2026-07-27 · Completed: 2026-07-27 · Status: done_

<!-- Status: in-progress | blocked | done | deferred (mirrors the RowStatus contract) -->

## Goal (architecture altitude)

Get EveryStudent's **French** banner (questions2vie.com) queryable end-to-end:
acquire → ingest → retrieve → spot-check. This is **slice #10**, the **third and
final walled EveryStudent domain** (Firecrawl, ADR-0012) and the close-out of the
#112 wayfinder route (en ✅ → ar ✅ → fr).

Scope is the French domain only. `everystudent` (en) and `everystudent-ar` are
separate keys and separate, completed slices (ADR-0006).

**What makes this slice different from #9:** French is **not a new language**.
The corpus already holds **159 `fr` docs** — `thelife-fr` 156 · `thelife` 2 ·
`cru` 1 — and **10 French golden cases** (`tlfr-*`, all deriving `fr` from
`thelife-fr`'s declared `["fr"]`, none explicitly pinned). So unlike Arabic:

- **Stage 4 Part A (re-review) is NOT a provable no-op.** The 10 `tlfr-*` cases
  resolve to `fr`, so everystudent-fr docs are **eligible by construction** on
  them and genuine displacement is possible. Expect `fr` per-language coverage
  (currently **0.817**) to MOVE, and re-review the living `relevant` maps before
  suspecting retrieval.
- **French is a MULTI-source language**, so the slice-#9 "relevance-only" gate
  (which exists for single-source languages) does **not** automatically apply.
  Decide the Stage-4 gate on evidence at Stage 4, defaulting to the slice-#7/#8
  two-axis 0.75 rule.

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents

- [x] Register `everystudent-fr` (walled, seed-only, 70 seeds) + fakes-only tests <!-- sha: 8398995 -->
- [x] Live Firecrawl crawl of the 70 seeds → `raw_documents` — **70/70 staged, 0 skips** <!-- sha: c542c13 -->
- [x] Verify: row count, French article prose, `.content4` binds; provisional keeps resolved — **all 3 dropped** <!-- sha: ad1de46 -->
- [x] Offline language pre-flight (`decideLanguage` over the staged bodies) — **69 `fr` / 1 `null`** <!-- sha: c542c13 -->

**Stage 1 evidence (2026-07-27).** Staged **70 of 70** seeds — **zero skips**,
the first EveryStudent banner to take every seed (en 117/117 but from a
pre-filtered 149; ar 67/68). 70 rows / 70 distinct `canonical_url` / 0
null-or-empty titles / 0 non-200 / 0 already-ingested / 0 below
`minContentLength`. Chars min 1,718 · avg **9,104** · max 31,558 — the richest
of the three banners (en 7,203, ar 6,442). Sections: **`/a/` 67** (avg 9,416 ch)
· **root 3** (2,141).

**Cost: exactly 70 credits at exactly 1.00 cr/page** (828 → 758). The guard
tripped at 26 pages reading 1.00 cr/page, so the tightened-wall risk (5 cr/page,
~350 total) did not materialise on the third host either. **#112's route is now
fully funded and paid: 758 credits remain**, period ends 2026-08-21.

**Extraction verified** on `/a/101existe.html` ("Dieu existe-t-il ?"): a short
breadcrumb ("Existence de Dieu"), then title, subtitle, byline (Marilyn
Adamson), then clean French article prose, closing on genuine Scripture
footnotes (Jean 8.12, Jérémie 31.3, Apocalypse 3.20). `.content4` **binds on
this host**, confirming #112's shared-template claim on the last of the three
banners. Residual chrome is a trailing "PARTAGER CETTE PAGE:" — a few words, the
same class as the English sibling's leftover and the Arabic "شارك مع أخرين";
noted, not re-crawled.

**Language pre-flight (offline, free, before ingest): 69 `fr` / 1 `null` over
the 70 staged, 0 out-of-declared-set warnings** — the `languages: ["fr"]`
declaration is correct. After the 3 signup-page drops (all of which detected
`fr`) the set carried into ingest is **66 `fr` / 1 `null` of 67**. **Null rate
1.5% — the lowest of any source** (en 7.7%, ar 3.0%). The single
null is `/a/jesusqui.html` ("Who is Jesus?"), detected `fr` at **0.689**, just
under the 0.75 confidence gate — and, as in slice #8, it is the source's
_largest_ document (23,762 ch cleaned), not a thin one, so `DETECTION_FLOOR_CHARS`
is not involved. Per standing policy it is **excluded from the eval** and
otherwise left alone — no sweep; the dashboard's null count is the record.
⚠️ Worth noting for Stage 4: this is a flagship apologetics article, so the
exclusion has the same shape as slice #8's `/wires/loneliness.html` cost.

### 2. Ingest → corpus tables

- [x] Drain `raw_documents` → documents / chunks / chunk_embeddings (qwen3) — **67 docs / 418 chunks / 418 embeddings** <!-- sha: 4e3e0e0 -->
- [x] Verify: 1:1 counts, `documents.language = 'fr'` (invariant 6), idempotent re-run <!-- sha: 4e3e0e0 -->
- [x] Report the null-language count as evidence — no sweep, no fix (standing policy) <!-- sha: 4e3e0e0 -->

**Stage 2 evidence (2026-07-27).** All **67 pending rows drained in one pass →
67 documents / 418 chunks / 418 embeddings** — a perfect 1:1, **0 `chunk_count`
mismatches**, and a single embedding model (`qwen/qwen3-embedding-8b`, 1536d).
Chunks/doc min 1 · **avg 6.24** · max 21 — the densest of the three EveryStudent
banners (en 4.70, ar 4.22), consistent with Stage 1's finding that the French
bodies are the richest. **All 67 sit under `/a/`** — confirmation that the 3
dropped signup pages really did leave the corpus. The **idempotent re-run drains
0** (`0 inserted, 0 updated, 0 unchanged, 0 skipped`).

**The offline language pre-flight held EXACTLY at ingest: 66 `fr` / 1 `null`**,
and the null is precisely the predicted document — `/a/jesusqui.html` ("Qui était
Jésus ?"). Per-document detection (invariant 6) labelled every article off the
content, never the URL path or the `["fr"]` declaration. **Null rate 1.5% — the
lowest of any source in the corpus** (en 7.7%, ar 3.0%). Per standing policy the
null is **excluded from the eval**, not swept; the dashboard's null count is the
record.

ⓘ **Why that one document hedged, most likely.** Spot-reading it: it is a
**Scripture-compilation page** — "Ce sont des extraits tirés directement de
l'évangile de Jean, dans la Bible. **Aucun commentaire ajouté.**" Its 14 chunks
are near-entirely quoted Johannine text with no editorial French voice, which is
a plausible reason the detector sat at 0.689 rather than a length problem (it is
the source's _largest_ document, so `DETECTION_FLOOR_CHARS` is not involved).
An observation only — no action, per policy.

**Corpus now 11 sources / 11,688 docs / 34,355 chunks** (from 11,621 / 33,937).
**French is now genuinely multi-source: 225 `fr` docs** — thelife-fr 156 ·
**everystudent-fr 66** · thelife 2 · cru 1. everystudent-fr is **29.3% of the
French corpus**, so Stage-4 Part A displacement on the 10 `tlfr-*` cases is a
live possibility, not a theoretical one.

Transient OpenRouter embed timeouts occurred and **all recovered inside the retry
policy** (#64, as in slices #8/#9); **0 permanent failures**. An exact retry
count isn't available — the run's log was captured through `tail -60`, so only
the final stretch was retained (15 retries visible there).

Gate re-run **WITH** the new data: green, **441/441**.

### 3. Retrieve → ranked results

- [x] A French query returns ranked, cited hits from this source <!-- sha: ada189d -->
- [x] `language:"fr"` returns ONLY French, now that **two** French sources compete <!-- sha: 8f81d98 -->
- [x] Re-check minScore 0.37 at 11 sources — **specifically the faith-adjacent margin** (slice #9 recorded 0.382, only 0.012 above the cutoff, on a Muslim-readership probe; `/a/260islam.html` is in this seed set) — **did NOT reproduce** <!-- sha: a81e428 -->

**Stage 3 evidence — sub-step 1 (2026-07-27): French is queryable, and the
corpus is cross-lingual in three directions.** Four real French seeker questions
against the **unfiltered** 11-source space, `pnpm query --top-k 5`:

| Question                                                       | Rank 1                                                           | Score     |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| « Dieu existe-t-il ? »                                         | `everystudent-fr /a/101existe.html`                              | **0.737** |
| « Comment trouver la paix intérieure quand je suis anxieux ? » | `everystudent-fr /a/coronavirus.html`                            | **0.739** |
| « Comment puis-je connaître Dieu personnellement ? »           | `everystudent-fr /a/comment-connaitre-dieu-personnellement.html` | **0.775** |
| « Pourquoi Dieu permet-il la souffrance ? »                    | `cru …/why-does-god-allow-suffering.html` (en)                   | 0.728     |

**Rank 1 on three of four**, every hit ranked and cited off real French prose.

Two findings worth carrying:

- 🌍 **The three-banner cross-lingual match, now three-way.** « Comment puis-je
  connaître Dieu personnellement ? » returned **fr #1 · en #2 · fr #3 · `ar` #4**
  — `everystudent-fr/a/comment-connaitre-dieu-personnellement.html` (0.775),
  `everystudent.com/faq/know.html` (0.769),
  `everystudent-fr/a/trouverDieu.html` (0.766) and
  `everystudent-ar/v/personally.html` (0.722): **the same EveryStudent article in
  three languages, matched to a French query across two language boundaries.**
  Slice #9 saw this two-way (ar↔en); the #112 route being complete makes it
  three-way. (Note `/v/personally.html` is the Arabic doc whose _stored_ label is
  `null` — it is retrievable unfiltered, and only invisible under `language:`.)
- 🇫🇷 **A French question can still be best-answered in English.** « Pourquoi Dieu
  permet-il la souffrance ? » put **cru's English** suffering article at rank 1
  (0.728) over the French `/a/700horribles.html` at #2 (0.718) — the unfiltered
  space ranks on meaning, not on query language. (That #1 chunk also opens with
  the `0 100 0` AEM junk string — the known cru extraction artifact, #79.)

**Stage 3 evidence — sub-step 2 (2026-07-27): `language:"fr"` is airtight, and
the two French sources genuinely trade places.** The filter binds on the
**document**, not the query language — the slice-#9 proof re-run in French:

- **French question under `--language fr`** (« Comment puis-je connaître Dieu
  personnellement ? », top-10): 10 French docs, **all 10 `everystudent-fr`**,
  0.673–0.775. `thelife-fr` is entirely displaced on this question.
- **ENGLISH question under `--language fr`** ("how do I deal with anxiety and
  fear?", top-8): **8 French docs and nothing else** — 0.446–0.595, of which
  **7 are `thelife-fr`** and 1 is `everystudent-fr`. An English query returning
  only French documents is the filter binding on `documents.language`;
  `corpus-search-store.ts:62` is a strict `eq(…)`, so other languages **and
  NULLs** are excluded by construction.

⚖️ **Neither French source monopolises — it is query-dependent, and that is the
healthy outcome.** The same filter yields 10/10 `everystudent-fr` on a
knowing-God question and 7/8 `thelife-fr` on an anxiety question, which matches
what each banner actually publishes (everystudent = seeker apologetics,
thelife-fr = devotional life-issues). At **29.3% of the French corpus**
everystudent-fr is competing, not swamping.

⚠️ **Stage-4 Part A is now confirmed as real work, not a formality.** The
knowing-God result is a top-10 sweep by the new source in exactly the language
where 10 `tlfr-*` golden cases live. Displacement on those cases is
demonstrated, not hypothetical — re-review the living `relevant` maps before
reading any `fr` coverage movement as a retrieval regression.

**Stage 3 evidence — sub-step 3 (2026-07-27): minScore 0.37 HOLDS at 11 sources
— keep unchanged.** Re-derived from the **French** score distribution per
`docs/eval-approach.md` §4 (non-English negatives before changing the default),
all probes run at `--min-score 0` so the true top score is visible:

| Probe (French)                           | Top score         | Verdict                             |
| ---------------------------------------- | ----------------- | ----------------------------------- |
| Positives (4 real questions, unfiltered) | **0.615 – 0.775** | —                                   |
| Positives (`--language fr`, top-10)      | 0.673 – 0.775     | —                                   |
| Recette de pâtes carbonara               | 0.323             | clean reject                        |
| Apprendre à programmer en Python         | **0.384**         | crosses — noise                     |
| Installer un routeur wifi                | **0.393**         | crosses — noise                     |
| Calendrier de la coupe du monde          | **0.404**         | **not a negative** — see below      |
| Changer un pneu de voiture               | **0.421**         | crosses — noise                     |
| Quel temps fera-t-il demain à Paris      | **0.430**         | crosses — **clean-secular ceiling** |
| Les cinq piliers de l'islam              | **0.601**         | by-design adjacency — see below     |
| Les règles du jeûne pendant le Ramadan   | **0.602**         | by-design adjacency                 |

**Recommendation: keep 0.37 unchanged.** The clean-secular ceiling is **0.430**
and the French positive floor is **0.615** — 0.37 sits below a ~0.19 gap, the
same comfortable separation slice #9 described, with **both ends shifted up**.

🔧 **CORRECTION to the carried-forward watch item — the "0.012 margin" does not
reproduce, and slice #9's 0.349 clean-secular ceiling was PROBE-SET dependent,
not a corpus property.** Two things were expected here and neither held:

- **The faith-adjacent margin is not tight in French — it is wide.** The Islam
  and Ramadan probes land at **0.601 / 0.602**, ~0.23 _above_ the cutoff, not
  0.012. Both are genuine adjacency rather than noise: the Islam probe's top hit
  is `everystudent-fr /a/205divin.html` ("Description des principales religions
  dans le monde"), which really does describe Islam, and the Ramadan probe's is
  `thelife-fr /jeuner-est-ce-sain`, which really is about fasting. ⓘ Note
  `/a/260islam.html` — the doc this slice was told to watch — **topped neither
  probe**. The tightness recorded in slice #9 was specific to that slice's
  Arabic probe/corpus geometry; it is not a standing property to watch.
- **The secular floor is ~0.40–0.43 in BOTH languages — this is not a French
  effect.** Re-running the two highest crossers as English controls against the
  same corpus: "what will the weather be tomorrow in Paris" → **0.398** (the
  same `/a/725paradis.html` hit) and "how do I change a car tire" → **0.418**.
  Essentially identical to the French 0.430 / 0.421. So the crossings are a
  function of _which_ secular probes you choose, not of query language: slice
  #9's set (cooking rice, World Cup, Python) happened to be gentler than this
  one. **Read "the clean-secular ceiling is 0.349" as a measurement of that
  probe set, not of the corpus** — the honest corpus-wide figure is ~0.43.

ⓘ **Two crossings are not noise at all.** "Calendrier de la coupe du monde"
(0.404) hits cru's _"Becoming a World Cup City Champion"_ — a real World Cup
document, the same **true-positive-disguised-as-a-negative** trap slice #9 hit
with its CV probe. The carbonara probe's top hit is FamilyLife's _"Family
Recipes"_, likewise real. The genuine false positives are Python→méditation,
wifi→money-saving-tips, tire→family-baggage and weather→heaven; the last is a
neat **`Paris`/`paradis` lexical near-collision** compounded by "demain"
reading as _the hereafter_.

⚠️ **METHODOLOGY TRAP FOUND — FOLLOW-UP O bites `pnpm query`, not just
`pnpm eval`, and it fails LOOKING LIKE A RESULT.** Two secular probes first came
back with no hits, which reads exactly like a clean reject. They were not: the
fast-fail query retry posture (`QUERY_EMBED_MAX_ATTEMPTS=2`, 4 s — built for
`/v1/search` latency) had aborted the **query embedding** with
`DOMException [AbortError]`, and the grep used to tabulate scores hid the error
line. Re-run under `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000`,
both returned hits **above** the cutoff (0.421 and 0.323). A negative probe that
silently becomes a timeout is indistinguishable from a perfect reject and would
have made this table read _better_ than the truth. Run minScore probes with the
retry override, and never record a zero-hit probe without seeing its exit
status.

### 4. Spot-check / eval (`/golden everystudent-fr`)

- [x] Decide + record the Stage-4 gate (two-axis vs relevance-only) on French's multi-source evidence <!-- sha: c13c6ce -->
- [x] Part A — re-review the 10 existing `tlfr-*` cases' living `relevant` maps (NOT a no-op this time) <!-- sha: c13c6ce -->
- [x] Part B — author everystudent-fr-native cases (English translation + translated retrieved-set block, per `docs/eval-approach.md`) <!-- sha: c13c6ce -->
- [x] Full eval; report whole-corpus, per-language `fr`, and per-source numbers <!-- sha: c13c6ce -->

**Stage-4 gate DECIDED: the two-axis 0.75 rule (slice #7/#8), not slice #9's
relevance-only rule.** French is genuinely multi-source — 225 `fr` docs across
`thelife-fr` (156) · `everystudent-fr` (66) · `thelife` (2) · `cru` (1) — so the
condition slice #9's exception exists for (one source, `language:`-scoped cases,
where striking a doc _deletes_ the answer key rather than filtering it) does not
hold. Striking a doc here leaves the case with other sources' credits, which is
exactly what the two-axis gate is for. Evidence that the gate had teeth: it
rejected one document on soundness that relevance alone would have credited
(below).

**Part A evidence (2026-07-27) — the baseline, and where the drop came from.**
Pre-curation eval at 118 cases: whole-corpus recall@3 **0.941** · recall@10
**1.000** · coverage **0.723** · MRR 0.821 · P@1 0.695. **`thelife-fr` /
per-language `fr` fell 0.817 → 0.733**, and that was the ONLY source that moved:
cru, everystudent-ar, jesusfilm-org, sightline, swg, thelife and thelife-zh were
byte-identical, `familylife` moved −0.009 and `everystudent` (en) moved **+0.046
— boundary jitter in the documented direction**, not a French effect (French docs
are ineligible on English-scoped cases by construction).

The 0.084 drop localised to exactly **two cases**, both on EveryStudent's core
axis: `tlfr-skeptic-dieu-existe` (rank **1 → 4**, cov 4/4 → 2/4) and
`tlfr-newcomer-jesus` (rank 1 → 2, cov 2/3 → 1/3). Two more shifted rank with
coverage intact (`tlfr-seeker-porno` 2 → 3, `tlfr-seeker-anxiete` 1 → 3). This is
textbook displacement, exactly as Stage 3 predicted — not a retrieval regression.

**Method.** Candidate pool built from the **corpus**, never from the engine's
top-10 (slice #7's circularity trap): a deep-k fr-scoped probe at `topK=40,
minScore=0` over all 10 cases → **320 (case, doc) pairs / 151 distinct documents**
(94 `thelife-fr` · 56 `everystudent-fr` · 1 `cru`). The **0.50 floor is
calibrated, not arbitrary — it is the highest floor that excludes ZERO
already-approved documents** (credited docs bottom out at 0.511; a 0.55 floor
would have cut 3 of them). Every document was judged **whole**, with a sample
taken from _every_ chunk rather than the opening (slice #7: chunk-0 judging
rejected 75% of docs whose answer lived further in).

⚠️ **The panel was run IN-CONTEXT this session, not as 3 separate agents** —
an operator decision, because a standing session directive forbade spawning
agents. What is lost is only the inter-lens _spread_ signal, which has fired
**zero** escalations across slices #7/#8/#9 (max spread 0.20/0.25/0.35 against a
0.5 threshold) and which Guardrail #6's own caveat says must not be read as
corroboration. Both axes were still scored and gated in code.

**Result: 54 credits approved of 320 (16.9%) — 33 `everystudent-fr` + 21
`thelife-fr` prior-slice gap-fixes.** **265 rejected as SOUND-BUT-OFF-QUESTION
(83%)** — the Guardrail #6 tripwire, far above slice #7's 48% and slice #8's 61%,
because a top-40 sweep of a 225-doc corpus pulls in loosely-related material by
construction rather than because the content is worse.

🚨 **ONE SOUNDNESS REJECTION, and it is an estate-wide pattern, not an Arabic
one.** `everystudent-fr /a/700horribles.html` — the "why worship a God who allows
a child to be raped?" FAQ — scored relevance **0.82** but soundness **0.62** and
was **excluded**. The free-will defence is orthodox and it opens with real
solidarity ("un membre de ma famille proche s'est fait violer dans son enfance…
je comprends vraiment votre rage"). But mid-article it asserts, as an unevidenced
wager, « je parie que la plupart [des conseillers] diraient que **l'abus verbal**
est celui dont les conséquences sont les plus graves » — a false empirical claim
that relativises child sexual abuse downward, inside the answer to a survivor.
**This is the French sibling of the Arabic document filed under
[#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)**, so that content
problem spans the estate. Relevance alone would have credited it.

ⓘ **Two soundness checks that came back CLEAN, and one is a direct contrast with
slice #9.** `/a/709trinite.html` is doctrinally careful — "trois personnes de la
même essence divine", and it explicitly _rejects_ the H2O and egg analogies for
implying parts (~0.90). **No modalism**, where slice #9 found exactly that in the
Arabic Trinity explainer. `/a/homosexuel-lesbienne.html` is pastorally careful
(~0.88): it names the church's judgmentalism as contrary to Jesus and never
condemns. Quality is per-language, not per-ministry.

⚖️ **The new source is NOT universally relevant, and that is a real finding.**
`everystudent-fr` contributed **zero** credits to four of the ten cases —
post-abortion healing, forgiveness, Holy-Spirit-empowered living, and the
unbelieving spouse. It publishes **seeker apologetics**, not sanctification or
pastoral care; `/a/708saintesprit.html` scored rel 0.72 because it explains _who_
the Spirit is, not how to _live_ in his power. Conversely it took **15 of 20**
credits on "give me one reason a god exists". The two French sources are
complementary, not competing — the same conclusion Stage 3 reached from the
`language:"fr"` probes, now confirmed on content.

🔎 **A pre-existing curation error found and REMOVED (operator-approved).**
`tlfr-seeker-deuil-fils` credited `thelife-fr /vivre-son-deuil`, but that document
is about grieving **the loss of virginity before marriage**, not a child's death —
a slice-#5 title match ("living through your grief"). It was an unreturnable-by-
merit expectation quietly depressing the case. Removed; the guardrails' additive-
only default was overridden deliberately, by the operator.

⚠️ **COVERAGE FALLS ON PURPOSE — read rank and P@1, not coverage alone.**
Crediting genuinely-relevant documents that the engine buries below rank 10 is
what makes coverage go DOWN, and detecting buried good answers is precisely what
coverage is for. The alternative — crediting only what came back — is the
circularity slice #7 named. Rank and precision move the other way sharply.

📐 **METHODOLOGY FINDING — coverage is structurally capped at `min(1, 10/|relevant|)`.**
`tlfr-skeptic-dieu-existe` now carries **20** relevant docs, so its ceiling is
**0.50**; it scores 0.45, meaning **9 of its 10 top-10 slots are credited docs** —
near-perfect performance that raw coverage reports as "bad". Ceiling-normalised,
the ten French cases average ~**0.72**. Any case with more than 10 relevant docs
is scored against an unreachable 1.0. **Filed in `docs/eval-approach.md` as
authoring trap 3.**

**Part A confirmed (eval @ 118 cases, post-curation).** Whole-corpus recall@3
**0.941 → 0.949** · recall@10 1.000 · coverage 0.723 → 0.721 · MRR **0.821 →
0.843** · P@1 **0.695 → 0.729**. Per-language `fr` 0.733 → **0.681**, exactly the
predicted trade: **nine of ten French cases moved to rank 1** (from six) while
coverage fell because 54 genuinely-relevant documents entered the keys, many of
them buried below rank 10. **Every per-case coverage prediction made before the
run landed exactly** — 5/9 · 9/20 · 6/8 · 4/6 · 6/6 · 6/10 · 6/9 · 2/4 · 5/8 ·
8/8 — which is the strongest available check that the judging and the rank model
were sound rather than lucky.

**Part B evidence (2026-07-27) — 12 everystudent-fr-native cases, qa-golden.yaml
118 → 130.** Drafted against the 66 creditable docs, targeting the axes neither
the `tlfr-*` cases nor Part A touch: world religions, purpose, death/afterlife,
hell, the Trinity, self-image, sexuality, unanswered prayer, Islam, denominations,
racism/women's rights, marriage. **39 credits — 26 `everystudent-fr` + 13
`thelife-fr`.** Personas newcomer ×3 · seeker ×5 · skeptic ×3 · believer ×1 — the
believer thinness is **honest**, matching Part A's finding that this source
publishes seeker apologetics, not sanctification.

Every question was run through the wired Retriever **before** being finalised, and
**two were rephrased because the first draft echoed the article's own title**
(Guardrail #1). One of those rephrasings found something real:

- 🔍 **`esfr-skeptic-enfer` — a genuine VOCABULARY GAP.** The soft draft ("how can
  a God of love condemn someone to suffer for eternity?") put `/a/726enfer.html`
  at **rank 1 @ 0.749**. Rephrased to how a skeptic actually argues it — « un
  châtiment infini pour une vie finie » — **that document falls out of the top 8
  entirely.** The honest phrasing was kept so the eval _records_ the gap instead
  of hiding it; the case duly reports rank 2, cov 2/3. Same shape as slice #3's
  `jf-believer-disciple-making` gap.
- **`esfr-newcomer-catholique`** first scored **0.836**, the highest of any probe —
  because it restated the article title almost verbatim. Reframed as a family
  situation it still ranks 1, at an honest 0.767. _A very high score on a new case
  is a paraphrase smell, not a success signal._

**All 116 credited (source, path) pairs were verified against the DB to resolve to
exactly one document** before the final run — no typos, no ambiguous suffix
matches, so no unreturnable expectation was baked in.

**FINAL EVAL @ 130 cases / 11 sources: recall@3 0.954 · recall@10 1.000 ·
coverage 0.736 · MRR 0.854 · P@1 0.746.** Every headline metric is **UP** on the
118-case pre-curation baseline (0.941 / 1.000 / 0.723 / 0.821 / 0.695).

- **`everystudent-fr` enters at n=18, recall 1.000, coverage 0.856** — the
  second-strongest source in the corpus after `everystudent-ar` (0.979).
  **11 of its 12 native cases rank 1**; the only rank-2 is the deliberately-hard
  hell question.
- **`thelife-fr` recovers to 0.778** (n 10 → 18) — the Part-A dip to 0.650 was the
  transient state of a half-curated key, not a standing cost. **Per-language `fr`
  0.804 across 22 cases.**
- **Every other source is unchanged or oscillating within the documented jitter
  band.** `everystudent` (en) read 0.693 here vs 0.739 in the previous run — the
  same `/forum/contradictions.html` rank-10/11 doc sitting on a 0.001 gap
  (slice #9's finding, now observed a third time); `sightline` 0.571 → 0.563
  likewise. **French docs are ineligible on English-scoped cases by construction**,
  so neither can be a French effect.

ⓘ **Two soundness observations recorded for the future**, both above the gate and
neither actioned: `/a/260islam.html` explains the Trinity with "1x1x1=1", which is
mathematically vacuous though not heretical (it was left uncredited on the Trinity
case for that reason); and `/a/homosexuel-lesbienne.html` never addresses the
ethical question at all, redirecting wholly to the gospel — sound, but a real
limitation for the reader who asked.

## Decisions made (this slice)

- 2026-07-27 — **WALLED → `fetchStrategy: "firecrawl"`** (ADR-0012). Probed live:
  `/robots.txt` answers **200**, but the homepage, `/a/102rien.html` and
  `/sitemap.xml` all return **403** carrying the Cloudflare block-page signature
  (`<title>Attention Required! | Cloudflare</title>`). Same posture as both
  siblings. Classified on the block-page signature, not on a `challenge-platform`
  script reference (which false-positives).
- 2026-07-27 — **Seed-only, 70 of the 87 mapped URLs; `sitemaps` deliberately
  absent.** Discovery was already paid for by `/v2/map` (#114, 1 credit flat,
  inventory preserved as a comment there); re-discovering would re-pay for
  knowledge we already hold. Body = **67 `/a/` articles** + 3 provisional root
  pages. Dropped 17: the bare homepage, **12 `/m/*`** menu/section indexes
  (`enigmes`, `existence`, `experience`, `faq`, `intl`, `jesus`, `lavie`,
  `legales`, `qetr`, `qui`, `relations`, `videos`), `/contact1.html`,
  `/plan.html` (the "plan du site" sitemap page — mirrors the en entry dropping
  `/sitemap.html`), and the two `.php` extension twins `/aventure.php` +
  `/jean.php` (same slug served twice; keeping both would pay a credit for a
  duplicate document the content hash cannot collapse across differing URLs).
- 2026-07-27 — **the 3 provisional root pages are DROPPED; ingest takes the 67
  `/a/` articles and nothing else** (operator fork, resolved on Stage-1
  evidence). `/jean.html`, `/jeanFR.html` and `/aventure.html` all cleared
  `minContentLength` comfortably (1,949 / 2,020 / 2,453 ch) — which is precisely
  why the floor could not decide it: **length is not aboutness**. The fetch
  showed all three are **email-signup landing pages**, not seeker Q&A:
  - `/jean.html` ↔ `/jeanFR.html` share **87.9% of their 12-word shingles** —
    one sign-up page for a Gospel-of-John email study with sentences reordered.
    That is the same band as the 93.8% podcast/article overlap slice #8
    dropped, and the document-level content hash cannot collapse
    near-duplicates living at different URLs.
  - all three close with an **identical 850-char French GDPR privacy notice**
    (Agapé France, loi « informatique et libertés ») — **44% / 42% / 35%** of
    their bodies, and the only text the three share. It would embed as pure
    noise and could match privacy/legal queries.
  - what is left is form copy ("S'inscrire ici", unsubscribe terms).
    The 3 credits are sunk and unrecoverable, but the seeds are removed so a
    re-crawl never re-pays for them, and the 3 rows were deleted from
    `raw_documents` before ingest. Seed set 70 → **67**.
- 2026-07-27 — ⓘ **Observation, NOT actioned by this slice: the Arabic banner's
  `/john.html` and `/pack.html` are the SAME two pages** (the John email study
  and the "Spiritual Adventure" 7-email series), kept in slice #9 on the same
  provisional call and **live in prod today**. The estate is therefore
  inconsistent: French ingests articles only, Arabic carries two signup pages.
  Recorded for a future cleanup — slice #10 deliberately does not touch prod, and
  no issue was filed (operator's call).
- 2026-07-27 — **robots.txt is `User-agent: * Allow: /`** (checked live). Nothing
  disallowed, so no seed dropped on robots grounds — same as `everystudent-ar`,
  unlike `everystudent` (en), which carries a real disallow list. No `block`
  array: `block` filters DISCOVERED urls and a seed-only source discovers none.
- 2026-07-27 — **Language plan: declared `["fr"]`, detected per document.** All
  87 mapped URLs sit under one French banner (`/m/intl.html`, the page linking
  out to sibling languages, is dropped). The stored label still comes from
  content detection at ingest (invariant 6, ADR-0006) — never from this field,
  the URL path, or `<html lang>`. Null-language docs are **expected**, permanently
  **excluded from the eval**, and reported as an observation; `pnpm lang:sweep` is
  a prod-only corrective tool and is not a step in this slice.
- 2026-07-27 — **Prod promotion path is the bulk-copy** (`scripts/copy-raws.sh`
  → `pnpm index:production` → `pnpm eval:production`), **never
  `acquire:production`** — this is a walled source, and re-acquiring in prod would
  re-pay ~70 Firecrawl credits. See `docs/ops/copy-raws.md`.

## Budget

**~70 credits at the measured 1.00 cr/page** (70 paid; 67 ingested) (#114 — Firecrawl's `basic` proxy
clears this host, so `auto` never escalates to the 5-credit enhanced retry).
Balance checked live 2026-07-27: **828 remaining of 1,000**, billing period ends
**2026-08-21**. Comfortable — this closes #112's route with ~758 to spare.

⚠️ **Cost guard:** watch the credit delta over the first ~10 pages. If the rate
is 5 cr/page, Cloudflare has tightened (~350 total) — stop and re-plan.

## Prod promotion (2026-07-27) — DONE via the #115 bulk-copy path

`everystudent-fr` is the **third source promoted through `copy-raws.sh`** and
closes the #112 route in prod (en ✅ → ar ✅ → fr ✅). `acquire:production` was
deliberately NOT run — it would re-pay the ~70 Firecrawl credits already spent at
Stage 1. Mechanism: `docs/ops/copy-raws.md`.

Sequence run against prod (`zephyr.proxy.rlwy.net`):

1. **Copy** — a `--dry-run` first confirmed the target host, **0 existing rows**
   (empty-target guard satisfied) and the `id`+`ingested_at` column omission.
   `copy-raws.sh --source everystudent-fr` then copied **67 rows** local→prod
   (0 → 67, all landing `ingested_at IS NULL` — the gotcha-fix held for a third
   time). Verified by the deterministic ordered row-level digest over all 11
   copied columns, **with `SET TIME ZONE 'UTC'` pinned on both sides** per slice
   #9's refinement: `md5(string_agg(md5(row) ORDER BY canonical_url))` returned
   **`8e9ec570d09affcfbbd7a5fa7baad8b7`** on **both** sides at 67 rows — row-for-row
   equality, not merely matching totals.
2. **Embed** — `index:production --source everystudent-fr` drained all 67 pending
   → **67 docs / 418 chunks / 418 embeddings** on `qwen/qwen3-embedding-8b`: an
   exact match of local, with **0 `chunk_count` mismatches**, a single embedding
   model, **0 rows left pending**, and the language split preserved (**66 `fr` /
   1 `null`** — the same `/a/jesusqui.html` Scripture-compilation page). Confirmed
   beyond aggregate totals by the **per-document fingerprint**
   (`canonical_url|language|chunk_count|content_hash` digested in url order):
   **`5739cf2f273df42c115a866840055cad`** on both sides, so every document landed
   with an identical chunk split and language label.
   Prod corpus 11,661 → **11,728 docs** / 34,016 → **34,434 chunks**, 11 sources.
   - ✅ **Zero embed retries — the first promotion of the three to miss the
     OpenRouter slow spell.** `copy-raws.md` says to _expect_ it on both metered
     steps (everystudent-ar took 34 retry lines, longest chain 6 of 10). This run
     logged **none**, on the largest chunk count of the three banners. The patient
     corpus policy is still right; "expect it" is a preparedness note, not a law.
3. **Smoke** — `retrieve:production` (unfiltered, `--top-k 5`, matching Stage 3)
   reproduced all four French questions within float noise: « Dieu existe-t-il ? »
   → `/a/101existe.html` **rank 1 @ 0.735** (local 0.737); « Comment trouver la
   paix intérieure quand je suis anxieux ? » → `/a/coronavirus.html` **rank 1 @
   0.739** (local 0.739); « Comment puis-je connaître Dieu personnellement ? » →
   `/a/comment-connaitre-dieu-personnellement.html` **rank 1 @ 0.773** (local
   0.775). 🌍 **The three-way cross-lingual match holds in prod** — that third
   query returned **fr #1 · en #2 · fr #3 · `ar` #4**, the same EveryStudent
   article in three languages answering one French query, exactly the local
   Stage-3 pattern. The fourth (« Pourquoi Dieu permet-il la souffrance ? ») again
   put **cru's English** article at rank 1 @ 0.727 (local 0.728) over the French
   `/a/700horribles.html` at **rank 2 @ 0.718** (local 0.718) — the unfiltered
   space ranks on meaning, not query language, in prod too.
4. **Certify** — `eval:production --source everystudent-fr` over 18 cases:
   recall@3 **1.000** · recall@10 **1.000** · coverage **0.848** · MRR **1.000** ·
   P@1 **1.000** — **all 18 at rank 1**. Per-source **`everystudent-fr` n=18
   recall 1.000 / coverage 0.856 — identical to local to three decimals**;
   `thelife-fr` n=14 recall 1.000 / coverage 0.826 (a different denominator from
   the local whole-corpus row's n=18/0.778 — **not** comparable directly).
   Record: `eval/results-2026-07-27-everystudent-fr-prod-keep.md` (named
   `-prod-` because the local whole-corpus run already holds
   `results-2026-07-27-everystudent-fr-keep.md`).
   - **Per-case: coverage identical on all 18; exactly one rank moved.**
     `esfr-skeptic-enfer` went **rank 2 → rank 1**, and it is **boundary jitter,
     not drift**: local's first credited hit was `/a/260islam.html` @ **0.616**,
     prod's was thelife-fr `/10-questions-spirituelles-avec-reponses` @ **0.615** —
     a **0.001** gap reshuffling, the same pattern STATUS records three times for
     `everystudent`'s `/forum/contradictions.html` (rank 10 @ 0.648 vs rank 11 @
     0.647). Coverage held at 2/3, so the same credited set returned; only the
     order changed. ⓘ It slightly qualifies the Stage-4 "vocabulary gap" framing:
     the gap itself is real (`/a/726enfer.html` still falls out of the top 8), but
     **this case's rank-1-vs-2 reading is not stable between runs.**

🔑 **CORRECTION to `copy-raws.md` — the drift predictor is whether the LANGUAGE
SUBCORPUS differs, not whether the language is single-source.** The runbook
predicted this promotion would drift ("the moment a second source shares the
language … real neighbours return and so does real drift — an exact match there
would be the surprise"). Coverage matched **exactly, on every one of the 18
cases.** The reason is measurable: **prod carries 40 more docs than local**
(11,728 vs 11,688) — `thelife` +30, `sightline-ministry` +9, `jesusfilm-org` +1 —
and **every one of them is English**. The French subcorpus is _identical_ on both
sides (225 `fr` docs: thelife-fr 156 · everystudent-fr 66 · thelife 2 · cru 1),
and `corpus-search-store.ts:62` is a strict `eq(documents.language, …)`, so
`fr`-scoped cases cannot see those 40 docs. Multi-source competition does **not**
create drift when the competitors are byte-identical in both environments — and
notably those same ~40 docs are exactly what the runbook blamed for the English
promotion's ~0.09 gap. Restated rule: **a language-scoped eval drifts iff that
language's subcorpus differs local↔prod.** Sole-source-ness was a confound, not
the cause.

🚨 **`/a/700horribles.html` — the [#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)
escalation document — is now LIVE in prod and demonstrably served**, at **rank 2
@ 0.718** on a natural French suffering question in the _unfiltered_ space. Stage
4 rejected it on soundness (0.62 against relevance 0.82) for relativising child
sexual abuse downward inside the answer to a survivor. As with the Arabic
`/a/endingthe8th.html` before it, **excluding it from an answer key never stopped
the RAG serving it** — the promotion has made that concrete rather than
hypothetical, and the fix remains content-side.

## Open question / blocker

- none

## Resume hint (for a cold start)

**SLICE COMPLETE — all four stages green, source Evaluated, 2026-07-27.** Nothing
to resume. `everystudent-fr` is queryable and evaluated in the 11-source corpus:
67 docs / 418 chunks, final eval @ 130 cases **recall@3 0.954 · recall@10 1.000 ·
coverage 0.736 · MRR 0.854 · P@1 0.746**, the source itself at **n=18 recall
1.000 / coverage 0.856**.

**PROMOTED TO PROD 2026-07-27** via the bulk-copy path — 67 docs / 418 chunks /
418 embeddings live in the prod corpus, certified at coverage 0.856 (identical to
local). See "Prod promotion" above. **As in slice #9, prod now leads `main` on
this source** — the branch is still unmerged and unpushed.

Next actions are the operator's, in this order:

1. **Merge `slice/everystudent-fr` → `main`** (not done; nothing is pushed, no PR
   opened). This is the only remaining step to close the slice.
2. ~~**Promote to prod via the BULK-COPY path**~~ — **DONE 2026-07-27.** Copy
   digest and per-document fingerprint both matched local↔prod; `eval:production`
   reproduced the local coverage exactly. **Never `acquire:production` for this
   source** — it is walled and the credits are already spent.
3. **Triage [#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)** —
   now live-confirmed in prod for French as well (`/a/700horribles.html` at rank 2
   on a natural suffering question), alongside the Arabic `/a/endingthe8th.html`.
4. `/slice <next-source>` — GotQuestions / KnowGod / Issues I Face.

⚠️ Standing hazard for any future run here: **`pnpm eval` and `pnpm query` inherit
the fast-fail query-embed posture (FOLLOW-UP O)** and a timeout looks exactly like
a clean zero-hit result. Always run
`QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 …` for batch evals and
minScore probes, and never record a zero-hit probe without checking its exit status.

Last verify: green @ 2026-07-27. Branch: slice/everystudent-fr.
