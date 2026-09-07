# Slice: Cru — 10 Basic Steps (cru-10-basic-steps)

_Branch: `slice/cru-10-basic-steps` · Started: 2026-05-25 · Status: done (2026-05-25)_

<!-- Status: in-progress | blocked | done -->

## Goal (architecture altitude)

Get Cru's "10 Basic Steps Toward Christian Maturity" (a new-believer discipleship
curriculum, a scoped sub-corpus of cru.org) queryable end-to-end: acquire → ingest
→ retrieve → spot-check. This is **slice #2**, chosen after examining jfa's registry
(see `docs/jfa-registry-findings.md`): jfa hands us **12 ready-made curated URLs**,
cru.org is content-reachable (probed 200, no challenge), it's genuinely on-mission,
and it fits our current hand-listed `seedPaths` code with **no crawler rebuild**.
It **reuses all of slice #1's machinery** (Acquisition / Ingestion / Retrieval
contexts, fetcher, embedder, Postgres adapters, eval harness). As the first slice
with a **second** ingested source it unblocks two deferred pieces: **per-source eval**
and **FOLLOW-UP E** (`excludedSourceKeys`, surfaced at close).

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents

- [x] Probe the 12 jfa Cru URLs at the **content level** (all reachable, no Cloudflare challenge) + found the real content selector: **`.article-long-form`** (AEM long-form component; jfa's `.article-content` guess is absent). Verified against `/4-prayer.html` (2.8k chars) + `/5-the-bible.html` (7.1k chars) — clean lesson prose w/ attribution; only Material-icon ligatures + `.article-share` needed stripping. <!-- sha: 562b798 (probe) -->
- [x] Added the `cru-10-basic-steps` `SourceEntry` (`src/registry/cru-10-basic-steps.ts`) — 12 curated seed paths, `contentSelectors:['.article-long-form',…]`, strip Material-icons/share/chrome, 2000ms delay; wired into `SOURCES`; extended `registry.test.ts` (Cru-specific + key-uniqueness). Verify green, **65 tests**. <!-- sha: 85fa3db -->
- [x] Live `pnpm acquire --source cru-10-basic-steps`: **staged 11/12** (the `10-basic-steps.html` index page correctly skipped as too-thin — no lesson prose). All 11 rows status 200, body_hash present; chars min 2525 / avg 4688 / max 10132. Spot-read clean (real Bill Bright curriculum prose + attribution, leading accordion-section TOC is minor). Recorded in `sources.md` (→ Acquired). <!-- sha: 43275c1 -->

**Stage 1 (Acquire) complete — verify green, 11 clean lesson rows in `raw_documents`.**

### 2. Ingest → corpus tables

- [x] Live `pnpm index --source cru-10-basic-steps` → documents / chunks / embeddings (`openai/text-embedding-3-small`); chunk counts sane; idempotent re-run drains 0. (No new code expected — reuses the Ingestion context.) **Result:** drained all 11 pending raw rows → **11 docs / 35 chunks / 35 embeddings**; 0 chunk_count mismatches (declared=actual); chunks/doc min 2 / avg 3.2 / max 6; embeddings all `openai/text-embedding-3-small` @ **1536 dims** (consistent with starting-with-god — no model footgun). Idempotent re-run drained **0** pending, wrote 0 chunks, count held at 35. Verify gate green (depcruise/lint/typecheck/65 tests). <!-- sha: 30b7092 -->

**Stage 2 (Ingest) complete — verify green, 11 docs / 35 chunks / 35 embeddings, idempotent.**

### 3. Retrieve → ranked results

- [x] Live `pnpm query "<10-basic-steps topic>"` → ranked, cited hits from this source; confirm on-topic + each cited. (No new code expected — reuses the Retrieval context.) **Result:** cru-10 surfaces correctly in the **whole-corpus** ranking (both sources coexist, right source wins by topic) and **in isolation** (`--source cru-10-basic-steps`), every hit cited to its `cru.org` lesson URL. Wins rank 1 on Witnessing (0.663), Abundant Life (0.604), Obedience (0.634, clean prose); rank 2 on Prayer (0.564) + Holy Spirit (0.643) behind relevant SwG pages. **Wrinkle for Stage 4:** the leading accordion-section TOC chunk sometimes surfaces instead of lesson prose (seen on Giving / Abundant Life) and cru-10 scores a bit lower than SwG; on "how to study the Bible" SwG swept top 3 and cru-10's Step 5 didn't place. Not a blocker — eval will quantify recall impact. <!-- sha: 0f9c1bd -->

**Stage 3 (Retrieve) complete — verify green, cru-10 retrievable + cited, two sources coexist.**

### 4. Eval + spot-check (+ unblocked cross-source work)

- [x] **Per-source eval mechanism** (deferred to slice #2 in slice #1's decision log): add a `source` tag to the golden schema + `pnpm eval --source <key>` scoped run + a per-source breakdown in the whole-corpus run. Test coverage as appropriate. **Result:** required `source` tag on the golden schema; `--source <key>` filters cases but retrieves **whole-corpus** (so the scoped number == that source's breakdown row — one source of truth, exposes cross-source interference); whole-corpus run prints + writes a per-source breakdown; scoped runs write `results-<date>-<source>.md`. Pure scoring/reporting logic split into `scripts/eval-metrics.ts` (unit-tested from `tests/` since vitest excludes `scripts/`) — **+15 tests, 80 total**. Backfilled the 10 SwG cases; `/golden` skill now emits `source`. **Finding (for sub-step 3):** scoped swg run dropped to recall@8 **0.90** (was 1.00) — `swg-newcomer-gospel`'s expected doc fell out of top-8, displaced by 3 cru-10 chunks scoring 0.469–0.472 (ranking competition, **not** a minScore cutoff issue). <!-- sha: cdccfc0 -->
- [x] Author Cru 10-Basic-Steps golden cases via `/golden` (persona-diverse), tagged `source: cru-10-basic-steps`. **Result:** 10 operator-approved positives (Believer ×4 / Newcomer ×3 / Seeker ×2 / Skeptic ×1), each grounded in a real lesson + persona-voiced (not title paraphrase); 4 off-topic negatives recorded above. Step 1 (assurance) left uncovered (SwG's strong suit). Scoped validation run (`--source cru-10-basic-steps`, whole-corpus retrieval): recall@3 **0.70** · recall@8 **0.90** · MRR **0.44** · P@1 **0.20**. One miss — `cru-seeker-finances` (Step 8 Giving) fell out of top-8; `cru-believer-bible-study` barely placed (rank 7). cru wins rank 1 only on guidance + abundant-life (P@1 0.20) — it rarely tops SwG in shared space. <!-- sha: 3dd7baa -->
- [x] Run the **whole-corpus** `pnpm eval` (now 2 sources: starting-with-god + cru-10-basic-steps) → re-confirm/re-derive `minScore` (FOLLOW-UP A: expect drift toward — not below — the 0.35 floor as breadth grows); write `eval/results-YYYY-MM-DD.md`. **Result:** 20-case whole-corpus run → recall@3 **0.80** · recall@8 **0.90** · MRR **0.62** · P@1 **0.45** (local scratch `eval/results-2026-05-25.md`, gitignored — numbers recorded here). Per-source breakdown **equals** the scoped runs exactly (cru 0.70/0.90/0.44/0.20; swg 0.90/0.90/0.80/0.70) — the "scoped == breakdown row" design holds. **`minScore` HOLDS at 0.37** (FOLLOW-UP A re-confirmed in architecture.md): clean off-scope negatives score ≤0.28 (eschatology) / ~0.14 (secular) — noise floor did not rise; the "no-answer Christian query" (dating/marriage) returns nearest content at 0.40–0.43 (a consumer relevance call per §1, not a cutoff target). **Both misses are displacement, not cutoff:** gospel's expected doc is rank 9 @ 0.468 (out-ranked by 8 chunks @ 0.469–0.502), finances' Step 8 (Giving) absent from top-15 ("money stress" pulls SwG worry/trust content; Giving is about stewardship — a case-framing mismatch). **SwG out-ranks cru on shared topics** even when cru matches (holy-spirit top hit = SwG spirit-filled 0.684; bible-study top hit = SwG bible 0.632) — SwG's Q&A-shaped articles embed better against natural questions than cru's curriculum format; hence cru P@1 0.20. Verify gate green (80 tests). <!-- sha: cb53cd6 -->
- [x] Spot-check: persona positives + off-topic negatives via `pnpm query`; record findings in `sources.md` (→ Evaluated). **Result:** cru source-scoped positives return the right lessons cited to `cru.org` URLs (recall solid). Negatives at the live 0.37 cutoff: clean off-scope (eschatology / sourdough) → **0 hits**; "find a church" → fellowship content (0.53, fair); "dating/marriage" (absent from corpus) → nearest general SwG content @ 0.39–0.43 (consumer-relevance boundary, §1). **Accordion-TOC wrinkle confirmed costing citation quality:** for "abundant life" the #1 cited cru chunk (0.601) is the leading section-list TOC, not teaching prose — right doc/URL (recall fine) but a poor snippet; extraction-side, candidate follow-up. Cru row → **Evaluated** in `sources.md`. <!-- sha: 21b3b6c -->

**Stage 4 (Eval + spot-check) complete — verify green (80 tests); cru-10-basic-steps Evaluated; minScore 0.37 held.**

### Eval approach — reframed (DONE 2026-05-25, `8fbee09`)

The per-source mechanism first shipped here (v1) used single-source expected docs, which
distorted shared-topic questions (the cru "P@1 0.20" artifact). Reviewing it with the operator
produced a better model, **now implemented** and documented in
**[docs/eval-approach.md](../eval-approach.md)**:

- Cases are **source-agnostic questions** + a multi-source `relevant` map listing every doc (any
  source) that legitimately answers them. The relevant set is **living** — when a source is added,
  **re-review prior questions** for newly-relevant docs, not just author new ones.
- Scored on **recall@3 / recall@10 / coverage** (P@1/MRR secondary) at **top-10**, plus per-source
  coverage. Engine default `topK=5` unchanged.
- The 20 cases were re-authored with operator-curated multi-source relevant sets;
  `cru-seeker-finances` → `cru-stewardship` (its real target — Step 8 is stewardship, not
  money-anxiety; now rank 1).
- **v2 whole-corpus baseline:** recall@3 **0.95** · recall@10 **1.00** · coverage **0.896** ·
  MRR 0.881 · P@1 0.80; per-source coverage **cru 0.929** / swg 0.906. The v1 cru P@1 0.20
  artifact is **resolved** — cru content surfaces reliably when relevant.

## Seed URLs (from jfa `cru-10-basic-steps`, paths relative to https://www.cru.org)

```
/us/en/train-and-grow/10-basic-steps.html                                  (index)
/us/en/train-and-grow/10-basic-steps/intro-the-uniqueness-of-jesus.html
/us/en/train-and-grow/10-basic-steps/1-the-christian-adventure.html
/us/en/train-and-grow/10-basic-steps/2-abundant-life.html
/us/en/train-and-grow/10-basic-steps/3-the-holy-spirit.html
/us/en/train-and-grow/10-basic-steps/4-prayer.html
/us/en/train-and-grow/10-basic-steps/5-the-bible.html
/us/en/train-and-grow/10-basic-steps/6-obedience.html
/us/en/train-and-grow/10-basic-steps/7-the-christian-and-witnessing.html
/us/en/train-and-grow/10-basic-steps/8-giving.html
/us/en/train-and-grow/10-basic-steps/9-the-old-testament.html
/us/en/train-and-grow/10-basic-steps/10-the-new-testament.html
```

## Eval negatives (cutoff calibration — NOT in qa-golden.yaml)

Off-topic for the 10-Basic-Steps curriculum; used to eyeball the `minScore` floor
(they should score below where the positives cluster). Kept here, not in the
golden file, since `eval.ts` would miscount a no-match case as a miss.

- "How do I find a good local church to join near me?" — logistics, off-scope.
- "What does the Bible say about dating and marriage?" — relationships, off-scope (FamilyLife territory).
- "When is the world going to end and what are the signs?" — eschatology, off-scope.
- "What ingredients do I need to bake sourdough bread?" — pure-secular control (~0 expected).

## Decisions made (this slice)

- 2026-05-25 — **Slice #2 = `cru-10-basic-steps`**, after examining jfa's registry (`docs/jfa-registry-findings.md`). Rationale: ready-made 12-URL curation, cru.org content-reachable, on-mission new-believer discipleship, fits current `seedPaths` code with no crawler change. Two prior candidates parked: **EveryStudent** `blocked` (Cloudflare JS challenge, jfa-confirmed — `everystudent.md`) and **NextStep** `deferred` (8-page marketing site, jfa-confirmed — best as the FOLLOW-UP E seasonal fixture). The `slice/cru-10-basic-steps` branch carries both records forward to `main`.
- 2026-05-25 — **Discovery-crawl + Cloudflare bypass deliberately NOT taken here.** jfa reveals the discovery-crawl model (architecture §11 FOLLOW-UP F) and the walled-source problem (FOLLOW-UP G); both are written up and triggered by a _large_ / _walled_ source, not this small curated scope. Slice #2 stays on the hand-listed `seedPaths` path.
- 2026-05-25 — **Seed sourcing = reuse jfa's curated URLs** (the human curation is the expensive part; we lift the 12 URLs + selector hints, adapted to our registry types).

## Open question / blocker

- **Extraction wrinkle (not a blocker): Cru is Adobe AEM with no clean content
  wrapper.** Probe 2026-05-25: all 12 seed URLs reachable, **no Cloudflare
  challenge** (9/12 returned 200 cleanly; 3 intermittent timeouts on large ~115KB
  AEM pages under fast 0.5s spacing — slowness, not blocking; our 1500ms delay +
  idempotent re-runs handle stragglers). jfa's guessed `.article-content` /
  `.content-body` selectors are **absent** from the live page; structure is AEM
  (`cmp-container`, `data-cmp`, `aem-Grid`) wrapped in `header`/`nav`/`footer`/
  `breadcrumb` + 9 `experiencefragment` chrome blocks, no `<main>`. So extraction
  must be **body-minus-chrome** (mirroring jfa's org-pages approach: take a broad
  container, strip nav/header/footer/breadcrumb/experiencefragment), **verified
  against real lesson prose** before the registry entry is committed.

## Slice complete (2026-05-25)

**All four stages green; cru-10-basic-steps is queryable end-to-end and Evaluated.**
Final state: 11 docs / 35 chunks / 35 embeddings; whole-corpus eval recall@3 0.80 /
recall@8 0.90 / MRR 0.62 / P@1 0.45 over 20 cases / 2 sources; cru-10 breakdown
0.70/0.90/0.44/0.20 @ minScore 0.37 (held). Branch `slice/cru-10-basic-steps` is **not
yet merged** — operator decides merge → `main`. **FOLLOW-UP E (`excludedSourceKeys`) is now
unblocked** (2nd source end-to-end) → [#6](https://github.com/JesusFilm/jesusfilm-rag/issues/6).
**New candidate follow-up:** strip the AEM accordion-section TOC during acquisition (Cru) so
the top-cited chunk is teaching prose, not a section list — citation-quality, not recall.

## Resume hint (superseded — slice done)

At: **Stage 4 (Eval + spot-check) — sub-steps 1–3 DONE, resume at sub-step 4 (the last).**
Stages 1–3 complete & verify-green; corpus holds **11 docs / 35 chunks / 35 embeddings** for
cru-10-basic-steps. Committed: sub-step 1 (per-source eval mechanism, `cdccfc0`), sub-step 2
(10 cru golden cases + 4 negatives, `3dd7baa`), sub-step 3 (whole-corpus eval; minScore
**0.37 holds**, `cb53cd6`). Whole-corpus eval = recall@3 0.80 / recall@8 0.90 / MRR 0.62 /
P@1 0.45; breakdown cru 0.70/0.90/0.44/0.20, swg 0.90/0.90/0.80/0.70. **Next concrete action
(sub-step 4 — final):** spot-check by eyeball — run a few cru persona positives + the 4
negatives via `pnpm query` (whole-corpus + `--source cru-10-basic-steps`), confirm cited
hits are on-topic and **check whether the accordion-TOC chunk is the cited snippet** (Stage
3 wrinkle — does it cost citation quality?); then record the eval outcome in `sources.md`
(Cru row → **Evaluated**, with results), set this slice file Status → `done`, update
`STATUS.md` (move slice #2 to Done; next slice as Next action), and **surface FOLLOW-UP E
(`excludedSourceKeys`) — now unblocked** (2 sources end-to-end). Offer (don't auto-do)
merge of `slice/cru-10-basic-steps` → `main` and/or the next slice. **Carry-forward findings
to mention:** finances miss = case-framing mismatch (money-anxiety vs stewardship); gospel
miss = cross-source displacement; cru P@1 low because SwG Q&A articles out-embed cru's
curriculum format. Branch `slice/cru-10-basic-steps` carries EveryStudent (blocked) +
NextStep (deferred) forward; off merged `origin/main` (`da037f5`). Last verify: green
(depcruise / typecheck / lint / **80 tests**). Branch: slice/cru-10-basic-steps.
