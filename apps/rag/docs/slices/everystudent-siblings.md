Warning: truncated output (original token count: 66894)
Total output lines: 4348

# Campaign: EveryStudent non-walled sibling domains (48 sources) — [#111](https://github.com/JesusFilm/jesusfilm-rag/issues/111)

_Historical branch: `feat/everystudent-siblings` · Started: 2026-07-28 · Final
PR: [#139](https://github.com/JesusFilm/jesusfilm-rag/pull/139), merged
2026-08-06_

> **Forge migration note (2026-09-04):** this is the complete historical
> campaign record. Its session instructions and August 6 pre-merge board are
> retained as evidence, not as current status. The campaign PR merged; use
> `apps/rag/docs/source-status.yaml` for current lifecycle state.

<!-- Status: in-progress | blocked | done | deferred -->

> **Historical operating instruction:** agents running the campaign read this
> whole file and resumed at "You are here" without chat history. This was a
> **campaign file**, not a `/slice` file; running `/slice` 48 times was the exact
> workflow it existed to avoid.

---

## 0. Board — OPEN EVERY SESSION WITH THIS

🔴 **Mandatory, both directions.** **Start** every session by rendering §0 back
to the operator as the tables below — that is how Jaco wants the state
delivered, not as prose. **End** every session by regenerating it (§0.1) so the
next one starts from truth. A stale board is worse than none: it is the exact
failure `docs/STATUS.md` hit on 2026-07-17, when a narrative doc reported a
finished cutover as pending.

**Last regenerated: 2026-08-06, end of session — after BATCH 2 (all 30 remaining
sources, tiers B+C+D) was drafted in parallel, approved in one turn, written,
committed and measured, and after the mandatory CLOSING PART A SWEEP ran clean.
🎉 PHASE 5 IS COMPLETE: 44 of 45 acquired sources have a golden suite.**

**47 of 48 registered · 45 acquired · 2 deferred · 1 open · 2,281 documents ·
0 duplicate-content groups · 0 doctype leaks · 0 null-language**

> ✅ **PHASE 6 IS DONE — THE CAMPAIGN IS PUSHED AND THE PR IS OPEN.**
> **[PR #139](https://github.com/JesusFilm/jesusfilm-rag/pull/139)** — one PR for
> all 48 sources, exactly as the operator specified on 2026-07-28.
> **30 commits · 163 files · +54,943 / −14.** Awaiting review; **not merged.**
> `.tmp-diag/` is git-ignored and must NOT be committed; `eval/results-*.md` is
> ignored except `*-keep.md`.

**Phases 1–2 CLOSED. Phase 3 COMPLETE. Phase 4 COMPLETE (47/47).
✅ PHASE 5 COMPLETE — §0.6 (baseline + probes), §0.7 (topic set), §0.9 (Part A),
§0.8/§0.10/§0.11 (suites 1–3), §0.12 (batch 1, 11 sources), §0.13 (batch 2, 30
sources), and the closing Part A sweep (§0.13) which came back a NO-OP.**
The bulk `pnpm index` ran to completion on 2026-07-30 (operator-approved) through
the ADR-0015 gateway.

### 🔴 OPERATOR DIRECTION 2026-08-04 — STOP THE ONE-SOURCE-AT-A-TIME LOOP. GO BULK.

> ✅ **CARRIED OUT IN FULL.** Two batches replaced 42 approval turns with 2:
> batch 1 (11 sources, §0.12) and batch 2 (**all 30 remaining**, §0.13). The
> section below is kept because it is the _reasoning_, and because Phase 6+7 must
> not quietly reintroduce the per-source shape. Jaco repeated the direction on
> 2026-08-06 — _"we can't continue one source at a time"_ — which is what turned
> batches B, C and D into a single 30-source batch.

**Jaco's words:** _"I'm not liking this one by one thing we are doing — if I knew
this would be the approach I could have just run `/slice` on each of the 48
sources. Thus far you've made suggestions, I keep agreeing with your suggestion,
so why not just do that in bulk parallel per remaining source so we can get this
done?"_

**He is right, and this file predicted it.** §2 ("Why not `/slice`") exists
because 48 × ~7 operator gates ≈ 300 pauses and almost none are load-bearing.
Phase 5 then reintroduced the same shape: one source per approval turn. Three
suites ran that way (`zh-cn`, `ru`, `bg`) and **the operator approved every one,
every time** — the exact signature the golden skill's own guardrail #7 names:
_"A gate that always returns the same answer is not oversight, it is latency."_

#### The new shape — batches, not sources

|                      | Old (per source)                    | New (per batch)                           |
| -------------------- | ----------------------------------- | ----------------------------------------- |
| Draft + engine-check | 1 source, serially                  | **all sources in a batch, in parallel**   |
| Operator approval    | **once per source** — 42 more turns | **once per batch** — 4 turns total        |
| `pnpm eval`          | after every suite                   | **once per batch**                        |
| Part A re-review     | n/a                                 | **one final sweep after all suites land** |

Batches follow the §0.7 tiers: **A (11 left) · B (16) · C (9) · D (8)**.

#### ⚠️ Four things bulk changes, and what is done about each

1. **Guardrail #4 stays, at batch granularity.** It is the answer keys' only gate
   and it is the operator's. Bulk moves it from per-source to per-batch — draft
   everything, present one consolidated report, **write only after one explicit
   approval**. The gate is not removed; its latency drops 11×. Each batch is one
   commit, so a bad batch reverts cleanly.
2. **🔴 Part A cannot be done per-source any more, and this is the ONE thing bulk
   makes worse.** The living-relevant-set rule says a new source makes prior
   questions answerable by new documents. With 42 sources landing at once, that
   re-review has to be **one final Part A sweep over every existing case after the
   last suite lands** — otherwise the keys go stale in exactly the way §0.9 just
   fixed. **This is a required closing step, not optional.**
3. **`pnpm eval` must still run ALONE.** No resume; one transient blip discards
   the whole run (§4). So: all drafting parallel → then a single eval. Bulk is
   strictly better here — it replaces 42 whole-corpus evals with 4.
4. **Cap embedder concurrency at ~4–6 sources**, not 42. The gateway sustained
   2,281 documents at 23.5/min with 0 retries and 0 fallbacks, so it is robust,
   but there is nothing to gain from saturating it.

🟢 **§0.11's n=10 noise finding independently argues FOR bulk.** A fresh suite's
per-source coverage is the least reliable number it will ever have. Landing a
whole tier and reading the whole-corpus number once is _more_ rigorous than
reading 11 separate n=10 numbers.

#### The per-source discipline that must NOT be dropped

The judgement is the product, not the ceremony. Every source in a batch still gets:

1. Discovery over the §0.7 ten-topic menu (`phase5-partb-discover.ts`).
2. **Read the document OPENING from the database, never the matched chunk alone**
   — the boilerplate-tail trap (§0.9) and three title traps depend on this.
3. Questions authored **in-language**, `docs ÷ 8` sizing (floor 4, cap 10),
   personas skeptic 4 · newcomer 3 · seeker 2 · believer 1.
4. **Engine-check, then re-check after fixes** (guardrail #8 §2). Across `ru` and
   `bg` this caught **7 real defects** before the operator saw either draft.
5. Verify every credited path resolves to exactly one document, no null-language.
6. `# EN:` gloss + `# RETRIEVED` block + `evidence_tier: llm-translated`.

### ⏭️ START HERE — PHASE 5 IS DONE. THE REMAINING WORK IS SHIPPING, NOT MEASURING.

**All drafting, checking, approving, writing and measuring is finished.** 44 of 45
acquired sources have a golden suite; `ru-ca` was deliberately skipped (5
documents — a 4-case floor would enumerate the corpus, not measure it; §16).
The closing Part A sweep ran over all 270 pre-batch cases and came back a **no-op**.

**Do these in order. Nothing below needs a new eval except step 2.**

| #   | Step                                                                                  | What it is                                                                                                                                                                                                     | Gate                  |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | ✅ **DONE 2026-08-06 — `evaluate` flipped green for all 44 sources with suites**      | Ran through `pnpm status:set` (never hand-edited); `pnpm status:check` passes. Rollup is now 47 `done` · 2 `deferred` · 1 `in-progress` (`ru-ca`, reason recorded in the file).                                | none                  |
| 2   | ✅ **DONE 2026-08-06 — the 13 raw-scripture "Who was Jesus?" documents are excluded** | Registry rules + corpus removal + re-eval. **No measurable effect**, as expected — nothing credited them. It also uncovered the **±0.004 eval noise floor**, which matters more than the exclusion did. §0.14. | ✅ control held       |
| 3   | ✅ **DONE 2026-08-06 — Phase 6, one PR for all 48 sources**                           | **[PR #139](https://github.com/JesusFilm/jesusfilm-rag/pull/139)** · 30 commits · 163 files · +54,943 / −14. **Open, not merged** — merging is Jaco's call.                                                    | ⬅ **awaiting review** |
| 4   | **Phase 7 — production, on Jaco's VM** ⬅ **NEXT, after the merge**                    | `acquire:production` → `index:production` → retrieve smoke → `eval:production`. **The language sweep is MANDATORY, not optional** — see the warning below.                                                     | operator              |

🔴 **PHASE 7 WILL REPRODUCE THE ENTIRE LANGUAGE INCIDENT UNLESS THE SWEEP IS
RE-RUN.** Prod re-detects with `tinyld` at ingest, so it will regenerate **all 225
nulls and all 182 mislabels** from scratch — §0.4's fix lives in the _local_
database, not in the code path. For Persian this is a **certainty, not a risk**:
§0.12 measured that **74 of 75 Persian documents contain Arabic-form ي/ك**, so the
text genuinely reads as Arabic to a character-frequency detector. Commands: §0.4.

#### What is deliberately NOT being done, and why

| Item                        | Ruling                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ru-ca` suite               | **Skipped.** 5 documents; revisit only if it ever grows past ~20.                                                                                                                                                                                  |
| `lv` (49 articles)          | **Rights, not engineering** — `robots.txt` names `ClaudeBot`. Ask Agape Students Latvia → [#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133). Do not out-engineer it.                                                                   |
| `sr` · `he`                 | Deferred by decision → [#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129) · [#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132)                                                                                               |
| `cru` duplicate content     | Real defect, **out of campaign scope** — one prayer article at 5 paths (~105 duplicate chunks) + 9 duplicate-title pairs. Needs its own ticket.                                                                                                    |
| English-estate coverage     | `starting-with-god` 0.375 · `jesusfilm-org` 0.537 · `sightline-ministry` 0.563 · `thelife` 0.616 · `cru` 0.626 drag `en` to **0.641**. Pre-existing, untouched by this campaign, and now **the largest quality gap in the corpus**. Its own slice. |
| DNA/Flew retry on `hu`/`ro` | Optional polish. A kept miss is a legitimate recorded gap. §0.13 finding 4.                                                                                                                                                                        |

**Measured state, 2026-07-30 (queries in §0.1):**

| Metric                                 | Value                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingested                               | **2,281 / 2,281** · **0 pending**                                                                                                                                                                                      |
| Bulk run itself                        | 2,219 inserted · 0 updated · 0 unchanged · **0 skipped** · 0 unknown-source · **12,974 chunks**                                                                                                                        |
| Wall clock                             | **~95 min** at 23.5 docs/min (2.55 s/doc)                                                                                                                                                                              |
| Corpus totals                          | declared **47,618** = actual chunks **47,618** = embeddings **47,618**                                                                                                                                                 |
| `embedding_model`                      | **one** distinct value, `qwen/qwen3-embedding-8b` — the wire alias never leaked                                                                                                                                        |
| Retries / fallbacks                    | **0 / 0** across the entire run                                                                                                                                                                                        |
| Idempotency                            | re-run drained **0 rows**                                                                                                                                                                                              |
| Gate                                   | **764 tests green** (761 + 3 for `evidence_tier`)                                                                                                                                                                      |
| Retrieve (Phase 4)                     | ✅ **47 / 47, zero wrong-language hits** (2026-08-03) — see §0.5                                                                                                                                                       |
| Language                               | ✅ **FIXED 2026-07-31** — 225 `null` → **0**; 182 mislabelled → **0**. See §0.4                                                                                                                                        |
| Eval, latest                           | **416 cases** · recall@10 **1.000** · coverage **0.887** · recall@3 **0.966** · MRR **0.872** · P@1 **0.781** — `eval/results-2026-08-06-post-scripture-exclusion-keep.md`                                             |
| ⚠️ Eval noise floor                    | 🔴 **±0.004.** Two runs an hour apart drift on **240 of 416 cases**; the embedder is not bit-deterministic. **Ignore coverage moves under ~0.005 and single-credit flips** — §0.14                                     |
| Corpus                                 | **13,956 docs · 47,426 chunks · 47,426 embeddings** after the raw-scripture exclusion (was 13,969 / 47,618)                                                                                                            |
| Retrieval floor (Phase 5)              | ✅ **mean self@1 0.830 · self@10 0.973** over 376 queries — **no language collapses** — §0.6                                                                                                                           |
| Eval scope                             | ✅ **ALL 45 languages**, `evidence_tier` on unverifiable evidence (Jaco, 2026-08-03) — §7                                                                                                                              |
| Topic set (§0.7)                       | ✅ **10 topics APPROVED** 2026-08-03, engine-checked over 13→128-doc corpora                                                                                                                                           |
| Golden suites written                  | ✅ **44 of 45 acquired sources.** `zh-cn` `ru` `bg` (§0.8/§0.10/§0.11) + 11 tier-A (§0.12) + **30 in batch 2** (§0.13). Only `ru-ca` has none, by decision. ⚠ a fresh suite's first number is n=4–10 and NOISY — §0.11 |
| Part A (18 cases)                      | ✅ **DONE 2026-08-04** — 26 credits over 8 cases; P@1 **0.707 → 0.736**; 3 cases went rank 4/7 → **rank 1** — §0.9                                                                                                     |
| Batch 1 — tier A (11 sources)          | ✅ **DONE 2026-08-04** — 110 cases · 315 credits · all 11 at recall@10 **1.000** — §0.12                                                                                                                               |
| Batch 2 — tiers B+C+D (**30** sources) | ✅ **DONE 2026-08-06** — 146 cases · 333 credits · **every one of the 30 at recall@10 1.000** — §0.13                                                                                                                  |
| 🔴 CLOSING Part A sweep                | ✅ **DONE 2026-08-06 — NO-OP.** All 270 pre-batch cases swept; 10 flagged, every one already ruled on in §0.9. Nothing to write — §0.13                                                                                |
| Regression the campaign caused         | ✅ **REPAIRED.** `es` 0.896 → **0.938** (back to pre-campaign); `zh` 0.733 → **0.843** (97% of the drop recovered). §0.6 called it a stale-key artefact, not a retrieval regression, and was right.                    |

Per-stage state in `docs/source-status.yaml`, **verified by `pnpm status:check`
on 2026-08-06**: **45 sources at `acquire`/`ingest`/`retrieve` green**, and **44
of them now `evaluate: green` and `status: done`** — flipped 2026-08-06 through
`pnpm status:set`, the only sanctioned mutator (the file must never be
hand-edited). Rollup: **47 `done` · 2 `deferred` · 1 `in-progress`.**

- `ru-ca` is the lone `in-progress` — `evaluate: pending`, with the reason now
  recorded in the file itself: it has no golden suite by decision.
- `sr` and `he` remain `deferred` with every stage pending — correctly NOT flipped.
- `everystudent` (en), `-ar` and `-fr` were already `done`; they are the three
  walled banners and are not part of this campaign.

ⓘ **`retrieve` went green at Phase 4 (2026-08-02/03), `evaluate` only now.** §7
says do not write stage verdicts while Phase 5 is mid-flight, and flip `evaluate`
once per source when its golden suite lands. Phase 5 is closed, so all 44 flipped
in one pass rather than 44 separate turns.

The 8 `everystudent-zh-cn` documents left by the earlier stopped run were
**kept**, not rolled back; the bulk run drained the remaining 120 and skipped
them. That closes the open keep-or-rollback decision.

⚠️ **Counts here are measured, not assumed.** Regenerate from the database
(§0.1) rather than trusting this prose after any further ingest.

Everything acquirable has been acquired.

- `sr` and `he` are deferred by decision → [#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129), [#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132)
- `lv` is the single open item, and it is a **rights** question → [#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133)
- `ru-ca` is **RESOLVED** — registered with 5 seeds, not 87, because it is a
  mirror of `ru` (§16)

### ✅ Acquired (45)

`†` = ships the rule-1e `"html"` fallback + `head` strip.

| Lang    | Domain                  | Docs | Container                     |     | Lang    | Domain                  | Docs | Container                                   |
| ------- | ----------------------- | ---: | ----------------------------- | --- | ------- | ----------------------- | ---: | ------------------------------------------- |
| `zh-cn` | xinshengming.com        |  128 | `.cb-entry-content`           |     | `ms`    | persoalanhidup.com      |   52 | `.contentpadding`                           |
| `ru`    | mirstudentov.com        |   95 | `.contentpadding`             |     | `mk`    | studentskiodgovori.com  |   49 | `.contentpadding` †                         |
| `bg`    | everystudent.bg         |   84 | `.article-content` ⚠️ staging |     | `lt`    | kiekvienamstudentui.lt  |   49 | `html`                                      |
| `sk`    | everystudent.sk         |   83 | `.entry-content` (Elementor)  |     | `bn`    | everybengalistudent.com |   48 | `.contentpadding` †                         |
| `hu`    | everystudent.hu         |   83 | `.contentpadding`             |     | `zh-tw` | everystudent.com.tw     |   46 | `.entry-content`                            |
| `mn`    | tailal.mn               |   82 | `html`                        |     | `et`    | tudengielu.net          |   46 | `.contentleftpadding`                       |
| `ja`    | studentinjapan.com      |   79 | `.content4`                   |     | `de`    | duentscheidest.com      |   45 | `.contentpadding`                           |
| `pl`    | kazdystudent.pl         |   77 | `.contentpadding`             |     | `th`    | everythaistudent.com    |   44 | `.contentpadding` †                         |
| `sq`    | pyetjetejetes.com       |   77 | `html`                        |     | `hr`    | vrlovazno.com           |   41 | `.contentpadding` †                         |
| `es`    | cadaestudiante.com      |   76 | `.contentpadding`             |     | `am`    | habeshastudent.com      |   41 | `.contentpadding` †                         |
| `fa`    | everypersianstudent.com |   75 | `.contentpadding`             |     | `it`    | ognistudente.com        |   38 | `.post-content` (WP)                        |
| `pt`    | suaescolha.com          |   75 | `.contentpadding`             |     | `ko`    | everykoreanstudent.com  |   37 | `html`                                      |
| `cs`    | everystudent.cz         |   74 | `.content` ⚠️ IPv6 flag       |     | `ur`    | zindagikaysawalat.com   |   33 | `.contentpadding` †                         |
| `tr`    | tanriyitanimak.com      |   71 | `.contentpadding`             |     | `el`    | everystudent.gr         |   32 | `#content4` † ⚠️ `http://`                  |
| `vi`    | everyvietstudent.com    |   67 | `.contentpadding`             |     | `hi`    | everystudent.in         |   34 | `.contentpadding` †                         |
| `ro`    | everystudent.ro         |   64 | `.contentpadding`             |     | `ta`    | ungalthervuenna.com     |   31 | `html`                                      |
| `id`    | mahasiswakeren.com      |   57 | `.contentpadding` †           |     | `my`    | everymyanmarstudent.com |   31 | `.contentpadding` †                         |
|         |                         |      |                               |     | `te`    | everytelugustudent.com  |   30 | `html`                                      |
|         |                         |      |                               |     | `sl`    | vsakstudent.com         |   23 | **`#contentpadding`** † ⚠️ ID               |
|         |                         |      |                               |     | `ne`    | nepalistudent.net       |   20 | `.contentpadding` †                         |
|         |                         |      |                               |     | `om`    | everybarataa.com        |   18 | `.contentpadding` † ⚠️ no detect            |
|         |                         |      |                               |     | `kk`    | shakirtter.com          |   17 | `html`                                      |
|         |                         |      |                               |     | `ka`    | kovelistudenti.com      |   16 | `.contentpadding` †                         |
|         |                         |      |                               |     | `sw`    | lipotumaini.com         |   13 | `.contentpadding` †                         |
|         |                         |      |                               |     | `uk`    | svitstudentiv.com       |   47 | `html` · **seed**                           |
|         |                         |      |                               |     | `hy`    | 1patasxan.com           |   34 | `html` · **seed**                           |
|         |                         |      |                               |     | `ti`    | everytemhari.com        |   14 | `.contentpadding` † · **seed** ⚠️ no detect |
|         |                         |      |                               |     | `ru-ca` | studentstan.com         |    5 | `.post-content` † · **seed** ⚠️ mirror      |

### 🅿️ Deferred (2)

| Lang | Domain              |  Expected | Why                                                                                                                                                                   |
| ---- | ------------------- | --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sr` | studentskikutak.com |        76 | Written, wired, gate-passed. Network blackhole → **[#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129)**. Do NOT add `/etc/hosts`.                          |
| `he` | igod.co.il          | **1,020** | Written, wired, gate-passed. **Not a Cru property**; sitemap uses CDATA that `discover.ts` cannot parse; 200× the recon count. Three operator calls — see §4 and §16. |

### ⚠️ Open — one item, and it is a rights question (1)

| Lang | Domain             | Articles | What blocks it                                                                                                                                                                                            |
| ---- | ------------------ | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lv` | katramstudentam.lv |       49 | **RIGHTS, not crawlability** → **[#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133)**. `robots.txt` disallows `ClaudeBot` by name. Ask Agape Students Latvia; do not out-engineer it. See §15. |

### 0.2 ✅ RESOLVED — nine campaign languages were INVISIBLE to the ingest-time detector

> ✅ **Fixed 2026-07-31 by the language sweep — see §0.4 for the run record.**
> The diagnosis below is kept because it explains _why_ the corpus was wrong and
> it is the reason `--mode full`, not `--mode blanks`, was the right tool. The
> per-language counts in the table are the **pre-sweep** state; every one of them
> now reads 100% correct. Do not re-run anything on the strength of this section.

Measured 2026-07-30 from the `everystudent-sw` gateway canary, then generalised
by reading `tinyld`'s own exported list. **This was the single biggest surprise of
Phase 3 and it affected 274 documents (12% of the campaign).**

`tinyld` — the detector `decideLanguage` uses at ingest — models **62**
languages. Nine of this campaign's declared languages are **not among them**, so
tinyld cannot ever return the right answer for those sources. Check it yourself:

```bash
node -e "const {supportedLanguages}=require('tinyld'); console.log(supportedLanguages.length)"
```

What happens splits into two very different outcomes, and the bad one is not the
one you would guess. **A null is honest; a confident wrong answer is not.**

**MEASURED after the full bulk run** (predictions were from the 4 longest docs
per source, which overestimated mislabels exactly as flagged — 156 actual vs
227 predicted; the balance landed as honest nulls instead):

| Lang           |    Docs | tinyld guesses    |    🔴 mislabelled | ⚪ null | Collides with a real corpus language?                   |
| -------------- | ------: | ----------------- | ----------------: | ------: | ------------------------------------------------------- |
| `sq` Albanian  |      77 | `nl`              |       **38** `nl` |      39 | no Dutch source exists → the whole `nl` bucket is wrong |
| `ms` Malay     |      52 | `id`              |       **47** `id` |       5 | **YES** — `id` bucket is 54 real + 47 Malay = 101       |
| `hr` Croatian  |      41 | `sr`              |       **30** `sr` |      11 | **YES** — see `sr` below                                |
| `sl` Slovenian |      23 | `sr`              |        **6** `sr` |      17 | **YES** — see `sr` below                                |
| `ne` Nepali    |      20 | `hi`              | **20** `hi` (all) |       0 | **YES** — `hi` bucket is 34 real + 20 Nepali = 54       |
| `ti` Tigrinya  |      14 | `am`              | **14** `am` (all) |       0 | **YES** — `am` bucket is 41 real + 14 Tigrinya = 55     |
| `om` Oromo     |      18 | `fi`/`ber`        |           1 `ber` |      17 | —                                                       |
| `ka` Georgian  |      16 | _nothing_ @ 0.000 |                 0 |      16 | — no Georgian script model at all                       |
| `sw` Swahili   |      13 | `rn` (Kirundi)    |                 0 |      13 | —                                                       |
| **total**      | **274** |                   |           **156** | **118** |                                                         |

🔴 **The `sr` bucket was 100% wrong.** `everystudent-sr` is deferred and never
acquired (#129), so all **36** documents labelled `sr` were mislabelled Croatian
(30) or Slovenian (6). Same for `nl`: 38 Albanian documents and no Dutch source.
✅ Both buckets are now **empty** — the sweep moved every row to `hr`/`sl`/`sq`.

⚠️ **This table UNDERCOUNTED the damage by 26 documents.** It omits
`everystudent-fa`, which §0.3 filed as a nulls-only problem. The database showed
**26 Persian documents labelled `ar`**, colliding with the 65 genuinely-Arabic
documents in `everystudent-ar` — a source already evaluated and live in prod.
**The real mislabel total was 182, not 156.** Lesson: derive the fix list from a
query against the registry's declared `languages`, never from a hand-maintained
table. The query is in §0.4.

### 0.3 ✅ RESOLVED — a THIRD failure mode: modelled languages that still miss the gate

> ✅ **Fixed 2026-07-31 by the same sweep — see §0.4.** Counts below are pre-sweep.

Not every null comes from §0.2. **107 of the 225 corpus nulls are on languages
tinyld _does_ model**, where two same-script neighbours split the confidence
below 0.75:

| Source                                               |    Nulls | Of total | tinyld's read                                                               |
| ---------------------------------------------------- | -------: | -------: | --------------------------------------------------------------------------- |
| `everystudent-fa` Persian                            |   **47** |       75 | oscillates `fa`/`ar` at **0.503–0.746** — Persian and Arabic share a script |
| `everystudent-sk` Slovak                             |   **17** |       83 | correct `sk`, but **0.620–0.815** — Czech/Slovak/Polish split it            |
| `es` `et` `zh-cn` `id` `pt` `it` `mn` `cs` `el` `ru` | 1–7 each |          | scattered near-gate cases                                                   |
| pre-existing (`everystudent` 9, `ar` 2, `fr` 1)      |       12 |          | untouched by this campaign                                                  |

`fa` is the headline: **63% of Persian documents are unlabelled**, and it was
never on any watch list because `fa` _is_ in tinyld's 62. The lesson is that
"modelled" does not mean "detected" — a language with a same-script sibling can
sit under the gate indefinitely. **The `lang:sweep` LLM pass fixes these too.**

The 0.75 confidence gate (`CONFIDENCE_GATE`) is what separates the two columns,
and it is doing its job well: `sw`'s highest-scoring document reached **0.744**,
missing the gate by 0.006. The ADR-0007 500-char floor is **not** involved —
every document sampled ran 3,330–33,649 chars.

⚠️ **The five "YES" rows are the real damage.** A `language:hi` filtered query
would return Nepali documents; `language:am` would return Tigrinya. That breaks
the Phase-4 per-language smoke and any language-filtered eval — silently, because
nothing errors.

#### ✅ The fix is cheap, and it is NOT a re-embed

`pnpm lang:sweep` wires a **completely different, far more capable detector** —
an LLM (`google/gemini-2.5-flash-lite`) via the `LanguageDetector` port, not
tinyld. Proven on the `sw` canary (dry-run, 2026-07-30):

```
sweeping everystudent-sw … 13 scanned, 13 change(s)
13 filled (∅ → sw), every one detected sw@1.00, 0 left null
```

And `decideSweep` (`src/ingestion/resolve-language.ts:218`) explicitly allows a
confident detection to **override an existing label** — `reason: "relabel"` —
so the six mislabelled sources are fixable by the same pass, not just the three
nulls. `language` is a plain column on `documents`; correcting it touches **no
chunks and no embeddings**, so this costs an LLM pass over 274 documents and
nothing else.

✅ **Done 2026-07-31 — see §0.4 for what was actually run and what it found.**
`--mode full` re-scans every row, which is what let it fix a non-null mislabel;
`--mode blanks` would only have touched the nulls and left all 182 mislabelled
documents wrong. Every run wrote a `changelog-*.jsonl` that `--revert` consumes,
so the pass stays reversible.

⚠️ **`everystudent-am` was already indexed and labelled `am`.** Until the sweep
ran, `language:am` covered Tigrinya too. ✅ Now clean: `am` = 41 docs from
`everystudent-am` only. **Any `am` retrieval number measured before 2026-07-31
is invalid — re-measure.**

ⓘ **Correction to this file's earlier prediction (§13 #11/#16):** it named only
`om` and `ti`. The real list is nine, and `ti`'s "may be mislabelled `am`" was
**measured at confidence 1.000 on 4 of 4** — not a maybe. `ka` was also recorded
as detectable; tinyld returns nothing at all for Georgian.

### 0.4 ✅ The language sweep — run record (2026-07-31)

**Outcome in one line: the corpus went from 225 null + 182 mislabelled to
`0 null` across all 13,969 documents, and every everystudent source now matches
its registry-declared language.**

Detector: `google/gemini-2.5-flash-lite` over OpenRouter (ADR-0009), **not**
`tinyld`. Label-only — no chunks and no embeddings were touched. Local DB only.

**How the fix list was derived** (do this, not a hand-kept table — that is what
missed `fa`):

```sql
with per as (
  select s.key, coalesce(d.language,'(NULL)') label, count(*) docs
  from documents d join sources s on s.id=d.source_id
  where s.key like 'everystudent%' group by 1,2),
expect as (select key,
  case when key='everystudent' then 'en' when key like '%zh-%' then 'zh'
       when key='everystudent-ru-ca' then 'ru'
       else replace(key,'everystudent-','') end exp
  from (select distinct key from per) t)
select p.key, e.exp should_be, p.label actual, p.docs
from per p join expect e on e.key=p.key where p.label <> e.exp order by p.docs desc;
```

⚠️ **Two rows in that query are FALSE ALARMS — do not sweep them.**
`everystudent-zh-tw` (46 docs labelled `zh`) and `everystudent-ru-ca` (5 labelled
`ru`) are correct: both declare the base ISO 639-1 code in the registry
(`languages: ["zh"]` / `["ru"]`). Regional variants are _supposed_ to collapse.

#### What ran

**Step 1 — dry-run, 8 mislabelled sources, `--mode full`.** All eight came back
100% resolved to the declared language, `0` left null, `0` rows in the report's
"Eyeball these" list. That is what justified applying without a per-source pause.

**Step 2 — apply, same 8 sources, `--mode full` — 317 rows written, 0 skipped by
the optimistic guard:**

| Source            | Scanned | Relabelled   | Filled from null | Confidence |
| ----------------- | ------: | ------------ | ---------------: | ---------- |
| `everystudent-fa` |      75 | 26 `ar`→`fa` |               47 | 1.00       |
| `everystudent-sq` |      77 | 38 `nl`→`sq` |               38 | 1.00       |
| `everystudent-ms` |      52 | 47 `id`→`ms` |                5 | 0.99–1.00  |
| `everystudent-hr` |      41 | 30 `sr`→`hr` |               11 | 1.00       |
| `everystudent-sl` |      23 | 6 `sr`→`sl`  |               17 | 1.00       |
| `everystudent-ne` |      20 | 20 `hi`→`ne` |                0 | 1.00       |
| `everystudent-om` |      18 | 1 `ber`→`om` |               17 | 1.00       |
| `everystudent-ti` |      14 | 14 `am`→`ti` |                0 | 0.99–1.00  |
| **total**         | **320** | **182**      |          **135** |            |

**Step 3 — apply, 16 null-only sources, `--mode blanks` — 89 rows, 0 skipped:**
`sk` 17 · `ka` 16 · `sw` 13 · `everystudent` 9 · `et` 7 · `es` 7 · `zh-cn` 6 ·
`id` 3 · `ar` 2 · `it` 2 · `pt` 2 · `fr` 1 · `el` 1 · `cs` 1 · `ru` 1 · `mn` 1.

**Total: 406 documents relabelled or filled. Cost ≈ 15 cents** (~730 detector
calls including the dry-run pass, at Flash-Lite rates — an estimate from
published pricing, not a metered figure).

#### Collision buckets — before and after

| Bucket | Before                       | After                      |
| ------ | ---------------------------- | -------------------------- |
| `ar`   | 65 Arabic **+ 26 Persian**   | 67, `everystudent-ar` only |
| `hi`   | 34 Hindi **+ 20 Nepali**     | 34, `everystudent-hi` only |
| `am`   | 41 Amharic **+ 14 Tigrinya** | 41, `everystudent-am` only |
| `id`   | 54 Indonesian **+ 47 Malay** | 57, `everystudent-id` only |
| `sr`   | 36 docs, **100% fake**       | **0** — bucket gone        |
| `nl`   | 38 docs, **100% fake**       | **0** — bucket gone        |

Every one of the 14 affected language buckets is now exactly one source.

#### Three findings worth carrying forward

1. 🟢 **Gemini Flash Lite detects every language `tinyld` cannot — including the
   ones this file predicted were undetectable.** `om` (Oromo) resolved **18/18 at
   confidence 1.00**; `ka` (Georgian) **16/16 at 1.00**, where `tinyld` returns
   _nothing at all_. **This retires the §13 #11 concern.** The registry's
   `languages: ["om"]` declaration was right and is now backed by real labels.
2. 🟡 **`fa` was mis-triaged as a nulls-only problem and was actually the worst
   collision.** 26 Persian pages sat in the `ar` bucket that `everystudent-ar` —
   already evaluated, already in prod — draws from. Any `language:ar` eval number
   taken before 2026-07-31 measured a polluted corpus.
3. 🔴 **One transient detector failure in 409 documents, and it is a real defect
   — filed 2026-08-03 as [#138](https://github.com/JesusFilm/jesusfilm-rag/issues/138).**
   `pyetjetejetes.com/a/rastesisht.html` failed with `response was not JSON` —
   but the logged fragment shows the model answered **correctly** and the JSON was
   truncated mid-`evidence` string: `{"language": "sq", "confidence": 1,
"evidence": "A gjendemi këtu`. Cause is `DEFAULT_MAX_OUTPUT_TOKENS = 200`
   (`openrouter-language-detector.ts:34`) being consumed by a long evidence quote
   in a diacritic-heavy language that tokenises poorly. The sweep behaved
   correctly — logged it as an anomaly, left the row untouched, never crashed —
   and a plain re-run fixed it. **But it fails SILENTLY into a null**, so on a
   larger run it would look like an honest abstain rather than a bug.

#### Reverting

Each source has its own changelog under `reports/` (git-ignored), so a bad
relabel reverts per-source without touching the others:

```bash
pnpm lang:sweep --revert reports/changelog-everystudent-<key>-<ts>.jsonl --apply
```

#### ⚠️ This does NOT carry to production

**These labels live in the LOCAL database only.** Phase 7 runs
`acquire:production` (§6) — prod re-fetches and re-ingests, and ingest detects
with **`tinyld`**, not the LLM. So **prod will reproduce all 225 nulls and all
182 mislabels from scratch.** ADR-0008's `coalesce(new, existing)` protects an
established label _within_ one database; it cannot carry one across two.

The same is true of the `copy-raws.sh` path (not used here) — it copies
`raw_documents` only, and `index:production` re-detects just the same.

**Phase 7 must re-run both passes against prod, after `index:production`:**

```bash
for k in fa ms sq hr ne ti sl om; do
  pnpm lang:sweep:production --source everystudent-$k --mode full --apply
done
for k in sk ka sw et es zh-cn id ar it pt fr el cs ru mn; do
  pnpm lang:sweep:production --source everystudent-$k --mode blanks --apply
done
pnpm lang:sweep:production --source everystudent --mode blanks --apply
```

Prod runs need `JFRAG_ALLOW_PROD_WRITE=1` and Doppler credentials — see
`docs/ops/language-sweep.md` → "Running against production".

### 0.5 ✅ Phase 4 — per-language retrieve smoke (2026-08-03): 47 / 47

**Every `language:<code>` filter returned only documents genuinely in that
language. Zero wrong-language hits across 47 sources.** The seed document ranked
**#1 in 43 of 47** and #2 in the other four.

Method matters here: each hit's language was resolved from the database by
`(sourceKey, canonicalUrl)`, **never inferred from the source key** — a source
can hold more than one language (`cru` is en+es+fr), so key-based inference
would have passed a broken filter.

The rows that were broken before the sweep, now measured clean:

| Source              | Before the sweep                  | Phase 4 result                                     |
| ------------------- | --------------------------------- | -------------------------------------------------- |
| `ti` Tigrinya       | 100% filed as `am`                | 5 hits, all `ti`, self @1, top **0.722**           |
| `ne` Nepali         | 100% filed as `hi`                | 5 hits, all `ne`, self @1, **0.810**               |
| `ms` Malay          | 47 of 52 filed as `id`            | 5 hits, all `ms`, self @2, **0.677**               |
| `hr` Croatian       | 30 filed as `sr`                  | 5 hits, all `hr`, self @1, **0.881** (best in run) |
| `sq` Albanian       | 38 filed as `nl`                  | 5 hits, all `sq`, self @2, **0.712**               |
| `fa` Persian        | 26 in the `ar` bucket + 47 null   | 3 hits, all `fa`, self @1, **0.628**               |
| `ka` `sw` `om`      | 100% null — unreachable by filter | 4 / 5 / 5 hits, all correct                        |
| `am` `ar` `hi` `id` | polluted buckets                  | re-measured clean                                  |

✅ **Regional collapse behaves as designed** — this was the most likely source of
a false failure. `language:zh` returns `zh-cn` **and** `zh-tw`; `language:ru`
returns `ru` **and** `ru-ca`; `language:es`/`fr` reach `cru` and `thelife-fr`.
Correct: those sources genuinely share one ISO 639-1 code.

ⓘ Five sources returned fewer than 5 hits (`de` 1, `fa`/`id`/`te`/`th` 3). That
is the `minScore 0.37` cutoff on a small subcorpus, **not** a filter fault —
every hit returned was right.

#### The script — reuse it verbatim for Phase 7 against prod

Lives at `.tmp-diag/phase4-smoke.ts` (git-ignored; `.tmp-diag/` is in
`.git/info/exclude`). It must live INSIDE the repo for the `@/` alias to
resolve. Run:

```bash
QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 \
  doppler run -p forge-rag -c dev -- npx tsx .tmp-diag/phase4-smoke.ts
```

It wires once and loops, rather than spawning 47 `pnpm query` processes. Shape:
pull one seed title per source from `documents`, build an exact
`"sourceKey|url" → language` map, then for each source
`retriever.search(title, { language, topK: 5 })` and assert (a) hits > 0 and
(b) every hit's looked-up language equals the filter.

⚠️ **The env override is required, not cosmetic** — ad-hoc retrieval inherits
`/v1/search`'s fast-fail posture (2 attempts, 4 s) and dies `AbortError` without
it. See §6 Phase 3, finding 2.

### 0.6 🔵 Phase 5 — STARTED 2026-08-03. Baseline measured, scope decided, mechanism built

**Phase 5 is IN PROGRESS, not done.** Three things are finished and one is the
large remaining body of work.

#### ✅ Done — the baseline eval, and it answers the §4 "void `ar` number" warning

```bash
QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 pnpm eval
```

130 cases, whole corpus, 13,969 documents. Run **twice** on 2026-08-03 →
**`eval/results-2026-08-02.md`** (first) and **`eval/results-2026-08-03.md`**
(second, which also verifies the new per-tier section).

ⓘ **Two files, one day.** The filename is a **UTC** date stamp
(`new Date().toISOString()` in `scripts/eval.ts`), and NZ is UTC+12 — a morning
run lands on the previous UTC day, an afternoon run on the current one. Not a
defect, but it means **a same-day re-run can silently overwrite or split the
record.** Check the timestamp inside the file, not the filename.

##### ⚠️ `pnpm eval` is NOT run-to-run deterministic — size the noise before reading a delta

The two runs above were the **same 130 cases against the same unchanged corpus**,
75 minutes apart. They did not agree:

| Metric    |     run 1 |     run 2 |  run-to-run drift |
| --------- | --------: | --------: | ----------------: |
| recall@10 |     1.000 |     1.000 |          **0.0%** |
| coverage  |     0.722 |     0.721 |             0.14% |
| recall@3  | **0.923** | **0.915** | **0.9% relative** |
| MRR       |     0.835 |     0.834 |              0.1% |

🔴 **This matters for how the deltas above are read.** `recall@3`'s 0.9%
run-to-run drift is a meaningful fraction of the −3.2% attributed to the campaign
index, so **treat the recall@3 / MRR / P@1 deltas as indicative, not measured.**
The primaries are safe: recall@10 is stable at 1.000, and coverage drifts 0.14%
against a −1.9% signal.

🟢 **The headline per-language finding is NOT noise.** `es` 0.896, `zh` 0.733,
`ar` 0.979 and `fr` 0.804 are **byte-identical across both runs**. All of the
variance sits in `en` (0.641 → 0.639) — the largest and most competitive bucket,
where near-tied scores reorder. The two languages this campaign moved did not
budge.

**Practical rule: run `pnpm eval` twice before believing any delta under ~2%
relative on a secondary metric.** Cause not yet investigated — most likely
tie-ordering among near-equal scores rather than embedding non-determinism, since
the affected bucket is the crowded one. Not filed; low value until someone needs
a sub-2% secondary-metric result.

**Compared against `eval/results-2026-07-27.md` — the same 130 cases, before the
campaign's 2,281 documents were indexed:**

| Metric      | 07-27 (pre-index) | 08-02 (post-index) | Δ relative |
| ----------- | ----------------: | -----------------: | ---------: |
| recall@10   |             1.000 |          **1.000** |   **0.0%** |
| coverage    |             0.736 |          **0.722** |  **−1.9%** |
| recall@3    |             0.954 |              0.923 |   −3.2% ⚠️ |
| MRR         |             0.854 |              0.835 |   −2.2% ⚠️ |
| precision@1 |             0.746 |              0.731 |   −2.0% ⚠️ |

⚠️ **The three marked rows carry run-to-run noise of the same order as the
signal** — see the determinism box above. Only recall@10 and coverage are solid.

Read against `docs/eval-approach.md`'s drift gate (recall@10 or coverage down
**> 2% relative** blocks — written for the model swap, reused here by analogy
because it is the same suite over a changed corpus): **both primaries pass.**
recall@10 is unmoved; coverage is −1.9%, inside the gate but close to it.

#### 🟡 The per-language split is the finding — the mean HIDES it

| language | 07-27 |     08-02 | Δ relative | why                                                   |
| -------- | ----: | --------: | ---------: | ----------------------------------------------------- |
| `ar`     | 0.979 | **0.979** |   **0.0%** | —                                                     |
| `en`     | 0.641 |     0.641 |       0.0% | campaign added no English                             |
| `fr`     | 0.804 |     0.804 |       0.0% | —                                                     |
| `es`     | 0.938 | **0.896** |  **−4.5%** | `everystudent-es` added 76 Spanish docs               |
| `zh`     | 0.867 | **0.733** | **−15.5%** | `-zh-cn` (128) + `-zh-tw` (46) added 174 Chinese docs |

**All of the −1.9% whole-corpus dip is `es` + `zh`.** Every other language is
bit-identical. That is not a coincidence: `es` and `zh` are the **only two
multi-source languages** the campaign touched, and they are exactly the Part-A
surface §7 predicted.

🟢 **This is a STALE-ANSWER-KEY artifact, not a retrieval regression.** New,
legitimately-relevant Chinese and Spanish documents now compete for top-10 slots
while being credited in **zero** relevant sets — `pnpm eval` scores them as
misses because the keys have not caught up. `docs/eval-approach.md` names this
case explicitly ("a small dip from a living-set artifact is not a regression").
Part-A re-review is the fix, and `zh` at −15.5% is the evidence it is not optional.

#### ✅ RESOLVED — the "any pre-2026-07-31 `language:ar` number is void" warning

§0.4 and §4 both flagged that `everystudent-ar` carries 13 golden cases and its
bucket had held 26 Persian pages, so its prior eval number could not be trusted.
**Re-measured post-sweep: `ar` coverage 0.979, recall@10 1.000 — identical to
07-27, to three decimals.** The pollution never damaged the result: the Persian
documents were extra _distractors_ in the bucket, and retrieval returned the
right documents anyway. **The warning is discharged; the number stands.**

#### 📐 Part A is real work for exactly TWO languages, and provably a no-op for 43

Measured, not assumed — `cases already crediting a campaign source: 0`:

|                                   | languages                       | Part-A re-review                 |
| --------------------------------- | ------------------------------- | -------------------------------- |
| Existing cases in this language   | `es` (8 cases), `zh` (10)       | **REAL — 18 cases to re-review** |
| No existing case can resolve here | the other 43 campaign languages | **provable no-op**               |

`corpus-search-store.ts` applies a strict `eq(documents.language, …)`, so no
existing case can return a document in a language it has none for. Do the cheap
structural check before spending a curation pass — it is 18 cases, not 130.

#### ✅ Done — `evidence_tier`, built BEFORE any case was authored

Jaco's 2026-08-03 answers (§7): **all 45 languages in scope**, with
`llm-translated` tagging where the translation cannot be checked. Schema +
`coverageByTier()` in `scripts/eval-metrics.ts`; reporting in `scripts/eval.ts`
**and** `scripts/eval-production.ts` (Phase 7 runs the latter — it must not lose
the split). The 130 pre-campaign cases are left `(untagged)`, deliberately not
backfilled. Gate green: **764 tests**. Full rationale in §7.

✅ **Verified end-to-end, not just by unit test** — the second eval run printed:

```
per-evidence-tier coverage:
  (untagged)           n=130  recall@10=1.000  coverage=0.721
```

One bucket today, because no tiered case exists yet. The moment Part B writes its
first `llm-translated` case, that becomes two rows that never average together.

#### ✅ Done — the retrieval-FLOOR probe: no language collapses, so none needs deferring

Zero operator input, read-only, **376 queries over all 47 sources**
(`.tmp-diag/phase5-health.ts`, git-ignored). For 8 deterministically-sampled
documents per source it queries the language-scoped retriever with each
document's **own title** and records where that document lands.

⚠️ **Read this as a FLOOR, not an eval.** A title query echoes the article's own
words — golden guardrail #1 forbids exactly that in a real case _because_ it is
trivially easy. That is the point: a language that cannot clear the trivial bar
would have no chance with hand-curated questions, and the cause would be the
embedder's coverage of the language, not the answer keys.

```bash
QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 npx tsx .tmp-diag/phase5-health.ts
```

**Result: `mean self@1 0.830 · self@10 0.973 · MRR 0.886`. Nothing collapses.**

🟢 **The languages this campaign worried about are FINE.** Every one that was
100% null or 100% mislabelled before the sweep clears the floor:

| Lang          |   self@1 | self@10 | Reading                                                       |
| ------------- | -------: | ------: | ------------------------------------------------------------- |
| `am` Amharic  | **1.00** |    1.00 | perfect                                                       |
| `ka` Georgian |     0.88 |    1.00 | `tinyld` could not see it at all — the embedder can           |
| `om` Oromo    |     0.75 |    1.00 | no detector model existed; retrieval is unaffected            |
| `sw` Swahili  |     0.75 |    1.00 | fine                                                          |
| `ne` Nepali   |     0.75 |    0.88 | fine                                                          |
| `ti` Tigrinya |     0.63 |    1.00 | always found by rank 10; lowest mean score in the run (0.538) |

**This independently supports the §7 "all 45" decision.** There is no
_capability_ reason to defer any language — the only constraint left was
operator attention, and Jaco answered that.

**Softest ranking, weakest first** — where a golden suite is most informative,
not where anything is broken:

| Source        |   self@1 |  self@10 | mean top score |
| ------------- | -------: | -------: | -------------: |
| `th` Thai     | **0.50** | **1.00** |          0.656 |
| `ur` Urdu     |     0.63 |     0.88 |      **0.546** |
| `te` Telugu   |     0.63 |     0.88 |          0.687 |
| `zh-cn`       |     0.63 |     1.00 |          0.685 |
| `ti` Tigrinya |     0.63 |     1.00 |      **0.538** |

🔎 **`zh-cn` at self@1 0.63 is the same problem the eval found, measured a
different way.** The two Chinese sources compete with each other _and_ with
`thelife-zh` inside one `zh` bucket — which is why `zh` coverage fell 15.5%
above. Two independent probes landing on the same source is the strongest signal
in this phase.

ⓘ **Lowest mean top-scores (`ti` 0.538, `ur` 0.546, `om` 0.596, `hi` 0.598) sit
nearest the `minScore` 0.37 cutoff** — the same effect §0.5 saw when five
sources returned fewer than 5 hits. Re-derive `minScore` per language before
changing it (`docs/eval-approach.md` step 4), not from the English default.

ⓘ `ru-ca` sampled **n=3**, not 8 — it holds only 5 documents and the probe's
12–120 char title filter takes three. Its 1.00 is real but thin.

#### ✅ Done — the Part B design probes: English questions ARE a usable discovery scaffold

Two probes, run 2026-08-03 to decide **how** Part B is built rather than guessing.

**First, the shortcut that does NOT exist.** If the 45 siblings published the same
articles at the same paths, one question set could be mapped mechanically across
all of them. They do not — they localise their slugs:

| Paths shared across |     Count |
| ------------------- | --------: |
| 1 site only         | **1,993** |
| 2–4 sites           |        79 |
| 5–9 sites           |        32 |
| 10+ sites           |        11 |

Only four paths reach 12+ languages (`/a/toxic.html`, `/a/why.html`,
`/a/personally.html`, `/a/tragedy.html`). **There is no shared article map.**

**Second, cross-lingual retrieval — and it works.**
`.tmp-diag/phase5-crosslingual.ts`, 6 English persona questions × 48 sources:
**278 / 288 pairs (96.5%) reached the target source above `minScore` 0.37**, mean
top own-source score **0.499**.

⚠️ **That headline is weaker than it looks and must not be quoted alone.** Each
non-English language holds exactly **one** source, so "reached the right source"
is nearly tautological. Two rows prove the measurement is measuring competition,
not language:

- **`everystudent` (en) scored 4/6 — second WORST in the run**, at 0.427. The
  English source is not bad at English; it competes with 10,563 English documents
  from 7 sources. The non-English sources have no competitors in their bucket.
- **`ru-ca` scored 0/6.** It shares the `ru` bucket with `everystudent-ru`
  (95 docs vs 5) and never reaches top-5. Consistent with §16 — it is a mirror.

**Third, the probe that closes the hole** (`.tmp-diag/phase5-xling-distinct.ts`):
do 6 different English questions reach 6 different documents, or collapse onto
one? Collapse would mean the embedder is matching "this is religious prose"
rather than the topic.

| Source              | Distinct top docs | Verdict                                        |
| ------------------- | ----------------- | ---------------------------------------------- |
| `de` `th` `ja`      | **6 / 6**         | ✅ topic-discriminating                        |
| `hi` `am` `ka` `om` | 5 / 6             | ✅ topic-discriminating                        |
| `ti`                | 4 / 6             | 🟡 three questions all land on `/a/peace.html` |

The retrieved documents are **visibly** right where the title can be read:
`religions` → `世界の宗教、結局はみな同じ？` (ja, "world religions — all the same
in the end?"), `purpose` → `/a/300purpose.html` (th), `suffering` →
`ทำไมจึงมีความเจ็บปวดและความทุกข์ทรมาน?` (th, "why is there pain and suffering?").

🔴 **One systematic miss worth chasing separately: the `forgiveness` question
("I've done things I'm ashamed of. Can I actually be forgiven?") landed on
sexual-sin articles in 4 of 8 languages** — `de` "Nine lies about pornography",
`th` "sex and the search for intimacy", `hi` `/a/toxic.html`, `ja` "how to keep
healthy self-esteem". Shame maps to porn/sex content across the estate rather
than to forgiveness. That is a **retrieval finding, not a probe artefact**, and it
is exactly the kind of gap a golden case should record rather than paper over
(guardrail #8 #2). Not yet filed — needs one more look to tell a vocabulary gap
from a corpus-composition fact.

**What this means for Part B, concretely:** English questions are a good
**candidate-discovery scaffold** — they surface topically-varied, plausible
documents in every language, so the topic set can be approved ONCE in English and
discovery runs uniformly across 45 languages. They are **not** good enough to
auto-credit: top-1 is frequently the wrong topic, so discovery must run at
topK 10–20 and the panel must still judge. And the case's **question must be
authored in-language**, not translated from English — real users of
`everystudent.co.th` ask in Thai, and an English-question eval would measure
something nobody does.

ⓘ `ti` `om` `ka` `am` scored nearest the cutoff (0.385–0.51) and discriminated
least. Budget more drafting effort there; do not read a thin candidate pool as
"this language has no content".

### 0.7 ✅ APPROVED 2026-08-03 — the canonical topic set for Part B (10 topics)

**Jaco approved these ten on 2026-08-03.** Every language's suite draws from this
menu, so topical coverage is consistent across all 45 and the operator never
re-judges "is this a good question" — only "did this language's articles answer
it". **This is the one substantive judgment Part B needs from him.**

| #               | Persona  | Question                                                                                                                        |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 `god-exists`  | skeptic  | _My friends all think believing in God is just wishful thinking. Is there actually anything solid behind it?_                   |
| 2 `know-god`    | newcomer | _What is God actually like? I have no picture of him beyond a vague force somewhere._                                           |
| 3 `suffering`   | skeptic  | _A friend of mine died in an accident last year and nobody can tell me why a good God would let that happen._                   |
| 4 `purpose`     | seeker   | _I finish every day feeling like none of it added up to anything. What am I even here for?_                                     |
| 5 `anxiety`     | seeker   | _I feel anxious almost all the time. Does God offer anything for that?_                                                         |
| 6 `jesus-death` | newcomer | _I get that Christians think Jesus dying was a big deal, but I do not understand what it was supposed to accomplish._           |
| 7 `bible-trust` | skeptic  | _The Bible was written thousands of years ago and copied by hand. How could anyone know it still says what it originally said?_ |
| 8 `prayer`      | believer | _I keep praying about the same thing and hearing nothing back. Am I doing something wrong?_                                     |
| 9 `religions`   | skeptic  | _How is Christianity actually different from Hinduism, Buddhism or Islam? They all seem to make the same kind of claims._       |
| 10 `trinity`    | newcomer | _Christians say there is one God but then talk about three. How is that not just three gods?_                                   |

Personas: skeptic 4 · newcomer 3 · seeker 2 · believer 1. **The believer thinness
is HONEST** — this estate publishes seeker apologetics, not discipleship. The
`everystudent-fr` Part B suite hit the same wall and recorded it the same way.

#### How they were derived, and why that matters

Grounded in what the estate **actually publishes** — the English parent's
117-article menu plus the article lists of the six smallest sources. A topic the
13-document Swahili site does not carry would manufacture cases with no valid
answer key there: guardrail #3a's defect reached by accident instead of policy.

**Engine-checked before the operator saw them** (guardrail #8 #2), over 9 sources
spanning 13 → 128 documents: `sw` `ti` `ka` `kk` `om` `ne` `de` `th` `zh-cn`.

- **Reach: 10/10 topics at 9/9 sources** (anxiety 8/9 before the reword).
- **No paraphrase smell** — the top score across ~150 probe queries was **0.701**,
  clear of the 0.75 line. No question restates an article title.

#### Three topics were REWORDED after an A/B, and the reasoning is worth keeping

| Topic       | Chosen        | Mean score          | Why it won                                                                       |
| ----------- | ------------- | ------------------- | -------------------------------------------------------------------------------- |
| `anxiety`   | variant **C** | 0.395 → **0.583**   | the original missed `sw` entirely and sat at 0.375–0.412, barely over the cutoff |
| `religions` | variant **B** | 0.487 → **0.572**   | fixes `kk` (now finds `Құдаймен байланыс`)                                       |
| `know-god`  | variant **B** | 0.584 → **0.526** ⬇ | **the one case where the LOWER-scoring variant won**                             |

⚠️ **`know-god` is deliberately the lower-scoring choice.** Variant B lands on the
right article **6 of 8 times vs 4 of 8** — `sw` _Mungu ni Nani?_, `de` _Wer oder
was ist Gott?_, `zh` _谁是神_, `th` _ธรรมชาติของพระเจ้า_ — where the original
drifted to peace and purpose pages. Its weakest score is 0.449, well clear of
0.37, so there was no headroom to trade away. **Score is not the objective;
landing on the right document is.**

#### 🔴 A misread worth recording so nobody repeats it

An earlier pass reported `religions` as "landing on generic _Connecting with God_
pages instead of the world-religions comparison". **That was WRONG, and it was
wrong because it judged by TITLE.** Reading the actual chunk text settles it:

- `de` `/artikel/hochsten.html` subtitle: _"Hinduismus, Buddhismus, Christentum,
  Islam, New Age - ist das nicht alles das Gleiche?"_
- `sw` `/a/kuunganishwa.html` body compares Allah, Christianity, one eternal God.

`hochsten` · `kuunganishwa` · `kavshiri205` · `205divine` · `baylanis` are the
**same article** under localised titles — the estate's `/a/205` world-religions
piece, the same one `everystudent-fr` credits as `/a/205divin.html`. **This is
golden guardrail #5 exactly: curate on content, never on titles.** The estate
localises slugs AND titles, so a title-based judgement of a sibling source is
unreliable by construction.

ⓘ **Muslim-majority sites answer `bible-trust` with Islam articles** — `kk` and
`th` return _"Jesus and Islam"_, `zh` returns _耶稣与伊斯兰_. Not an error: the
scripture-corruption question (_tahrif_) is where those sites treat Bible
reliability, and the existing `esar-skeptic-tahrif` case is this exact shape.

ⓘ **`ti` cannot support the full menu** — 4 distinct documents across 10 topics,
everything collapsing onto `peace.html` / `religions.html` / `atheist.html`, with
`bible-trust` at 0.379. Its 14 documents genuinely lack purpose, Jesus' death,
Bible, prayer and Trinity articles. **Draw ~4 topics for `ti`, not 10** — which is
what the `docs ÷ 8` sizing gives anyway.

#### ⏭️ What remains in Phase 5 — the large part

1. **Part A** — re-review the 18 `es` + `zh` cases for newly-relevant campaign
   documents. This is what recovers the −4.5% / −15.5%.
2. **Part B** — author golden suites for 45 languages from the §0.7 topic menu,
   each case carrying `# EN:`, a `# RETRIEVED` block, and an `evidence_tier`.
   **Guardrail #4 is unchanged: nothing reaches `eval/qa-golden.yaml` without an
   explicit operator approval turn.** This is the operator-attention cost §1
   named as the campaign's real binding constraint.
3. **Re-run the baseline** once cases land, and read the per-tier split.

#### The Part B running order — largest tier first (operator direction, 2026-08-03)

Sizing is **`docs ÷ 8`, floored at 4, capped at 10** — about **320 cases**, not a
flat 450. A 10-case suite over Swahili's 13 documents is one question per
document, which enumerates rather than measures.

| Tier                              | Sources |  Docs | Cases each | Subtotal |
| --------------------------------- | ------: | ----: | ---------: | -------: |
| **A — large (70+)** ⬅ **STARTED** |      14 | 1,159 |       9–10 |     ~135 |
| B — mid (40–69)                   |      16 |   830 |        5–8 |     ~105 |
| C — small (25–39)                 |       9 |   300 |        4–5 |      ~40 |
| D — tiny (<25)                    |       8 |   126 |          4 |      ~32 |

**Tier A, largest first:** `zh-cn` 128 · `ru` 95 · `bg` 84 · `sk` 83 · `hu` 83 ·
`mn` 82 · `ja` 79 · `pl` 77 · `sq` 77 · `es` 76 · `fa` 75 · `pt` 75 · `cs` 74 ·
`tr` 71.

⚠️ **`zh-cn` and `es` carry a Part-A dependency.** They are the only two campaign
languages with existing cases, and Part B discovery for them surfaces exactly the
documents Part A needs to credit. **Do both in one pass per language** rather than
re-running discovery twice.

### 0.8 🔵 Part B — tier A started 2026-08-03, `everystudent-zh-cn` first

**Discovery is measured, not assumed:** running the §0.7 English topic menu at
topK 20 over `zh-cn` produced **51 distinct candidate documents out of 128**, with
all ten topics covered. That is the pool the in-language questions are authored
from. `.tmp-diag/phase5-partb-discover.ts <sourceKey> <language>` reruns it for
any source.

⚠️ **The discovery script prints CHUNK TEXT, not titles, and that is deliberate**
— §0.7's `religions` misread happened because a title was trusted. This estate
localises titles as well as slugs, so a sibling source's title is not evidence.

#### 🟡 ESCALATION — `everystudent-zh-cn` carries a 37-document Gospel-of-John COURSE

Found during discovery, not looked for. **No other campaign source has anything
like it** — `zh-cn` is the only key with a `/john/` namespace.

|               |                                                               |
| ------------- | ------------------------------------------------------------- |
| Documents     | **37 of 128 (29% of the source)**                             |
| Chunks / size | 38 chunks · 51,059 chars total · avg **1,344** chars          |
| Shape         | sequential lessons — `/john/john1.html` … `/john/john37.html` |

**This is NOT the §12 scripture-policy violation it first looks like.** Reading
`/john/john1.html` settles it: a welcome page, reader testimonials, advice on
choosing a Bible translation, and worksheet prompts — a **correspondence
discipleship course**, i.e. ministry writing that teaches _through_ John. The
things §12 blocked were raw scripture dumps: `sq /a/gjoni.html` (98,887 ch),
`es /articulos/biblia_juan.html` (100,409 ch), and #131's `-ar` Gospel of John
(23,624 ch) — one huge document each. These are 1.3k-char lessons.

**What IS worth a decision, and it is corpus composition, not policy:**

1. **A sequential course makes a poor retrieval target.** "Lesson 30: John
   chapter 19" answers _"what does John 19 say"_ — nobody's seeker question.
   Lesson 1 is mostly testimonials and admin.
2. **29% of the Chinese source is this course**, and it competes inside the `zh`
   bucket against `thelife-zh` and `zh-tw`. 🔎 **Plausibly a contributor to the
   `zh` coverage drop of −15.5%** measured in §0.6 — not proven, worth checking.
3. Two lessons did surface as `jesus-death` candidates (0.531 / 0.489), below the
   real article `/a/jesusinislam.html` at 0.532.

⏭️ **Not a blocker for authoring** — every topic's best candidates are genuine
articles, so the `zh-cn` suite is authorable without crediting a single lesson.
**Do not credit `/john/**`in any relevant set until this is decided.** Same
escalation shape as`bg`(2026-07-29) and`he` (2026-07-30): the agent surfaces
it, Jaco decides.

🔎 **Confirmed harmless to this suite:** across all ten in-language questions,
**zero** `/john/` lessons appeared in any top 8 — including `jesus-death`, the
one topic the course covers directly. Excluding them costs the suite nothing.

#### ✅ APPROVED AND WRITTEN 2026-08-03 — `everystudent-zh-cn`, 10 cases

Operator approved in session; the ten cases are now in **`eval/qa-golden.yaml`**
(**130 → 140 cases**), with the full working preserved at
`eval/candidates-everystudent-zh-cn.yaml`. **This was the guardrail-#4 approval
turn** — drafted, presented, stopped, written only after an explicit "approve".

10 cases · **34 credits over 31 distinct documents**, every one judged on chunk
text. **`everystudent-zh-cn` is the first campaign source with golden cases.**

| Check                                                 | Result                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Paraphrase smell (guardrail #8 #2)                    | ✅ max **0.689**, clear of 0.75                               |
| Every credited path resolves to exactly 1 doc (#8 #3) | ✅ **31 / 31**                                                |
| Personas                                              | skeptic 4 · newcomer 3 · seeker 2 · believer 1 — matches §0.7 |
| `evidence_tier`                                       | `llm-translated` on all ten                                   |

🔴 **A second TITLE TRAP, caught the same way as §0.7's.** `/a/yesno.html` carries
the SEO title _"是否有神的存在 - 相信神真实存在的六个理由"_ — "Is there a God: six
reasons to believe God exists". **Its body is about FREE WILL AND
DECISION-MAKING.** It was about to be credited for `god-exists` on the title
alone. It is not credited. **Two title traps in two sources: on this estate a
title is not evidence, full stop.**

⚠️ **Cross-source credits are DELIBERATELY ABSENT.** The `zh` bucket also holds
`thelife-zh` and `zh-tw`, and their documents outrank `zh-cn` on several
questions. Under the living-relevant-set model they should be credited, but
crediting a document nobody has READ would break guardrail #5. **Deferred to
Part A, which reads them.**

#### ✅ MEASURED after the write — and it refutes this file's own prediction

`pnpm eval`, 140 cases, `eval/results-2026-08-03.md`:

|                        | Before (130 cases) |                       After (140) |
| ---------------------- | -----------------: | --------------------------------: |
| recall@10              |              1.000 |                         **1.000** |
| coverage               |              0.722 |                         **0.736** |
| `zh` language coverage |              0.733 |                         **0.815** |
| `everystudent-zh-cn`   |                  — | **recall 1.000 · coverage 0.897** |

**0.897 is the second-highest per-source coverage in the suite**, behind only
`everystudent-ar` (0.979). All ten cases hit.

🔴 **An earlier version of this section predicted `zh-cn` coverage would "read
LOW" because the cross-source credits were deferred. That was WRONG, and the
reasoning error is worth keeping:** it conflated _"outranked by `thelife-zh`"_
with _"pushed out of the top 10"_. Retrieval returns **ten** results; competing
sources take some slots but nowhere near enough to displace the credited
documents. Three cases have a competing source as their **top** hit and still
return 100% of their credited set — `zhcn-skeptic-kunan` 5/5,
`zhcn-seeker-jiaolv` 4/4, `zhcn-newcomer-yesusi` 3/3.

**Lesson for the remaining 44 suites: do not discount a coverage forecast for
competition alone.** Competition costs _rank_ (MRR, P@1), not _recall/coverage_,
until it pushes past k=10.

ⓘ The one case that DID behave as predicted is the one flagged as weakest:
`zhcn-seeker-mubiao` (purpose) — **rank 5, coverage 1/3**. `thelife-zh` genuinely
owns that topic. Keeping it was right; it is the only case in the suite recording
a real gap.

#### ✅ The `evidence_tier` split works in production

```
per-evidence-tier coverage:
  (untagged)       n=130  recall@10=1.000  coverage=0.724
  llm-translated   n=10   recall@10=1.000  coverage=0.897
```

Two buckets that never average together — exactly what §7's decision asked for.
The 130 pre-existing cases moved 0.721 → 0.724, **inside the run-to-run noise
measured in §0.6**, so the new cases disturbed nothing.

### 0.9 ✅ PART A — DONE 2026-08-04. 26 credits, 8 cases, three cases to rank 1

**Operator approved in session ("write the 26 accepted"). Full working —
including all 11 borderline candidates with the case for and against each — is
preserved at `eval/candidates-parta-2026-08-04.yaml`.**

Run: `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 npx tsx .tmp-diag/phase5-parta.ts`
→ 18 cases, 75 candidates ≥ 0.45. **Every one of the 63 distinct candidate
documents was then re-read IN FULL from the database** (title + opening
~1,400 chars + the matched chunk). The 240-char snippet the script prints is
NOT enough — see the boilerplate-tail finding below. **26 accepted · 11 flagged
to the operator · 38 rejected.**

#### 📊 The result: Part A bought RANK, not coverage — and that is correct

140 cases before and after, same corpus (`results-2026-08-03-partb-zhcn-keep.md`
→ `results-2026-08-04-parta-keep.md`):

| Metric      | Before |     After | Δ relative |
| ----------- | -----: | --------: | ---------: |
| precision@1 |  0.707 | **0.736** |  **+4.1%** |
| MRR         |  0.821 | **0.842** |  **+2.6%** |
| recall@3    |  0.914 | **0.936** |  **+2.4%** |
| recall@10   |  1.000 |     1.000 |       0.0% |
| coverage    |  0.736 |     0.734 |      −0.3% |

🟢 **This is the §0.8 lesson running in reverse, and it confirms it.** §0.8
found that competition costs _rank_, not recall/coverage. Part A credits the
competitors — so what recovers is **rank**. Coverage barely moves because every
new credit also enlarges its case's denominator.

**Per case — three went from rank 4/7 to rank 1:**

| Case                           | rank before → after | coverage before → after |
| ------------------------------ | ------------------- | ----------------------- |
| `tlzh-skeptic-tianzai`         | **7 → 1**           | 1/1 → **9/11**          |
| `cru-es-skeptic-jesus-hombre`  | **4 → 1**           | 2/3 → **6/8**           |
| `tlzh-seeker-yiyi`             | **4 → 1**           | 2/4 → **5/7**           |
| `cru-es-seeker-vacio`          | 2 → 2               | 1/1 → **4/4**           |
| `cru-es-believer-dios-callado` | 1 → 1               | 4/4 → **5/5**           |
| `tlzh-seeker-yali`             | 1 → 1               | 4/4 → 5/6               |
| `tlzh-seeker-waiyu`            | 2 → 2               | 2/3 → 3/4               |
| `tlzh-newcomer-xinzhu`         | 3 → 3               | 1/2 → **1/3** ⚠         |

⚠️ **`xinzhu` got WORSE on purpose, and that is guardrail #8 §2 working.** Its
new credit `/a/personally.html` (the Four Spiritual Laws — literally "the first
step") is ranked **15th** by the engine, behind fourteen boilerplate tails, so it
is not returned at k=10 and coverage fell 1/2 → 1/3. Crediting it makes the eval
**record** the defect instead of hiding it. "Keep the honest phrasing and let the
eval record the gap — a case that always passes measures nothing."

Per-language: `es` **0.896 → 0.906**; `zh` 0.815 → 0.804 (the `zh` dip is the
same denominator effect — 5 more `zh` cases now credit `zh-cn`, taking its
per-source coverage 0.897 → 0.864 over 15 cases instead of 10). `ar` `en` `fr`
unmoved. Tier split intact: `(untagged)` n=130 0.722 · `llm-translated` n=10 0.897.

#### 🔴 THE FINDING — the boilerplate-tail trap. Read this before Part B.

**38 of 75 candidates were rejected and most failed the same way.** Nearly every
everystudent article closes with the same move: a short gospel summary and an
invitation prayer. **That tail is its own chunk.** So a question about _how to
begin believing_ matches the TAIL of articles about homosexuality, pornography,
dating and world religions — while the one article that actually answers it ranks
last. `tlzh-newcomer-xinzhu` is the clean specimen:

|   Rank |     Score | Document                 | What the document is actually about     |
| -----: | --------: | ------------------------ | --------------------------------------- |
|      1 |     0.660 | `/a/gaylesbian.html`     | Does God love homosexuals?              |
|      4 |     0.625 | `/a/religion.html`       | Are all religions the same?             |
|      5 |     0.620 | `/a/toxicnew.html`       | Breaking free from pornography          |
|     12 |     0.552 | `/a/wolves.html`         | Sex and dating                          |
| **15** | **0.543** | **`/a/personally.html`** | **Knowing God personally — THE ANSWER** |

§0.9 predicted "a third trap should be assumed to exist" after the two title
traps (§0.7 `/a/hochsten.html`, §0.8 `/a/yesno.html`). **This is it, and it is
worse than both: it is not one document, it is a template across all 45
sources.** A hit whose matched chunk is the closing invitation prayer is evidence
about the TEMPLATE, not about the document.

**Rule for the remaining 44 suites: read the OPENING of the document, not only
the matched chunk, before crediting it.**

ⓘ **The `zh-cn` suite was checked for contamination and is clean.** Four of its
ten cases credit a tail-carrying document; `/a/peace.html`→anxiety and
`/a/religion.html`→world-religions are legitimate, and the two marginal ones
(`/a/reallife.html`, `/a/startanewlife.html`) include the case already on record
as the suite's weakest (`zhcn-seeker-mubiao`, 1/3). No change made.

#### Two zero-credit cases, both verified correct against the database

1. **HELL — `cru-es-skeptic-infierno` gets nothing, and should.** All seven
   candidates are about suffering and evil, which is the question's _premise_,
   not its subject. **`everystudent-es` has no article on hell**: the whole
   afterlife shelf is `/articulos/cielo.html` ("What is heaven like?"),
   `/articulos/inevitable.html` (read in full — fear of death, not judgment) and
   `/articulos/reencarnacion.html`. The Chinese sibling DOES have it
   (`/a/punish.html`). A corpus-composition fact; nothing to fix.
2. **DEPRESSION — `cru-es-seeker-desanimo` gets nothing.** `/articulos/blues.html`
   (emotional pain, suicidal thoughts) exists, but the engine ranked it for the
   _emptiness_ question and left it under 0.45 here. A retrieval observation, not
   a curation one.

#### What Part A was

The living-relevant-set rule (`docs/eval-approach.md`): when a new source is
ingested, **re-review prior questions** for newly-relevant documents — do not
only draft new ones. The campaign added 2,281 documents; 18 existing cases can
now be answered by them and credit **zero**.

**Scope is measured, not assumed — 18 cases, and 122 are a provable no-op:**

| Cases                 | Why                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 10 × `tlzh-*` (`zh`)  | `zh` is multi-source: `thelife-zh` + `zh-cn` + `zh-tw`                                                                             |
| 8 × `cru-es-*` (`es`) | `es` is multi-source: `cru` + `familylife` + `everystudent-es`                                                                     |
| the other 122         | `corpus-search-store.ts` applies a strict `eq(documents.language, …)`; no case can return a document in a language it has none for |

#### 🎯 ✅ FIXED — the single highest-value case, as predicted

`tlzh-skeptic-tianzai` — _"如果真有一位慈爱的神，为什么世界上还有这么多天灾人祸？"_
("If there really is a loving God, why are there so many disasters and
tragedies?")

- Currently credits **one** document, `thelife-zh /q-and-a`, which lands at
  **rank 7**.
- **Rank 1 is `everystudent-zh-cn /a/isgodgood.html` at 0.741** — an article
  titled _"神是慈爱的吗？"_ ("Is God loving?") that answers the question head-on
  and is **not credited**.

**Four `tlzh` cases already return an uncredited `zh-cn` document as their TOP
hit:**

| Case                   | Rank of first credited hit | Uncredited top hit            |
| ---------------------- | -------------------------: | ----------------------------- |
| `tlzh-skeptic-tianzai` |                      **7** | `/a/isgodgood.html` **0.741** |
| `tlzh-newcomer-xinzhu` |                          3 | `/a/gaylesbian.html` 0.660    |
| `tlzh-seeker-yiyi`     |                          4 | `/a/purpose.html` 0.584       |
| `tlzh-believer-raoshu` |                          5 | `/father-and-me` 0.575        |

That is where the `zh` coverage shortfall lives, and it is answer-key staleness,
not broken retrieval.

✅ **All four were re-reviewed on 2026-08-04.** `tianzai` took all ten of its
proposed credits and went **rank 7 → rank 1**. The other three did NOT: reading
the full documents showed `/a/gaylesbian.html` (xinzhu) and `/father-and-me`
(raoshu) were boilerplate-tail matches, and `/a/purpose.html` (yiyi) was credited
along with two others. **The "uncredited top hit" column above was a title-and-
score read; three of its four rows did not survive contact with the text.**

#### Rules that apply, and one that has already bitten twice

1. 🔴 **Judge on CHUNK TEXT, never a title** (guardrail #5). This estate has
   produced **two** title traps: `/a/hochsten.html` (§0.7 — looked generic, IS the
   world-religions article) and `/a/yesno.html` (§0.8 — titled _"six reasons to
   believe God exists"_, body is about **free will**). The script prints text for
   this reason. **A third trap should be assumed to exist.**
2. **Do not credit `/john/**`\*\* until §0.8 is settled.
3. **Verify every new credit resolves to exactly one document** before the final
   eval (guardrail #8 #3). The query is in §0.8's checklist.
4. `cru-es-*` cases pin `language: es` and credit `cru`, which is multilingual —
   leave those pins alone.

#### 🧰 Tooling written this session — all in `.tmp-diag/` (git-ignored, delete before committing)

⚠️ **These must live INSIDE the repo** for the `@/` alias to resolve; a scratchpad
path fails with _"Top-level await is not supported with the cjs output format"_.
`.tmp-diag/` is already in `.git/info/exclude`. **They fail `pnpm lint`
(`no-explicit-any` in the `psql` helper) — that is why the gate is run as
`npx eslint scripts/ tests/ src/` while they exist.**

| Script                     | What it does                                                               | Run?          |
| -------------------------- | -------------------------------------------------------------------------- | ------------- |
| `phase4-smoke.ts`          | per-language retrieve smoke (Phase 4) — **reuse for Phase 7 against prod** | ✅            |
| `phase5-health.ts`         | retrieval-FLOOR probe: self-retrieval on own title, 8 docs × 47 sources    | ✅            |
| `phase5-crosslingual.ts`   | can an English question reach each language?                               | ✅            |
| `phase5-xling-distinct.ts` | do 6 questions reach 6 different docs, or collapse?                        | ✅            |
| `phase5-topicset.ts`       | engine-check the §0.7 topic menu over 9 sources                            | ✅            |
| `phase5-reword.ts`         | A/B weak topics against rewordings                                         | ✅            |
| `phase5-partb-discover.ts` | **`<sourceKey> <language>`** — Part B candidate pool with chunk text       | ✅ `zh-cn`    |
| `phase5-parta.ts`          | **Part A re-review over the 18 cases**                                     | ✅ 2026-08-04 |

⚠️ **`phase5-parta.ts` prints only 240 chars of chunk text — that is NOT enough
to judge on.** Part A had to re-read all 63 candidate documents from the database
afterwards. If it is reused, widen the slice or pair it with a full-text dump.

#### ⓘ Status of the `/john/` recommendation — read this before re-opening it

The recommendation put to Jaco was **"leave it, close the escalation"**, on the
evidence that it passes §12 (ministry writing, not scripture text) and is
measurably inert: **zero `/john/` documents appear in any of the 130-case eval
results, and zero surfaced across the ten Chinese questions.** He replied
"approve" to a message whose explicit ask was _"write the ten cases, then start
Part A"_. **Treat the John recommendation as accepted but NOT separately
confirmed** — if it matters, it costs one sentence to re-ask. No case credits a
lesson either way, so nothing depends on it today.

#### ⏭️ After Part A — this is the next action

⚠️ **SUPERSEDED 2026-08-04 — this describes the retired one-at-a-time loop.**
The operator stopped it; see the OPERATOR DIRECTION block in §0. **Tier A is now
COMPLETE — all 14 of its sources have suites** (`zh-cn` §0.8, `ru` §0.10, `bg`
§0.11, and the 11 of batch 1 in §0.12). ✅ **And so is everything after it:
batches B, C and D all landed together on 2026-08-06 as one 30-source batch
(§0.13). There is no "next batch" — Phase 5 is closed.**
The per-source recipe below still applies to each source WITHIN a batch —
`.tmp-diag/phase5-partb-discover.ts <sourceKey> <language>` and the §0.7 topic
menu. **`es`'s Part A credits are already in**, so its Part B pass no longer
carries the dependency `zh-cn`'s did.

⚠️ **Two operational hazards this session hit, both now avoidable:**

1. 🔴 **`pnpm eval` writes a UTC-dated filename and WILL silently overwrite a
   same-day record.** On 2026-08-04 at 10:06 NZST it was still 2026-08-03 UTC, so
   the run was about to destroy `results-2026-08-03.md` — the record of the
   `zh-cn` suite. `eval/results-*.md` is **gitignored except `*-keep.md`**, so
   nothing would have recovered it. **Before any `pnpm eval`, copy the existing
   `eval/results-<UTC-today>.md` to `…-<what-it-recorded>-keep.md` first**, then
   rename the new output to its true NZ date. That is what produced
   `results-2026-08-03-partb-zhcn-keep.md` and `results-2026-08-04-parta-keep.md`.
2. **Do not run a Part B discovery pass concurrently with `pnpm eval`.** The eval
   has no resume and one transient embedder blip discards the whole run (§4).

### 0.10 ✅ Part B suite 2 — `everystudent-ru`, 10 cases, coverage 0.950 (2026-08-04)

**Operator approved all ten in session; `evidence_tier: llm-translated`.** Full
working — every rejection with its reason — in
`eval/candidates-everystudent-ru.yaml`. Cases **140 → 150**.

| Check                    | Result                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| Discovery                | 66 distinct candidates of 95 documents, all ten §0.7 topics covered |
| Credits                  | **29 over 10 cases**, 29 distinct documents                         |
| Personas                 | skeptic 4 · newcomer 3 · seeker 2 · believer 1 — matches §0.7       |
| Paraphrase smell (#8 §2) | ✅ **0**, max top score 0.738                                       |
| Path uniqueness (#8 §3)  | ✅ 29 / 29                                                          |
| Null-language (#3a)      | ✅ 0                                                                |

**Measured, 150 cases** (`eval/results-2026-08-04-partb-ru-keep.md`):

|                       | 140 cases (Part A) |                150 cases (+ `ru`) |
| --------------------- | -----------------: | --------------------------------: |
| recall@10             |              1.000 |                         **1.000** |
| coverage              |              0.734 |                         **0.747** |
| `everystudent-ru`     |                  — | **recall 1.000 · coverage 0.950** |
| `llm-translated` tier |       n=10 · 0.897 |                  **n=20 · 0.923** |
| `(untagged)` n=130    |              0.722 |                     0.720 (noise) |

**0.950 is the second-highest per-source coverage in the whole suite**, behind
only `everystudent-ar` (0.979). Eight of the ten cases returned **100%** of their
credited set.

#### 🔴 THE ENGINE CHECK IS NOT OPTIONAL — it caught three defects before the operator saw the draft

Run it every time (guardrail #8 §2). On `ru` it found:

| Defect                                                                          | Fix                                                                           | Result                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| Trinity question scored **0.807** — it restated `/a/troitsu.html`'s own opening | Reframed as what a newcomer _notices in a service_, not the doctrinal formula | **0.738**, still rank 1 |
| `/a/znat.html` credited but outside top 10                                      | Dropped — its subject is the _relationship_, not what God is like             | —                       |
| Both `jesus-death` credits outside top 10                                       | Reworded, re-tested — still outside                                           | Kept; see below         |

#### 🔴 The boilerplate-tail trap fired here too — in BOTH directions

§0.9 predicted it would. Confirmed:

- **Rank-1 hits REJECTED on the text.** `/a/gdebog.html` (0.661) for the anxiety
  question — it is the _disaster_ article. `/a/nastoy.html` (0.734) for the cross
  question — it is three fulfilment testimonies with a gospel tail.
- **A candidate a title-only reviewer would REJECT is the best document in the
  source.** `/a/chakr.html` — _"Anxiety and Chakra Healing"_ — is a woman's
  account of chronic anxiety, depression, Buddhism, yoga and a US$200
  energy-healing course, and what she found instead. Credited at rank 2.

**Judging by title would have got both directions wrong on the same source.**

#### ⓘ `esru-newcomer-krest` — a wrong prediction, corrected

This file and the case's own comment block said the case would score
**recall@10 = 0**, because neither credited document reached the top 10 in two
separate pre-write checks. **The measured result was 1 / 2 at rank 7.**

The cause is the run-to-run tie reordering §0.6 documents: the check and the eval
differ by **0.001** on the top score (0.734 vs 0.733), and a credit sitting just
outside k=10 crossed the line. **The case sits on the boundary and its result will
flap between 0/2 and 1/2.** Do not read a future 0/2 as a regression, and do not
"fix" it by crediting a tail — it is the only case in the campaign that measures
the boilerplate-tail defect instead of working around it.

`everystudent-ru` genuinely has **no article whose subject is what the cross
accomplished**; the atonement is taught inside `/a/uznat.html` and
`/a/dovyeryat.html`, the two "begin a relationship with God" pages — which are
exactly the pages the shared invitation-prayer chunk buries. Same shape as the
Chinese `/a/personally.html` at rank 15. **Two languages, one defect.**

### 0.11 ✅ Part B suite 3 — `everystudent-bg`, 10 cases, coverage 0.975 (2026-08-04)

**Operator approved all ten in session; `evidence_tier: llm-translated`.** Working
record in `eval/candidates-everystudent-bg.yaml`. Cases **150 → 160**.

| Check                    | Result                                               |
| ------------------------ | ---------------------------------------------------- |
| Discovery                | 58 distinct candidates of 84, all ten topics covered |
| Credits                  | **25 over 10 cases**, 25 distinct documents          |
| Personas                 | skeptic 4 · newcomer 3 · seeker 2 · believer 1       |
| Paraphrase smell (#8 §2) | round 1: **4** → round 2: **0** (max 0.746)          |
| Path uniqueness (#8 §3)  | ✅ 25 / 25 · null-language ✅ 0                      |

**Measured, 160 cases** (`eval/results-2026-08-04-partb-bg-keep.md`):

|                       |  150 (+`ru`) |                       160 (+`bg`) |
| --------------------- | -----------: | --------------------------------: |
| recall@10             |        1.000 |                         **1.000** |
| coverage              |        0.747 |                         **0.762** |
| `everystudent-bg`     |            — | **recall 1.000 · coverage 0.975** |
| `llm-translated` tier | n=20 · 0.923 |                  **n=30 · 0.941** |

**Nine of ten cases returned 100% of their credited set.** The tenth
(`katastrofa`, 3/4) is the deliberate one — see below.

#### 🟢 Bulgarian is the CONTROL that isolates the Russian gap

`esru-newcomer-krest` cannot retrieve its credits because `everystudent-ru` has
**no article whose subject is the atonement**. Bulgarian **has** one —
_"The crucifixion of Jesus — why did Jesus die?"_, 14.1k chars — and
`esbg-newcomer-krast` returns it at rank 3, coverage **1/1**.

Same estate, same embedder, same topic menu, opposite result. **The Russian
result is corpus composition, not a systemic retrieval defect.** State this
whenever the Russian case's expected miss comes up.

#### An honest reword that COST a credit, kept on purpose

`esbg-skeptic-katastrofa` v1 scored **0.752** — it restated the article's own
opening line. Reworded to the asker's private difficulty → **0.707**, smell gone,
but `Добър ли е Бог?` ("Is God good?") fell out of the top 10. **Both the reword
and the credit were kept**, so the case scores **3/4** by design (guardrail #8 §2:
"keep the honest phrasing and let the eval record the gap"). That document is the
Bulgarian twin of the Chinese `/a/isgodgood.html`, which was **rank 1** for the
Chinese version of this same question in Part A.

#### 🔴 NEW, AND IT CHANGES HOW EVERY REMAINING SUITE IS READ — small per-source buckets are NOISY

`everystudent-es` coverage moved **0.933 → 0.822** in this run — a **−11.9%
relative swing with ZERO change to any Spanish key.** The Bulgarian suite added no
Spanish cases. Two credited documents simply fell out of the top 10 between runs:

| Case                          | 150-case run               | 160-case run                   |
| ----------------------------- | -------------------------- | ------------------------------ |
| `cru-es-seeker-vacio`         | 4/4                        | **3/4**                        |
| `cru-es-skeptic-jesus-hombre` | 6/8 (5/5 of its `es` docs) | 6/8 (**4/5** of its `es` docs) |

§0.6 measured whole-corpus run-to-run drift at **0.14%**. On a **3-case** bucket
the same underlying tie-reordering produces **11.9%**. The noise does not grow —
the denominator shrinks.

**Rule: do not read a per-source coverage number built on fewer than ~8 cases as
signal.** Each new suite lands at n=10, so its FIRST number is the least reliable
one it will ever have. Compare `recall@10` (stable at 1.000 throughout) and the
whole-corpus coverage instead.

#### Two hazards specific to `everystudent-bg`

1. **Percent-encoded Cyrillic paths, 150–250 chars each.** `eval-metrics.ts`
   matches on `new URL(url).pathname` — the ENCODED form — so that is what the
   keys hold. Both the draft and the write resolved paths **from titles via the
   database**; hand-typing them is a transcription-error factory. First campaign
   source with this shape (`zh-cn` and `ru` are plain ASCII).
2. **One title is duplicated in the source.** `Исус Бог ли е?` ("Is Jesus God?")
   exists at two different paths. A title→path map silently keeps one. Neither is
   credited, but title-keyed tooling on this source must dedupe first.

ⓘ Third source, third **title trap**: `Защо можем да разчитаме на Бог?` ("Why can
we rely on God?") opens _"What is God like? Six personal traits of God"_ — it is
the know-god article. Titles remain unusable as evidence on this estate.

### 0.12 ✅ BATCH 1 — all 11 tier-A sources, drafted in parallel, one approval (2026-08-04)

**The first bulk batch, run on the operator's 2026-08-04 direction. 11 sources
drafted concurrently by subagents, presented as one table, approved in ONE turn,
written with one command, measured with one eval.** Cases **160 → 270**.

| Source          | Docs | Cases | Credits | Check rounds | Smells r1→final |  Coverage |
| --------------- | ---: | ----: | ------: | -----------: | --------------- | --------: |
| `pl` Polish     |   77 |    10 |      28 |            2 | 1 → 0           | **1.000** |
| `pt` Portuguese |   75 |    10 |      28 |            2 | 0 → 0           |     0.983 |
| `cs` Czech      |   74 |    10 |      32 |            5 | 0 → 0           |     0.980 |
| `hu` Hungarian  |   83 |    10 |      27 |            3 | 2 → 0           |     0.980 |
| `ja` Japanese   |   79 |    10 |      25 |            3 | 0 → 0           |     0.980 |
| `fa` Persian    |   75 |    10 |      27 |            5 | 0 → 0           |     0.967 |
| `es` Spanish    |   76 |    10 |      33 |            3 | 1 → 0           |     0.956 |
| `sk` Slovak     |   83 |    10 |      33 |            3 | 2 → 0           |     0.950 |
| `tr` Turkish    |   71 |    10 |      26 |            2 | 2 → 0           |     0.947 |
| `sq` Albanian   |   77 |    10 |      26 |            3 | 4 → 0           |     0.908 |
| `mn` Mongolian  |   82 |    10 |      30 |            3 | 0 → 0           |     0.867 |

**All 11 returned `recall@10 = 1.000`.** 12 paraphrase smells were caught and
fixed and ~50 credits repositioned or dropped **before** the operator saw anything.

#### Measured, 270 cases (`eval/results-2026-08-04-batch1-tierA-keep.md`)

| Metric               |     160 cases |         270 cases |           Δ |
| -------------------- | ------------: | ----------------: | ----------: |
| recall@10            |         1.000 |         **1.000** |        held |
| coverage             |         0.762 |         **0.841** |  **+10.4%** |
| recall@3             |         0.938 |         **0.956** |       +1.9% |
| MRR                  |         0.838 |         **0.857** |       +2.3% |
| precision@1          |         0.731 |         **0.759** |       +3.8% |
| `llm-translated`     |  n=30 · 0.941 | **n=140 · 0.953** |           — |
| `(untagged)` CONTROL | n=130 · 0.721 | **n=130 · 0.720** | **unmoved** |

🟢 **The control is the number that matters.** 110 new cases and 315 new credits
moved the 130 pre-campaign cases by 0.001. A bad batch would have shown here.

🟢 **§0.11's n=10 noise rule was confirmed in the direction predicted.**
`everystudent-es` read 0.822 at n=3 and was called noise, not signal. At n=13 it
reads **0.956**. Do not act on a per-source number below ~8 cases.

#### 🔴 THE SIX FAILURE MODES — the checklist for every remaining suite

Batch 1 found three that §0.9/§0.11 did not have. All six, in the order they bite:

1. **BOILERPLATE TAIL** (§0.9). Nearly every article closes with the same
   gospel-summary + invitation prayer, which is its own chunk. ⚠️ **Severity does
   NOT track the testimony share — that claim was wrong and §0.13 finding 5
   replaces it.** It tracks **how many documents carry the invitation-prayer
   chunk, wherever they are filed**; at 0% testimony ONE magnet document absorbs
   the entire load (`mk /a/molitvi306.html` was rank 1 for anxiety in a source
   with no story tree at all). The original evidence still stands as far as it
   goes: `hu` is 24% `/story/` and had tails at ranks 1, 2 AND 3 for its cross
   case. 🔑 **"Forgiveness of sins" is the estate's trigger phrase** — Turkish
   put it in a question and got Catholic-vs-Christian at rank 1, marriage advice at
   rank 2, sex-and-intimacy at rank 6. Removing it dropped 0.755 → 0.701 and
   cleared **all five tails** from the top 10. **Never put it in a question.**
2. **PURE-TAIL DOCUMENTS** (new, `sk`). 476–809 char pages that are _only_ a video
   promo plus the invitation prayer, with titles that look like perfect topic hits.
   Also found in `pt` and `es`. **Always print character length with the opening.**
3. **TITLE TRAPS** — every source has them; `cs` had **eight**. Three are now known
   to be SYSTEMATIC across languages, so expect them:
   - _"Why can we rely on / choose the God of the Bible?"_ → the six-attributes
     **what-is-God-like** article (`bg` `tr` `fa` `pt` `cs`)
   - _Nothing → Something → Who → Who 2_ → a four-part cosmological argument with
     contentless titles (`hu` `pl` `mn` `sk` `pt` `es` `fa` `cs`)
   - **REVERSE traps:** a page titled _"Coronavirus"_ is the source's general
     anxiety article (`hu` `pl` `sq` `tr` `pt` `es`); _"Anxiety and chakra healing"_
     is a chronic-anxiety account (`ru` `hu` `tr` `pt` `es`). A title-only reviewer
     **discards the best document in the source.**
4. **LEXICAL ARTIFACT FROM INCIDENTAL COLOUR** (new, `ja`). "Over drinks" as
   scene-setting pulled an alcohol article to rank 3. Keep incidental nouns out.
5. **EMOTIONAL FRAMING RETRIEVES EMOTIONAL DOCUMENTS** (new, `tr`/`hu`/`pt`).
   Framing faith as a crutch pulled inner-peace and loneliness articles while both
   evidence articles fell out; asking for _grounds_ went 0.583 → 0.704, 2/4 → 4/4.
6. **A QUESTION CAN FAIL WITHOUT SMELLING** (new, `sk`/`pt`). A clean 0.671 lost
   4 of 5 credits. **A low top score is not evidence of a good question — check
   WHICH documents came back.** Also: short questions lose to tails (a 13-word
   Polish question scored 0.500 flat; at natural length, 0.706 rank 1).

ⓘ **The 0.75 smell threshold is NOT universal.** Persian tops out at 0.710 over
five rounds — 0.75 was never reachable, and all five rounds went to _reach_.
Calibrate per source; judge reach by which documents return.

🔴 **Do not generalise that into "small sources cannot smell" — §0.13 finding 1
proves the opposite, and I got this backwards in writing.** Smell risk **rises**
as the corpus **shrinks**: at 13 documents each topic has exactly one article and
no near-duplicates to split the similarity, so a well-aimed question lands almost
on the document itself. `sw` (13 docs) hit **0.814**, higher than any 41–67-doc
source ever reached. **Never reason about smell headroom from anything except the
in-language check.**

#### Estate-level findings, now quantified

**The atonement gap.** 8 tier-A sources have a dedicated "why did Jesus die?"
article and rank it 1–5 (`cs` has TWO, at ranks 1 and 2). 3 do not — `ru`,
`zh-cn`, `mn`. ⚠️ **The 8-vs-3 ratio is a tier-A artefact and inverts across the
estate: batch 2's first 13 sources ran 4 with, 9 without, taking the running
total to 12 of 24 measured sources WITHOUT one** (§0.13 finding 2). It does not
track document count — `vi` (67 docs) and `ro` (64) are the two largest in that
group and both lack it. **`esru-newcomer-krest`'s expected miss is corpus
composition, confirmed a dozen times over.** Do not re-open it.

**The `bible-trust`/_tahrif_ pattern is about PUBLISHING, not audience — an
earlier generalisation in this file was wrong.** Japan (not Muslim-majority)
routes it through its Islam article. **Iran and Czechia have no Islam article at
all.** Czech answers it head-on with two standalone Bible-reliability pieces;
Portuguese beats the Islam article with a 40.5k manuscript-transmission article.

**🔴 ROOT CAUSE of the campaign's worst data incident, found by `fa`.**
**74 of 75 Persian documents (98.7%) contain Arabic-form ي/ك** mixed with Persian
ی/ک. §0.4 blamed `tinyld`; the real reason is that the Persian text genuinely
reads as Arabic to a character-frequency detector. **The sweep fixed the labels,
not the text.** So §0.4's "prod will reproduce the mislabels" is a _certainty_ for
Persian, not a precaution — Phase 7's re-sweep is mandatory.

#### Two decisions carried out of batch 1 — #1 RESOLVED, #2 still open

1. ✅ **RESOLVED 2026-08-06, and the premise below was WRONG — there are 13, not 1.**
   `everystudent-sq` `/a/ishte.html`, 24,883 chars, opens _"These are extracts
   taken directly from the Gospel of John… **no commentary added**"_ then runs
   into John 3. Same class as `sq /a/gjoni.html` (98.9k), `es
/articulos/biblia_juan.html` (100.4k) and the Arabic Gospel of John (#131) —
   all three of which WERE excluded.
   🔴 **"Audited all 45 sources: it is the only one left" is false.** It is one
   instance of the estate's **"Who was Jesus?"** page, which exists in **13
   sources** — see §0.13 finding 3 for the full table and the audit method that
   found them (a verse-density regex under-detects; slug family + size band does
   not). It is also **not inert**: `hy /a/whowas.html` takes rank 7 and
   `de /artikel/werwar.html` rank 8, consuming slots a real answer would hold.
   **Jaco approved excluding all 13 on 2026-08-06** — that is step 2 of START HERE.
2. **`cru` carries a duplicate-content defect that degrades the live Spanish eval.**
   One prayer article at **5 paths** (`21/22/23/24-cosas-por-las-cuales-orar…`,
   ~21 chunks each ≈ 105 duplicate chunks) plus **9 more duplicate-title pairs** in
   Spanish `cru`. They occupy ranks 2/4/5/6/7 of one case and are the direct reason
   `everystudent-es`'s only prayer article cannot beat rank 3. **Out of campaign
   scope — worth its own ticket.**

ⓘ One cross-suite inconsistency was found and FIXED: `esru-newcomer-kakoyon` now
also credits `/a/ktoto2.html` (the personhood article), matching the call `pt`
made on the same estate article for a near-identical question. A second reported
inconsistency (`ru` vs `fa` on anxiety) was checked and is **not real** — the two
agents compared different articles; `fa` has no chakra document.

#### 🔴 THE CLOSING PART A SWEEP — required, and bulk made it necessary

> ✅ **RAN 2026-08-06 and came back a NO-OP.** Record in §0.13.

Per-source Part A is impossible now. The living-relevant-set rule says a new
source makes prior questions answerable by new documents; with 42 sources landing
in batches, **one final Part A sweep over every existing case must run after the
last suite lands.** Without it the keys go stale exactly as §0.9 found them.
`.tmp-diag/phase5-parta.ts` was the starting point — widened into
`.tmp-diag/phase5-parta-sweep.ts` as specified (every case, 600-char slice).

#### 🧰 The batch machinery — reuse it verbatim

⚠️ **The per-source check scripts named below were SUPERSEDED in batch 2 by one
generic tool.** Hand-writing a bespoke check per source was the real reason batch
1 was slow — not lack of parallelism. Use `phase5-check.ts`. See §0.13.

| Tool                                                      | What it does                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.tmp-diag/phase5-partb-discover.ts <key> <lang>`         | candidate pool with chunk text, per §0.7 topic                                                                                                                                                                                                  |
| ~~`.tmp-diag/phase5-hu-check.ts` / `phase5-tr-check.ts`~~ | the correct _pattern_ — credits declared by PATH, DB used only to VALIDATE — but **replaced by the generic `phase5-check.ts`**                                                                                                                  |
| `.tmp-diag/assemble-batch.ts [--write] [--show] <keys…>`  | reads every `eval/candidates-everystudent-<k>.yaml`, **re-verifies every claim against the database**, emits the `qa-golden.yaml` block. Aborts the whole batch on any failure — a partial write is worse than none. Dry-run without `--write`. |

⚠️ **Do NOT copy `.tmp-diag/phase5-bg-check.ts`** — it resolves credit paths from
TITLES. Japanese found a duplicated title naming two DIFFERENT documents, one of
which was a title trap: a coin flip on which got credited. Use the `hu`/`tr` shape.

⚠️ **Give each parallel agent a UNIQUELY NAMED scratchpad file.** Two batch-1
agents overwrote each other's output; both had to re-run. Prefix with the source key.

#### The agent brief that produced this batch

Paste per source, substituting key/language/doc-count. It must contain: the
mandatory reads (§0.7, §0.9, §0.10, §0.11, two candidates files); **the absolute
rule that the agent must NOT write to `eval/qa-golden.yaml`** and must never run
`pnpm eval`; the six failure modes above; the discovery command; the null-language
and duplicate-title hazard queries; **the instruction to read document OPENINGS
with character lengths from the database**; sizing and persona rules; the
engine-check → fix → re-check loop with the DROP-or-KEEP decision made explicit;
the two verification queries; the output-file spec; and a **YAML-parses check**
(two batch-1 files did not parse — the killer is a `>` block scalar inside a
`{...}` flow mapping). Ask for the return as data: counts, per-round check
numbers, verification results, every trap instance with its document, content
gaps, and what the reviewer must decide.

### 0.13 ✅ BATCH 2 — ALL 30 REMAINING SOURCES IN ONE BATCH. PHASE 5 CLOSED (2026-08-06)

**Jaco, opening the session: _"I'm entirely unsure where we've got to, but I do
know we can't continue one source at a time. We need to knock out the remaining
work fast."_** So tiers B, C and D were collapsed into **one batch of 30 sources**
— drafted by 30 parallel subagents, approved in ONE turn, written with one
command, committed as `457ee51`, measured with one eval. Cases **270 → 416**.

#### 🔑 What actually made batch 1 slow — it was not a lack of parallelism

Batch 1 already ran 11 agents concurrently. The cost was that **every agent
hand-wrote its own bespoke check script** (`phase5-hu-check.ts`,
`phase5-tr-check.ts`, …) before it could measure anything. Two generic tools
removed that entirely, and both were validated by **reproducing `hu`'s recorded
batch-1 numbers exactly** before a single new agent was launched:

| Tool                                                | What it replaced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.tmp-diag/phase5-openings.ts <key>`                | per-agent SQL. Pure-DB, no embedder. Dumps every document's path/title/**char length**/chunks/language/opening, plus a hazard report and a short-document watchlist.                                                                                                                                                                                                                                                                                                                                                |
| `.tmp-diag/phase5-check.ts <key> <lang> [--update]` | **all 30 bespoke check scripts.** Reads `eval/candidates-everystudent-<key>.yaml` — _the same file `assemble-batch.ts` consumes_ — so draft, check and the eventual qa-golden block cannot drift. Verifies first and **exits before retrieval on failure**; then reports top score, smell verdict, every credit's rank, and every uncredited own-source hit with its char length. `--update` writes measured ranks back into the YAML, comments preserved, so the `# RETRIEVED` block is **measured, never typed**. |

#### The 30 suites

Tier B — mid (41–67 docs):

| Source | Docs | Cases | Credits | Rounds |  Coverage | Source  | Docs | Cases | Credits | Rounds |  Coverage |
| ------ | ---: | ----: | ------: | -----: | --------: | ------- | ---: | ----: | ------: | -----: | --------: |
| `vi`   |   67 |     8 |      22 |      4 |     0.927 | `et`    |   46 |     5 |      12 |      5 | **1.000** |
| `ro`   |   64 |     8 |      21 |      3 |     0.975 | `zh-tw` |   46 |     5 |      11 |      3 | 0.813 ⁽¹⁾ |
| `id`   |   57 |     7 |      16 |      3 |     0.952 | `de`    |   45 |     5 |      11 |      2 |     0.950 |
| `ms`   |   52 |     6 |      16 |      4 | **1.000** | `th`    |   44 |     5 |      10 |      3 | **1.000** |
| `mk`   |   49 |     6 |      16 |      3 |     0.967 | `hr`    |   41 |     5 |      15 |      4 |     0.960 |
| `lt`   |   49 |     6 |      15 |      3 | **1.000** | `am`    |   41 |     5 |      11 |      3 |     0.933 |
| `bn`   |   48 |     6 |      14 |      2 |     0.958 |         |      |       |         |        |           |
| `uk`   |   47 |     5 |      16 |      2 | **1.000** |         |      |       |         |        |           |

Tier C — small (30–38 docs) · Tier D — tiny (13–23 docs):

| Source | Docs | Cases | Credits |  Coverage | Source | Docs | Cases | Credits |  Coverage |
| ------ | ---: | ----: | ------: | --------: | ------ | ---: | ----: | ------: | --------: |
| `it`   |   38 |     4 |      10 |     0.938 | `sl`   |   23 |     4 |       6 | **1.000** |
| `ko`   |   37 |     4 |      12 | **1.000** | `ne`   |   20 |     4 |       6 | **1.000** |
| `hi`   |   34 |     4 |       8 | **1.000** | `om`   |   18 |     4 |       7 | **1.000** |
| `hy`   |   34 |     4 |       7 | **1.000** | `kk`   |   17 |     4 |       7 | **1.000** |
| `ur`   |   33 |     4 |       9 | **1.000** | `ka`   |   16 |     4 |       6 | **1.000** |
| `el`   |   32 |     4 |       7 |     0.875 | `ti`   |   14 |     4 |       8 | **1.000** |
| `my`   |   31 |     4 |      11 |     0.833 | `sw`   |   13 |     4 |       5 | **1.000** |
| `ta`   |   31 |     4 |       9 | **1.000** |        |      |       |         |           |
| `te`   |   30 |     4 |       9 | **1.000** |        |      |       |         |           |

**30 sources · 146 cases · 333 credits · every one at recall@10 = 1.000.**
⁽¹⁾ `zh-tw`'s 0.813 is measured over **8** cases — its own 5 plus 3 pre-existing
`zh` cases that credit it. It entered the batch as the weakest source in the whole
corpus (**0.500 on n=3**, carried entirely by borrowed credits); its own suite
fixed that, which is exactly what the board asked it to do.

ⓘ **`ru-ca` got no suite, by decision.** 5 documents; the 4-case floor would be
almost one question per document — enumeration, not measurement (§16).

#### Measured, 416 cases (`eval/results-2026-08-06-batch2-keep.md`)

| Metric                   |     270 cases |         416 cases |                    Δ |
| ------------------------ | ------------: | ----------------: | -------------------: |
| recall@10                |         1.000 |         **1.000** |                 held |
| coverage                 |         0.841 |         **0.888** |            **+5.6%** |
| recall@3                 |         0.956 |         **0.966** |                +1.0% |
| MRR                      |         0.857 |         **0.872** |                +1.8% |
| precision@1              |         0.759 |         **0.781** |                +2.9% |
| `llm-translated`         | n=140 · 0.953 | **n=286 · 0.964** |                +1.2% |
| `(untagged)` **CONTROL** | n=130 · 0.720 | **n=130 · 0.722** | **+0.002 — unmoved** |

🟢 **The control is again the number that matters.** 146 new cases and 333 new
credits moved the 130 pre-campaign cases by 0.002. A bad batch shows up here.

🟢 **THE CAMPAIGN'S OWN REGRESSION IS REPAIRED, exactly as §0.6 predicted.** §0.6
argued the `es`/`zh` dip was a **stale-answer-key artefact** — new, legitimately
relevant documents competing for top-10 slots while credited nowhere — and not a
retrieval regression. Both recovered once their own suites landed:

| Bucket | Pre-campaign | Post-ingest dip |                         Now |
| ------ | -----------: | --------------: | --------------------------: |
| `es`   |        0.938 |           0.896 | **0.938** — fully recovered |
| `zh`   |       ~0.845 |           0.733 |   **0.843** — 97% recovered |

#### ✅ THE CLOSING PART A SWEEP — ran, and it is a NO-OP

The one thing bulk made worse (§0.12). `.tmp-diag/phase5-parta-sweep.ts` swept
**all 270 pre-batch cases** at topK 15 with a 0.45 floor and a 600-char slice.

🔑 **It was front-loaded, not run last, because it does not depend on batch 2.**
The corpus has not changed since the bulk index on 2026-07-30; batch 2 only added
answer keys. Realising that moved a "required closing step" off the critical path.

**Result: 10 pre-campaign cases flagged uncredited campaign hits, and every one
was already ruled on in §0.9.** Nothing to write. Phase 5's last mandatory step is
closed.

⚠️ **The original `phase5-parta.ts` silently skipped 77 of 270 cases** — it derived
each case's language from two hard-coded id prefixes (`tlzh-`, `cru-es-`). The
sweep now calls **eval's own `caseLanguage()` helper**, so a skip is _proven_
rather than assumed and the sweep can never disagree with the eval it protects.
Languages with no campaign documents are skipped without a query, which is what
makes 416 cases affordable: `corpus-search-store.ts` applies a strict
`eq(documents.language, …)`, so those are provable no-ops.

#### 🔴 SIX CORRECTIONS BATCH 2 FORCES ON §0.12 — read these before drafting anything

**1. Smell risk RISES as the corpus SHRINKS. I briefed the opposite, and it w…16894 tokens truncated…tudent.com | 57 | 47 + 1 seed | **48** | `.contentpadding` |
| `th` | everythaistudent.com | 52 | 43 + 1 seed | **44** | `.contentpadding` |
| `hr` | vrlovazno.com | 54 | 41 | **41** | `.contentpadding` |
| `am` | habeshastudent.com | 50 | 40 + 1 seed | **41** | `.contentpadding` |
| `it` | ognistudente.com | 50 | 38 | **38** | `.post-content` ⚠️ WordPress |
| `ur` | zindagikaysawalat.com | 42 | 33 | **33** | `.contentpadding` |
| `el` | everystudent.gr | 43 | 32 | **32\*\* | `#content4` ⚠️ `http://` sitemap |

Skip accounting — every one checked, none is a defect:

- **11 of the 12 staged 100% with ZERO skips.** Only `it` differs.
- `it` 1 · `/fede/` returned `fetch-failed` on the **first** run and
  **recovered on re-run** (38/38). A transient network error, the same shape as
  `cs`'s first-run timeout in batch 2. Not a defect and no entry change needed.
- 7 seeds pinned across 5 hosts, each a live article missing from the XML
  sitemap: `sk` 3 (parts II–IV of a four-part series Yoast lists only part I of),
  `ms` 1, `mk` 1 (linked from 16 articles, in neither map), `am` 1, `th` 1.
  `bn`'s seed is an orchestrator decision, not an agent find — see §12.
- Two pages blocked under the scripture policy: `ms` `/a/300siapakah.html`
  (28,213 ch, abridged John, "no added commentary") and `bn` `/a/whowas.html`
  (22,236 ch, complete John — **and the only page on that domain carrying a
  third-party licence**, New Living Translation © Tyndale House Foundation).
- ⚠️ `sk`'s shortest document is **478 chars**, under ADR-0007's 500-char
  detection floor, so it may store `language = null`. Expected; see the
  ingest-stage notes.

**Batch 4 (11) — written, wired and gated 2026-07-30; 10 ACQUIRED, `he` deferred.**
**233 documents**, zero duplicate-content groups. Commit `4fce4ee`.
**Every recon count in the "Sitemap" column below was correct** — no `sk`-style
fossil this round. Ten of eleven; the eleventh is the exception that matters.

| Lang | Domain                  | Sitemap                  | Resolved     | **Staged**     | Container                                |
| ---- | ----------------------- | ------------------------ | ------------ | -------------- | ---------------------------------------- |
| `hi` | everystudent.in         | 40                       | 30 + 4 seeds | **34**         | `.contentpadding` †                      |
| `ta` | ungalthervuenna.com     | 40                       | 31           | **31**         | `html`                                   |
| `my` | everymyanmarstudent.com | 38                       | 31           | **31**         | `.contentpadding` †                      |
| `te` | everytelugustudent.com  | 39                       | 29 + 1 seed  | **30**         | `html`                                   |
| `sl` | vsakstudent.com         | 30                       | 22 + 1 seed  | **23**         | **`#contentpadding`** † ⚠️ an ID         |
| `ne` | nepalistudent.net       | 28                       | 18 + 2 seeds | **20**         | `.contentpadding` †                      |
| `om` | everybarataa.com        | 29                       | 18           | **18**         | `.contentpadding` † ⚠️ undetectable      |
| `kk` | shakirtter.com          | 25                       | 17           | **17**         | `html`                                   |
| `ka` | kovelistudenti.com      | 25                       | 16           | **16**         | `.contentpadding` † ⚠️ #111 was wrong    |
| `sw` | lipotumaini.com         | 21                       | 13           | **13**         | `.contentpadding` †                      |
| `he` | igod.co.il              | **1,182** (recon said 5) | —            | **— deferred** | `.elementor-widget-theme-post-content` † |

Skip accounting — there is almost none, which is itself the finding:

- **ALL TEN staged 100% with ZERO skips.** No transient `fetch-failed`, no
  `too-thin`, no dead redirect. The first batch in the campaign with nothing to
  account for. Batch 2 had `cs` and `sq`; batch 3 had `it`.
- 8 seeds pinned across 4 hosts, each a live article missing from the XML
  sitemap: `hi` 4 (its own `/m/map.html` is a **superset** of the XML — the
  reverse of the usual staleness), `ne` 2 (one from the HTML map, one in
  neither map), `te` 1, `sl` 1 (linked from 11 articles, in neither map).
- **No page was blocked as scripture in 7 of the 11.** Four were: `te`
  `/a/whowas.html` (23,429 ch, abridged John, © Tyndale House Foundation —
  byte-for-byte the page `bn` blocks at the same slug), `sl` `/janez.html`
  (© Društvo Svetopisemska družba Slovenije), `om` `/a/whowas.html` (credited
  to the Oromo Bible), `hi` `/bible.html`. In every case the agent kept the
  host's `/a/bible.html`-style apologetics essay and said how it told them
  apart — voice, verse numbering and the presence of a secondary-source
  bibliography, never length.
- **Three hosts have real `robots.txt` rules and each was honoured by hand**
  (`my` 2 paths, `kk` 1, `ka` 1 — the last written malformed, `Disallow:
a/fol.html` with no leading slash). All four pages return 200, match
  `articleHints`, and clear the floor, so nothing else would have excluded
  them. That is the third, fourth and fifth time this campaign has hand-patched
  a gap that §13 #7 describes: **the acquire path never reads robots.txt.**

⚠️ ~~**`ka` has no shared-template selectors** per #111~~ — **DISPROVED
2026-07-30, see rule 2.** It is the ordinary static template; `content4` is an
**ID** there. The estate stays at nine generators.
⚠️ ~~**`he` yields only ~5 articles**~~ — **WRONG by 200×, see §4.** It has
**1,020**, and it is not a Cru property.

**~~`sk` needs care~~ — RESOLVED 2026-07-29, and the warning was wrong.**
`everystudent.sk` is **not** the Czech Yii app; it is WordPress + Elementor, and
`.content` matches 0 of its pages. Measured 8-gram overlap between the `.cz` and
`.sk` estates is **0.00%** across all 94 Slovak bodies — Czech and Slovak
translations of one English original share no 8-grams. The single exception is
`.cz` `/in/163/koronavirus_jak_prekonat_strach` ↔ `.sk` `/uzkost-a-strach/` at
**60.1%**, which confirms that page was lifted _from_ everystudent.sk. `cs`
neither discovers nor seeds it, so **there is no live duplicate risk** and
leaving it out of `cs` remains correct.

**~~`hr` and `mk` are Serbian's neighbours~~ — RESOLVED 2026-07-29, both are
genuinely distinct.** `hr` is Croatian Ijekavian in Latin script (tko 126 / ko 0
under word boundaries — the exact mirror of `sr`'s ko 201 / tko 0), with 8 Cyrillic
codepoints on the entire site and **no parallel script tree**. Shingle overlap with
`sr` on same-topic articles is **0.4–0.9%** — independent translations. `mk` is
Macedonian Cyrillic (99.05%), proven on the alphabet: ќ ×1,433, њ ×745, ѓ ×422,
љ ×273, ѕ ×17, against **zero** Serbian-only ђ/ћ and **zero** Bulgarian-only
ъ/щ/ю/я. Also no parallel tree. **No duplicate-content decision needed for either.**

⚠️ **Word-boundary counting matters here.** `hr`'s agent noted that naive
substring counts give the _opposite_ answer — `vreme` scores 75 inside Croatian
"suvremen"/"istovremeno", and `ko` scores 1,354 inside "kako"/"tko". Both drop to
0 under `(?<!\p{L})…(?!\p{L})`. Anyone re-running a Slavic language check must
use word boundaries.

**No reachable sitemap (5) — recon DONE 2026-07-29, see §15.** Route decided:
**hand-listed seeds from each site's own HTML map, NOT Firecrawl** — 4 of the 5
are bare Apache serving 200, so there is no wall to pay for. ~234 documents.

`ru-ca` studentstan.com (87) · `lv` katramstudentam.lv (49) ·
`uk` svitstudentiv.com (47) · `hy` 1patasxan.com (37) ·
`ti` everytemhari.com (14).

⛔ **`lv` is blocked on RIGHTS, not on crawlability** — its `robots.txt`
disallows `ClaudeBot` by name and declares `Content-Signal: ai-train=no`. §15
has the full text and the recommendation (ask Cru, don't out-engineer it).

**Known outliers already flagged by #111:** `cs` (everystudent.cz) uses
`.content .content-13` / `.main`, not the shared template — **done, batch 2**;
the stable half is `.content` (`content-13` is the article id). `ka`
(kovelistudenti.com) has no shared-template selectors either — **still
unwritten**, and the only remaining host #111 flagged. Expect a tenth generator.

---

## 9. Rules learned — do not re-learn these

Each cost real investigation. Cite them when they apply.

1. **Verify selectors by extracted TEXT LENGTH, using the repo's own parser —
   never by grepping for the class name.** Every one of these hosts also declares
   `.content4` in an inline `<style>` block, so a text grep false-positives.
   Worse: on `everykoreanstudent.com`, `.content4` **matches 2 elements and
   extracts 0 characters**, and `<body>` is absent from the parsed tree entirely
   (152 direct children of `<html>`). Shipping the sibling selector list there
   would have acquired **zero documents with no error anywhere** — a silent
   failure that looks correctly configured. Check like this:
   ```js
   import { parse } from "node-html-parser"
   const el = parse(html).querySelector(sel)
   console.log(sel, el ? el.structuredText.trim().length : -1)
   ```

1b. **⚠️ THE ONE THAT BIT US — `contentSelectors` is NOT a fallback chain.**
`extractContent` (`src/acquisition/extract.ts`) scopes to the **first selector
that matches an ELEMENT**, not the first that yields text:

```ts
for (const selector of policy.contentSelectors) {
  scope = root.querySelector(selector)
  if (scope) break // ← binds even when it extracts 0 chars
}
```

So **a zero-text match SHADOWS every working selector after it.** Listing the
shared template as a "fallback chain, outermost first" is not defensive — it
is the failure mode.

On **five of the eight pilot hosts** (`es`, `ru`, `ro`, `pt`, `de`)
`.content4` exists only as `<div class="content4"> </div>` — an empty layout
spacer, 0 chars, 0 child elements — and `.content4b` **does not exist at all**.
The real container is **`.contentpadding`** (3.6k–20.5k chars). Because
`.content4` was listed first, all five extracted **0 chars on every page** and
every article was skipped as `too-thin` on an **HTTP 200**. Fixed 2026-07-28 by
setting `contentSelectors: [".contentpadding"]` — one measured selector, no
chain. Only `ja` genuinely has `.content4` as its container.

Two things made this survive Phase 1:

- **The registry unit tests cannot catch it.** They assert the entry object's
  own fields (`expect(contentSelectors[0]).toBe(".content4")`) — a tautology
  that passes whatever you write. All five even shipped a confident nesting
  diagram (`.content4 > .content4b > .contentpadding`) that does not exist.
- **`--dry-run` acquire cannot catch it either.** It resolves URLs against the
  sitemap and **fetches nothing**, so "resolves 630 URLs" says nothing about
  extraction. The §6 Phase-1 gate is insufficient on its own.

**New mandatory Phase-1 gate — run BEFORE committing a batch:** fetch 2 real
article URLs per new key and run the repo's own `extractContent` with the
registry policy; assert `text.length >= minContentLength`. Anything else is
guessing. See "Open questions" #4 — this should become a checked-in script.

1c. **"`minContentLength` will drop it" is NOT a blocking strategy — there is a
`<body>` fallback.** When **no** `contentSelector` matches, `extractContent`
does not return empty. It falls through (`extract.ts:50`):

```ts
const container = scope ?? root.querySelector("body") ?? root
```

so the page still extracts — usually the entire nav/teaser chrome, which on
these hosts runs 800+ chars and clears the 250 floor comfortably.

`everystudent-ro` shipped 25 dead `/a/` URLs unblocked on exactly the wrong
reasoning: "the homepage carries none of the selectors, so extraction yields
0 characters and the floor drops them." The real acquire run staged **89 docs,
25 of them byte-identical copies of the 842-char homepage teaser list.** They
do not collapse at ingest either — the dedup gate keys on
`(sourceKey, canonicalUrl)`, so 25 URLs mean 25 chunked, embedded documents.
Blocked by URL and the 25 rows deleted; `ro` now stands at the 64 predicted.

**Rule: a page you do not want must be blocked by URL.** The floor only
catches pages that are genuinely short _after_ extraction, and a selector
miss makes a page LONGER, not shorter. Verify with
`select md5(raw_content), count(*) … group by 1 having count(*) > 1` after
every acquire — one hash with a high count is this bug.

⚠️ **CORRECTED 2026-07-29 — it is not "two hosts", it is MOST of them.**
`<body>` is absent from the parsed tree on `ja`, `ko`, `sq`, `mn`, `vi`, and
on individual pages of `hu`, `fa` and `sr`. So `?? root` — the _document_
fallback — is the normal path on this estate, not the exception. What it
returns is the WHOLE document including a literal `<!DOCTYPE html>` text
node, not the tidy nav blob this rule originally described. Two agents
(`sq`, `vi`) hit that artifact independently.

1d. **⚠️ CORRECTED 2026-07-29 — `.contentpadding` is NOT a safe default either.**
Rule 1b reads as "`.content4` is the trap, `.contentpadding` is the fix". That
is wrong. On `pyetjetejetes.com` (`sq`) **`.contentpadding` matches 52 of 78
pages and extracts 0 chars on every one**, while `.content4` matches 78/78
at 0 chars and `<body>` is absent entirely — the only container is `html`.
There is **no selector that is safe by default anywhere on this estate.**
Measure every candidate on every host, every time.
1e. **✅ THE FIX for rules 1b–1d, found in batch 3 — append `"html"` LAST.**
Rules 1b–1d all describe the same wound: `extract.ts` binds the first
selector that matches an ELEMENT, and when nothing matches it falls to
`?? root`, which returns the whole document **including a literal
`<!DOCTYPE html>` text node**. Batch 3 found the cheap, safe remedy:

```ts
contentSelectors: [".contentpadding", "html"],   // "html" is ALWAYS last
stripSelectors:   ["head", …],                   // drops the duplicate <title>
```

Why this is safe, and why it does **not** contradict rule 1b:

- Rule 1b warns against an **unmeasured selector placed FIRST**. A trailing
  entry is the opposite — nothing follows it, so it can shadow nothing.
- It is only ever consulted when the primary misses. **Proven:** all 24
  batch-3 gate probes returned values _byte-identical_ before and after the
  change. The fallback is completely inert on healthy pages.
- `<html>` is a real element, so it carries **no doctype text node** — it
  strictly dominates `?? root`.
- `head` is not inside the primary container, so it strips 0 chars on
  healthy pages and only fires on the fallback path. Safe because
  `extract.ts` reads the title from `root` at **line 43**, BEFORE the strip
  loop at **line 52**.

**Precondition — check it per host:** the primary must have **zero
matched-but-empty pages**. If the primary can match at 0 chars (rule 1d,
`sq`), the fallback never fires and the page is lost anyway; that host needs
`["html"]` outright, as `lt` ships.

⚠️ **This changes what "block the broken page" is worth.** Three batch-3
agents blocked genuine articles solely because of the doctype artefact —
`th` `/a/300whatislife.html` (10,449 ch), `lt` `/m/istorija.html`
(20,148 ch), `bn` `/a/followup.html` (3,255 ch). All three now extract
clean. **Do not block a page for a doctype leak; add the fallback instead.**
`bn` had even blocked one page while keeping another with the identical
defect.

1f. **⚠️ NEW (batch 4) — `.articletitle` is a shadow trap too, and it is the
worst kind: it extracts a plausible non-zero number.** Rules 1b–1d are about
selectors that match at 0 chars. `.articletitle` matches an `<h1>` and
extracts **5–79 characters** — enough to look like a working measurement in a
log, far too little to be an article, and _above_ nothing since the 250-char
floor still catches it. The danger is its POSITION: it sits third in the
sibling list, so on any host where `.content4` and `.content4b` both miss it
binds and stops. On `ka` that would have staged 16 documents of ~20
characters each.

Measured on the hosts that carry it: `ka` 5–62, `te` 4–78, `ta` 4–61,
`ne` 18–47, `kk` 13–66. **Never list it.** If you see it in a candidate set,
it is a title, not a container.

2. **There is no single shared template.** Measured across all 43 registered
   siblings (updated 2026-07-30 after batch 4):
   - **`.contentpadding` (25)** — `es` `ru` `ro` `pt` `de` `pl` `hu` `tr` `vi`
     `fa` `sr` `id` `ms` `mk` `bn` `th` `hr` `am` + batch 4's `hi` `my` `ne`
     `om` `ka` `sw`. `.content4` is an empty 0-char spacer on essentially all
     of them.
   - **`#contentpadding` (1)** — `sl` (vsakstudent.com), where
     **`contentpadding` is an ID, not a class.** `.contentpadding` matches
     **nothing** there. The second host in the estate to hide its container
     behind the class-vs-ID distinction, after `el`. A different stylesheet
     generation (`lessframework2022.css` vs `ka`'s `lessframework2013.css`),
     so treat the year-variants of this hand-built template as separate.
   - **`html` (6)** — `ko` `sq` `mn` `lt` + batch 4's `ta` `te` `kk`. On `ko`
     `sq` `mn` a malformed `sitelevel_noindex` pops the element stack and takes
     `<body>` with it (rule 4); the same mechanism is what forces `ta` `te` `kk`
     — on `ta` a stray `</sitelevel_noindex>` fires right after the share row on
     **all 31 pages**, and on `kk` each page also carries one extra `</div>`.
     On `lt` it is two individual articles instead — one closing an `<h2>` with
     `</h1>`, one with an unclosed `<span>`.
   - **`.elementor-widget-theme-post-content` (1)** — `he` (igod.co.il),
     WordPress + **Elementor with the `hello-elementor` theme** — a fourth
     WordPress container, and unlike `sk` (also Elementor) it does **not** use
     `.entry-content`. On `he`, `.entry-content` is the trap: it matches 44 of
     51 pages and extracts a **constant 286 chars** — a related-post teaser,
     byte-identical across unrelated articles. Not zero, and therefore not
     caught by the floor either. **Deferred, not acquired — see §4.**
   - **`.content4` (1)** — `ja` only, and even there the spacer shape appears on
     some pages (see the entry's mixed-host note).
   - **`#content4` (1)** — `el`, where **`content4` is an ID, not a class**.
     `.content4` matches nothing there. One character between working and a
     silent zero — and the sibling selector list would have produced exactly the
     0-char failure of rule 1b.
   - **`.cb-entry-content` (1)** — `zh-cn`, WordPress (Chosen theme).
   - **`.entry-content` (2)** — `zh-tw`, WordPress (Enfold/Avia), and `sk`,
     WordPress + **Elementor**. Same selector, two unrelated themes.
   - **`.post-content` (1)** — `it`, WordPress (`sight2016`). **A third
     WordPress theme with a third container** — one WP host never predicts
     another. All seven catalogued containers are absent from `it` entirely.
   - **`.contentleftpadding` (1)** — `et`, an older hand-rolled layout. None of
     the `.content4`-family selectors exist on it **at all**, not even as
     spacers. Inheriting the sibling list here would have missed on all four and
     silently ingested 46 articles with nav+sidebar+footer attached.
   - **`.article-content` (1)** — `bg`, an Angular build with Pagefind search.
   - **`.content` (1)** — `cs`, a bespoke Yii PHP app. #111's
     "`.content .content-13`" hint was one element's class attribute;
     `content-13` is the article id, so the stable half is `.content`.
     ⚠️ **`sk` is NOT this app despite the sibling domain** — it is WordPress,
     and `.content` matches 0 of its pages. See rule 12.

   That is **ten distinct generators** — nine across the 47 EveryStudent-family
   hosts, plus `he`'s Elementor build, which is not one of them. The "shared
   EveryStudent template" is a minority case; #111's "one crawl policy + a
   handful of bespoke" is optimistic by a wide margin. Assume per-host
   verification every time, and never copy a sibling's selector list.

   ⚠️ **#111's outlier flags are not reliable, in BOTH directions.** It flagged
   `ka` as having no shared-template selectors — **false**, it is the ordinary
   template with `content4` as an ID, and a probe scanning for the class saw
   nothing. It recorded `he` at ~5 articles — **false by 200×**, it has 1,020.
   Both errors came from a probe that did not look hard enough, not from the
   hosts being strange. Re-measure anything #111 asserts.

   ⚠️ **Probe BOTH `.x` and `#x` for every candidate.** Two hosts out of 43
   (`el` `#content4`, `sl` `#contentpadding`) put the container in an ID. That
   is ~5% of the estate, and the failure is silent in both directions: a class
   probe on an ID host finds nothing, which reads identically to "this selector
   isn't used here".

   ⚠️ **The estate may be mid-migration.** `bg`'s sitemap carries hreflang
   alternates naming **49 other EveryStudent hosts**, and `bg` alone is on a new
   Angular platform. If it is the pilot of a platform-wide rebuild, container
   selectors recorded here have a shelf life — re-verify rather than trusting
   this table on a host you have not measured yourself.

3. **Sitemaps here are stale and cannot be trusted as the source of truth.**
   - `suaescolha.com`: sitemap listed 62 articles, the site's own `/mapa.html`
     lists **75**. Pure discovery would have silently dropped **17%** of the
     source. Fix: pin the missing ones in `seedPaths` — `acquire.ts` unions seeds
     with discovered URLs.
   - `everystudent.ro`: **25 of 85** article URLs 301 to the homepage. They are
     now **hard-blocked by URL** — see rule 1c, which reversed an earlier and
     wrong "the floor will drop them" decision. **Expect ~64 docs, not 102. A
     shortfall is not a failure.**
   - **Always cross-check the sitemap against the site's own HTML sitemap page**
     (`/mapa.html`, `/sitemap.html`, `/plan.html`, `/m/sitemap.html`).
4. **`sitelevel_noindex` is a custom ELEMENT, not a class** (hence no leading dot
   in the entries — that is correct, not a typo).

   ⚠️ **CORRECTED 2026-07-29 — it is NOT malformed on every host.** This rule
   previously claimed the malformation was universal. Six batch-2 hosts measured
   the opposite: on `pl`, `hu`, `tr`, `vi`, `fa` and `et` the tag is
   **well-formed and already contains the share widget**, making
   `.shareiconsmenupg` a **0-char no-op**. Those entries keep the selector as a
   cheap drift guard and say so honestly rather than claiming it strips.
   **#128 is host-specific, not estate-wide** — cite it only where measured.

   Where it IS malformed the damage is worse than "doesn't contain the widget":
   on `mn` the tag opens at line 176 and closes at 202, _inside_
   `.contentpadding` and before the article starts at 212, which pops the
   element stack and destroys `#content4`, `.contentpadding` **and** `<body>`.
   That is the mechanism behind every `["html"]` host (`ko`, `sq`, `mn`).

   Where it is malformed, strip **`.shareiconsmenupg`** explicitly.
   Measured inside `.contentpadding` on 2026-07-28: it removes 83 ch (`ru`),
   102 (`ro`), 109 (`de`), 148 (`es`), 154 (`pt`) — real chrome, so keep it. It
   does **not** exist at all on `studentinjapan.com` (`ja`), where the site's
   marker is an HTML comment no selector can target.

5. **`.relatedbottom` is dead config** — declared in CSS, never an element, on
   every host measured. Kept for parity; label it a no-op, don't claim it strips.
6. **Signup landing pages clear `minContentLength` and must be blocked by URL.**
   The `/john`·`/jean`·`/juan`·`/joao`·`/ioan` Gospel-of-John email study and the
   `/aventure`·`/aventura`·`/abenteuerreise`·`/pack` series are 1,000–2,500 chars
   of form copy. **Length is not aboutness** (slice #10 paid to learn this).
   Every sibling has localized twins — block them before the first fetch.
7. **`/audio/*` and `/v/*` need a measured decision, not a rule.** On
   `cadaestudiante.com` and `duentscheidest.com` the audio pages are the same
   article reflowed (73–86% 12-word shingle overlap) → blocked. On
   `everystudent.ro` the `/v/` pages carry unique transcripts → kept. Measure
   shingle overlap; don't assume.
8. **Watch for near-twin slugs, but measure before dropping.** `ceu`/`ceu2`,
   `gdebog`/`gdyebog`, `nebesnom`/`nebesnom2` all looked like duplicates and were
   all **distinct** (0–12% overlap). Some are literal continuations.
9. **Probe with a full browser UA.** Bare `Mozilla/5.0` → 406 from these hosts.
10. **Give every fan-out agent its own scratch subdirectory** (see §5).
11. **Mixed-case slugs exist** (`/a/pomoshch-ot-Boga.html`,
    `/articulos/Dios.html`). A lowercase-only `articleHints` regex silently drops
    them.
12. **⚠️ NEW (batch 3) — the recon table in §8 can be reading a DEAD sitemap.**
    `everystudent.sk` was listed at "44 URLs". That number came from
    `/sitemap.xml`, which is a **2014 fossil** (`generated-on="July 21, 2014"`).
    The live sitemap is Yoast's **`/sitemap_index.xml` with 103 URLs**, and the
    real yield is **83 documents, not 44**. Of the fossil's 27 unique slugs, 23
    now 301 onto URLs already in the live set and 4 are 404 — listing it would
    stage duplicates at old permalinks.

    **So: always check for `/sitemap_index.xml` and read the sitemap's own
    generation date before trusting §8's count.** §8's numbers are recon from
    2026-07-24 and are a starting hypothesis, not a measurement.

    The same host also disproved its own §8 warning: `sk` is **not** the Czech
    Yii app. It is WordPress + Elementor, and 8-gram overlap against all 94
    Slovak bodies is **0.00%** — Czech and Slovak translations of one English
    original share no 8-grams. The single exception
    (`/in/163/koronavirus_jak_prekonat_strach`, 60.1%) is the page `cs` already
    excludes, which confirms it was lifted _from_ everystudent.sk.

13. **⚠️ NEW (batch 3) — sitemaps may publish `http://`, and discovery does not
    normalise the scheme.** `everystudent.gr`'s `<loc>`s are all
    `http://www.everystudent.gr/…`. `discover.ts:95-98` filters the **raw
    `<loc>` string**, so the `^https://` pin every sibling uses would have
    discovered **ZERO URLs**. Use `^https?://` unless you have checked.

    The `--dry-run` gate catches this (0 resolved is a hard failure), so it
    cannot ship silently — but you will waste a cycle. Check the sitemap's
    scheme when you write the `allow` regex.

    **Downstream consequence, recorded not solved:** `acquire.ts:47` stores
    `canonicalUrl: normalizeUrl(url)` from the URL **as discovered**, not the
    final URL after redirect, and `normalizeUrl` lowercases the protocol but
    never rewrites `http`→`https`. So `el`'s documents are stored under `http://`
    URLs. Deterministic today; but the dedup key is `(sourceKey, canonicalUrl)`,
    so **if that host ever republishes its sitemap as `https://`, a re-acquire
    creates 32 duplicate documents rather than updating.** See §13 #9.

14. **⚠️ NEW (batch 3) — `*/` inside a docstring code span TERMINATES the
    comment.** `everystudent-it.ts` documented its blocked category indexes as
    `` `/category/*/` `` inside the JSDoc header. The `*/` closed the comment
    block 80 lines early and turned the rest of the file into code — 20
    typecheck errors, none of which named the real cause. Write
    `` `/category/<slug>/` `` instead. Cheap to hit, cheap to fix, confusing to
    diagnose: the first error points at a line that is fine.
15. **Cloudflare's PRESENCE is not a wall — classify on the block-page
    signature.** Batch 3 met it three ways and none needed Firecrawl:
    `mahasiswakeren.com` is Cloudflare-fronted and passed all 67 pages;
    `vrlovazno.com` serves a **Turnstile CAPTCHA** on two mail-form pages and
    still returned HTTP 200 with full HTML to plain `curl`;
    `katramstudentam.lv` (§15) is Cloudflare **and** disallows us by name, which
    is a rights problem, not a technical one. Reinforces the #114 correction —
    test the response, not the CDN header.

16. **⚠️ NEW (batch 4) — `discover.ts` cannot read a sitemap that uses CDATA.
    This is a REPO DEFECT, not an entry problem.** `igod.co.il` wraps every
    `<loc>` in `<![CDATA[…]]>` (All in One SEO emits this; Yoast and
    xml-sitemaps.com do not, which is why 42 hosts never hit it).
    `discover.ts` reads `loc.text` raw at **lines 87 and 95**, and
    node-html-parser returns the CDATA wrapper as literal text. Both branches
    break, differently:

    | Branch                            | Line | What happens                                                                                              |
    | --------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
    | `<sitemapindex>` → child sitemaps | 87   | the wrapper string is queued and passed to `fetch` → **`TypeError: Invalid URL`, the whole acquire dies** |
    | `<urlset>` → page candidates      | 95   | the string fails every `^https://…` `allow` regex → **silently discovers 0 URLs**                         |

    The fix is to unwrap before use:

    ```ts
    const raw = loc.text.trim()
    const m = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw)
    const u = (m ? m[1] : raw).trim()
    ```

    **Deliberately NOT done on this branch** (same call as `extract.ts` and
    `normalizeUrl` — see §12 and §13 #5/#9). Note this one is _provably_ inert
    for every existing source: a `<loc>` starting `<![CDATA[` is never a valid
    URL, so today it can only crash or be dropped. Filed as §13 #10.

17. **⚠️ NEW (batch 4) — the batch-3 word-boundary guard is WRONG for Indic
    scripts, and it fails in the direction that FABRICATES evidence.** Batch 3
    established `(?<!\p{L})…(?!\p{L})` for separating Croatian from Serbian.
    In Devanagari, vowel signs (ा ो ं ्) are `\p{M}`, not `\p{L}` — so that
    guard happily matches Nepali `छ` inside Hindi `छोटा` and `है` inside `हैं`.

    The `hi` agent's first pass reported **594 false `छ` hits** and inflated
    `है` by 1,193; it looked like genuine Nepali signal on a Hindi site. Caught
    only because the agent re-derived it. **Correct guard:**

    ```js
    (?<![\p{L}\p{M}\p{N}])…(?![\p{L}\p{M}\p{N}])
    ```

    With it, the two hosts separate cleanly and independently: `hi` is Hindi
    (है 2,788 / छ 2, and both `छ` are `छ:`, the numeral "six"), `ne` is Nepali
    (छ 325 / है 0). Applies to any abugida — Devanagari, Tamil, Telugu,
    Bengali, Myanmar, Ge'ez. The Latin/Cyrillic form of the rule is unaffected.

18. **⚠️ NEW (batch 4) — Burmese has an encoding hazard a charset check cannot
    see: Zawgyi vs Unicode.** Both use the same Myanmar block (U+1000–U+109F)
    with different meanings, so a Zawgyi page is not mojibake — it is valid
    UTF-8 that renders as garbage. `everymyanmarstudent.com` is **Unicode**,
    proven three ways: the string "zawgyi" appears 0 times across all 38 pages;
    U+103A (asat) 38,109 vs U+1039 (virama) 1,101, a ~35:1 split that Zawgyi
    inverts; and Zawgyi's repurposed codepoints U+1033/U+1034/U+1064 are all 0.
    If a future Myanmar-script host inverts that ratio, the stored text is not
    retrievable and no charset header will tell you.

19. **⚠️ NEW (batch 5) — Apache directory autoindex is open on some hosts, and
    it is GROUND TRUTH.** `1patasxan.com` and `everytemhari.com` both return a
    real `Index of /a` listing at `/a/`. That beats every other net, because it
    reads the filesystem rather than the site's own links — it shows files that
    **no map lists and no page links to**.

    It let the `ti` agent _prove_ its article count is exactly 14 rather than
    merely consistent with 14, by cross-checking the directory against the HTML
    map and the site's own search index. It also exposed two editor leftovers
    invisible to every other method: `/a/fol copy.html` (2,636 chars, with a
    literal space in the filename) and `/a/peace copy.html` (**96.0% overlap**
    with `/a/peace.html`). Both correctly excluded — but a discovery policy
    that crawled the directory would have staged them.

    **Try `curl <base>/a/` on any host before trusting a map.** It costs one
    request. Where it works it is definitive; where it 404s you have lost
    nothing.

20. **⚠️ NEW (batch 5) — the scripture policy was never applied to
    `everystudent-ar`, and that source is LIVE IN PROD.** Its seeded
    `/a/whowas.html` is **23,624 chars of the Gospel of John**. The page's own
    opening says the passages are «مقتطفات مأخوذة مباشرة من إنجيل يوحنا …
    **دون إضافة لأي تعليق**» ("excerpts taken directly from the Gospel of John
    … without adding any commentary"), then runs `يوحنا 3` ("John 3") as a
    chapter heading over continuous verse text — 17 chapter references in all.

    It is **the same page this campaign blocked on six other hosts**: `bn`
    (22,236 ch), `te` (23,429), `ms`, `om`, `sq`, `uk`. And `everystudent-ar`
    is the entry that **set the precedent** — its docstring excludes four
    `/bible/**.pdf` files with the exact wording the 2026-07-29 estate-wide
    policy later quoted. It simply never applied that reasoning to its own
    `/a/whowas.html`. Its `/john.html` seed (1,473 ch) is the signup page every
    other sibling also excludes.

    **Checked, and the finding is exactly one document.** The other two prod
    sources are clean: `-fr`'s `/a/215bible.html` ("Pourquoi Vous Pouvez Croire
    la Bible", 31,558 ch) and `everystudent`'s `/features/bible.html` ("Can You
    Trust the Bible?", 22,711 ch) are both apologetics _about_ the Bible and
    correctly kept.

    **NOT for this branch** — it touches a prod source, same reasoning as #128.
    Belongs with #123/#128 as prod-corpus work. §13 #13.

### Ingest-stage notes (Phase 3 — not acquisition concerns)

✅ **The 500-char/CJK worry below did NOT materialise on the first source
indexed.** `everystudent-am` came out **41/41 `am`, zero `null`** — see §6
Phase 3. That is one source and a non-CJK one; the CJK note still stands
untested until `zh-cn` / `zh-tw` / `ja` / `ko` land.

Recorded here so they are not lost, but **do not act on them during Phase 1–2**:

- The **500-char detection floor** (ADR-0007) interacts badly with CJK: a full
  Chinese article can be ~1,200 chars, and short-but-legitimate pages
  (`/a/followup` 298 ch, `/john/john37` 310 ch) will store `language = null` and
  drop out of `language:"zh"` filtered retrieval. Observe and report at Phase 3.
- **`zh` is a colliding label.** `thelife-zh` (Simplified), `everystudent-zh-cn`
  (Simplified) and a future `everystudent-zh-tw` (Traditional) all declare `zh`.
  Language-filtered retrieval cannot separate them. Same for `ru` /
  `ru-ca` (studentstan.com). Recorded as an observation; **not solved here.**
- **The standing null-language policy is unchanged and settled** — nulls are
  expected, excluded from eval, surfaced on the dashboard. Do not re-open it, do
  not propose a sweep. `pnpm lang:sweep` is a prod corrective tool and is never a
  campaign step.
- `studentinjapan.com` and `everykoreanstudent.com` serve **UTF-8** but send a
  bare `content-type: text/html` with **no charset parameter**. A client
  defaulting to ISO-8859-1 would mojibake every page. (Observed clean in the
  2026-07-28 acquire — Node's `fetch` handled both correctly.)
- **Measured after batch-1 acquire (2026-07-28), to watch at Phase 3:**
  - `everystudent-zh-cn` min body is **322 chars** and its mean is **2,882** —
    by far the shortest of the eight. The 500-char detection floor (ADR-0007)
    will label some of these `language = null`, exactly the CJK interaction
    already flagged above. Expect it; do not "fix" it.
  - `everystudent-es` has one **100,409-char** document,
    `/articulos/biblia_juan.html` ("El Evangelio de Juan") — the full text of
    John's Gospel on an article URL. Correctly extracted, not chrome, but it is
    4× the next largest and will chunk heavily. Decide at Phase 3 whether a full
    scripture book belongs in this corpus or should be blocked.
  - `everystudent-ja` min body is **841 chars**, the next-shortest after
    `zh-cn`.

---

## 10. The agent prompt that worked (reuse verbatim, swap the facts)

🔴 **This is the batch-3 version, rewritten 2026-07-29. Use THIS, not your
memory of the earlier one.** It differs from the batch-1/2 prompt in five ways
that each cost real investigation, and the old text actively contradicts the
current rules:

| Was                                                 | Now                                                         | Why                                                            |
| --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| "ship ONE selector, never a fallback"               | append `"html"` LAST when the primary has no 0-char matches | rule 1e — three real articles were nearly lost to this         |
| "`.contentpadding` is the real container"           | there is **no** safe default                                | rule 1d — `.contentpadding` was the 0-char shadow on `sq`      |
| "`.shareiconsmenupg` REQUIRED, markup is malformed" | measure it; it is a 0-char no-op on most hosts              | rule 4 correction                                              |
| "falls back to `<body>`"                            | usually falls back to the **whole document**                | rule 1c correction — `<body>` is absent on most of this estate |
| (no scripture guidance)                             | block full Bible books                                      | §12 decision, 2026-07-29                                       |

Substitute the **bold** placeholders per domain. Append any per-host warning
from §0/§8 (script neighbours, template outliers, tiny yields) as a SPECIAL
CARE block at the top — batch 3 did that for `sk`, `hr`, `mk` and `ms` and all
four warnings paid off, two by being disproved.

```
Write ONE new source registry entry for the jesusfilm-rag repo at
<REPO>. The branch `feat/everystudent-siblings` is already checked out — do not
switch or create branches, do not commit.

TARGET: EveryStudent sibling domain — **<LANGUAGE> (`<code>`)**, host
**<domain>**, ~<N> sitemap URLs (per prior recon; verify).

## Deliverable — exactly two new files, nothing else
1. `src/registry/everystudent-<code>.ts` exporting
   `export const everystudent<Camel>: SourceEntry`
2. `src/registry/everystudent-<code>.test.ts` — vitest

## HARD CONSTRAINTS
- Do NOT edit `src/registry/index.ts`. The orchestrator owns that barrel. Your
  entry will not be importable during your run and your test would fail if
  executed — that is expected and correct. Do not try to fix it.
- Do NOT run pnpm, npm, npx, tsx, vitest, psql, docker, git commit/checkout/branch.
  No builds, no test runs, no database. Do not self-verify with `pnpm typecheck`.
- Probe with `curl` only (`-m 20`), using a FULL browser UA string — a bare
  `Mozilla/5.0` gets 406 from these hosts.
- Your scratch directory is <SCRATCH>/<code>/ — use ONLY that path. Sibling
  agents run concurrently and generic filenames WILL collide.

## Read first
`src/registry/types.ts`, `src/registry/everystudent-fr.ts` (field shape +
docstring standard), `src/registry/everystudent-pl.ts` and
`src/registry/everystudent-sq.ts` (a clean `.contentpadding` host and an
`html`-container host), `src/registry/thelife-fr.ts` (discovery-mode
precedent), `src/registry/everystudent-fr.test.ts` (test pattern),
`src/acquisition/extract.ts` (how selectors are actually applied).

## Recon you must actually perform — measure, never assume
1. robots.txt — fetch it. Record Disallow rules and whether they touch articles.
   NOTE: the acquire path does NOT enforce robots.txt, so anything robots
   disallows must be blocked by URL BY HAND in your entry. If robots says
   `Disallow: /` for `*`, STOP, write nothing, and report it — that is a
   correct outcome, not a failure.
2. Sitemap — fetch `/sitemap.xml` (try with and without `www.`). Count URLs.

   ⚠️ **ALSO try `/sitemap_index.xml`, and read the sitemap's own generation
   date.** `everystudent.sk` was catalogued at "44 URLs" from a `/sitemap.xml`
   that turned out to be a **2014 fossil**; the live Yoast index had 103, and
   the real yield was 83 documents. The URL count in your brief is RECON, not a
   measurement — verify it and report any delta.

   ⚠️ **Check the SCHEME of the `<loc>`s.** `everystudent.gr` publishes
   `http://` URLs, and `discover.ts` filters the RAW `<loc>` string without
   normalising, so an `^https://` pin would discover ZERO. Use `^https?://` if
   the sitemap is http, and say which you used.

   THEN cross-check against the site's own HTML sitemap page (/mapa.html,
   /sitemap.html, /plan.html, /m/sitemap.html, /peta.html …). These sitemaps
   are STALE: one sibling's was missing 17% of its articles, another lists 25
   dead URLs, one omits a whole section. If the HTML map has articles the XML
   sitemap lacks, pin them in `seedPaths` — acquire.ts unions seeds with
   discovered URLs. Also harvest every internal href across the pages you
   fetch; batch 3 found live articles that were in NEITHER map that way.
3. At least 3 real article pages, and check candidates on MORE THAN ONE page.
   Determine which selector wraps the body — and verify by EXTRACTED TEXT
   LENGTH using node-html-parser exactly as extract.ts does, NOT by grepping
   for the class name. Every FreeFind host declares .content4 in an inline
   <style> block, so a grep false-positives every time.

   ⚠️ READ THIS TWICE — it broke 5 of the 8 pilot entries. `contentSelectors`
   is NOT a fallback chain. extract.ts binds the FIRST selector that matches an
   ELEMENT, even when that element extracts 0 characters, and then stops. A
   zero-text match SHADOWS every working selector after it.

   ⚠️ AND THERE IS NO SAFE DEFAULT. Do not assume `.contentpadding` just
   because most siblings use it — on `pyetjetejetes.com` it matched 52 of 78
   pages and extracted **0 chars on every one**, and the only container was
   `html`. NINE generators have been measured across 32 hosts:
   `.contentpadding`, `html`, `.content4`, **`#content4` (an ID, not a class)**,
   `.cb-entry-content`, `.entry-content`, `.post-content`, `.contentleftpadding`,
   `.article-content`, `.content`. Measure EVERY candidate on THIS host and
   report each one's char count — including the zeros. "`.content4` matched,
   0 chars" is a required line in your report.

   **Then ship the SINGLE measured selector FIRST**, never the sibling list.
   ✅ **You MAY append `"html"` as a LAST entry** — and should, if the primary
   has ZERO matched-but-empty pages. It cannot shadow anything (nothing follows
   it), it only fires when the primary misses, and it beats extract.ts's
   implicit `?? root` because `<html>` is a real element and carries no literal
   `<!DOCTYPE html>` text node. Pair it with `"head"` in `stripSelectors` (0
   chars on healthy pages; drops the duplicated `<title>` on the fallback path —
   safe because extract.ts reads the title from `root` at line 43, BEFORE the
   strip loop at line 52). If the primary CAN match at 0 chars, the fallback
   never fires — that host needs `["html"]` outright.
4. Chrome to strip — check `sitelevel_noindex` (a custom ELEMENT, not a class,
   hence no leading dot), `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
   `.relatedbottom`, `.a2a_kit` and `.shareiconsmenupg`. **Measure what each
   actually removes and say so honestly.** `sitelevel_noindex` is NOT malformed
   on every host: on most measured hosts it is well-formed and already contains
   the share widget, making `.shareiconsmenupg` a **0-char no-op** kept only as
   a drift guard. Do NOT repeat "REQUIRED because the markup is malformed"
   unless you measured malformation HERE. `.relatedbottom` has been dead config
   on every host so far. If this is a non-FreeFind generator (WordPress, Yii,
   Angular) these may be absent entirely — say so and OMIT them rather than
   carrying parity no-ops that can never bind.
5. Language — READ THE CONTENT YOURSELF and say what you read, quoting a phrase.
   Confirm it is genuinely <LANGUAGE>, not untranslated English (a real failure
   mode: cru.org's Spanish path served English bodies). Do NOT use, install or
   mention any language-detection library.

   ⚠️ **Do not trust `<html lang>`** — `persoalanhidup.com` declares `lang="id"`
   and serves Malay. ⚠️ **Count with WORD BOUNDARIES** if you are separating
   close languages: naive substring counts gave the *opposite* answer on
   Croatian vs Serbian (`ko` scored 1,354 inside "kako"/"tko", and 0 with
   `(?<!\p{L})…(?!\p{L})`). ⚠️ For a non-Latin script, also fetch the response
   headers: several hosts serve UTF-8 with a bare `content-type: text/html` and
   NO charset parameter — confirm the text is not mojibake.

## Shape of the entry
- DISCOVERY mode (`sitemaps` + `allow` + `articleHints` + `block`), not
  hand-listed seeds — except seeds pinned per step 2. Precedent: thelife-fr.ts.
- OMIT `fetchStrategy` — not walled, plain HTTP is the default. ⚠️ Cloudflare's
  PRESENCE is not a wall: classify on the BLOCK-PAGE SIGNATURE, not the CDN
  header. Hosts have passed traffic while Cloudflare-fronted, and one serves a
  Turnstile CAPTCHA on its mail forms and still returns 200 with full HTML. If
  you DO find a genuine Cloudflare 403 block page, STOP, write nothing, report.
- `languages`: the ISO 639-1 code detection emits (regional variants declare the
  base code, e.g. zh-cn → ["zh"]; note the variant in key/name/docstring).
- `key`: `everystudent-<code>`, matching /^[a-z0-9-]+$/.
- `maxPages`: sitemap count + headroom. `minContentLength: 250`.
  `requestDelayMs: 1000` unless probes suggest otherwise (a slow PHP host
  wanted 2000).
- `trust: "partner"`, `ingestionMode: "html-scrape"`, `defaultCategory: "article"`,
  tags `["everystudent","cru","topic:seeker","lang:<code>"]`, a `rights` line
  matching the siblings.
- ⚠️ **Check the canonical host both ways.** Most siblings 301 apex → `www.`,
  but `everystudent.sk` does the REVERSE (`www.` 301s to the bare apex). Pin
  `domain`/`baseUrl`/every regex to whichever actually serves, or every filter
  misses.
- BLOCK the localized Gospel-of-John signup page and the "adventure/pack" email
  series — they clear minContentLength and only a URL block catches them. Some
  hosts have neither; report an absence you MEASURED rather than omitting
  silently.
- ⚠️ **BLOCK FULL SCRIPTURE — estate-wide policy, 2026-07-29.** Several siblings
  carry complete or abridged Bible books on article URLs (98k–100k chars).
  Policy: "public-domain Scripture text rather than ministry writing — outside
  what this corpus answers from." Watch for a third-party Bible-society
  copyright too (© Eesti Piibliselts, © Tyndale House Foundation) — our
  `rights` line would misattribute it. An apologetics essay *about* the Bible
  is NOT scripture: keep it, and say how you told them apart.
- BLOCK the homepage, nav/menu indexes, and ANY sitemap URL you find redirecting
  (301/302) to the homepage. ⚠️ Never argue "minContentLength will drop it".
  When no contentSelector matches, extract.ts does NOT return empty — it falls
  back to `<body> ?? root`, and `<body>` is ABSENT from the parsed tree on most
  of this estate, so the real fallback is the WHOLE DOCUMENT. A sibling shipped
  25 unblocked dead URLs on that reasoning and staged 25 byte-identical copies
  of its homepage. If you do not want a page, block it by URL. Report any
  redirecting URLs you find with the exact list.
- ⚠️ **Do NOT block a real article just because its markup is broken.** If a
  page's container collapses (an unclosed `<span>`, a `</h1>` closing an
  `<h2>`, a `<sup>` missing its `>`), the step-3 `"html"` fallback fixes it.
  Three genuine articles were nearly lost this way in batch 3. Report such
  pages; do not silently drop them.
- ⚠️ Mixed-case slugs exist (`/a/pomoshch-ot-Boga.html`, `/articulos/Dios.html`).
  Use `[^/]+`, not `[a-z0-9-]+`. If slugs carry non-Latin script or `%XX`
  escapes, say so — an ASCII-only hint would drop every one.

## Docstring
Match the siblings' standard, but ONLY claim what you MEASURED. Stamp measured
facts "verified <DATE>: …". Never write a measurement you did not take. Note the
separate-key-per-domain rule (ADR-0006).

⚠️ **Never write `*/` inside the docstring** — not even in a code span like
`` `/category/*/` ``. It terminates the JSDoc block and turns the rest of the
file into code; it cost 20 typecheck errors on `everystudent-it.ts`, none of
which named the real cause. Write `` `/category/<slug>/` `` instead.

## Tests
Model on everystudent-fr.test.ts. Assert what would be costly to silently undo:
domain, languages, discovery-vs-seed mode, the selector you measured binding
FIRST, the absence of the 0-char shadow selector, the strip list,
separate-key-per-domain, and any URL block encoding a real decision (scripture,
dead redirects, robots). 4–6 focused tests. Do not pad. **Do not write a test
that asserts a field equals what you typed for its own sake** — that tautology
is what let 5 broken entries through the pilot.

## eslint: `max-lines: 300` (comments excluded) on the entry file.

## Report back — tight
- domain + sitemap count (and any delta from the brief's recon number) + which
  sitemap file you used + the `<loc>` scheme + article pattern + HTML-map
  cross-check delta, listing any URLs you pin as seedPaths
- EVERY candidate selector with its measured extracted char count across at
  least 2 pages (including the zero ones — "`.content4` matched, 0 chars" is a
  required line), which one you shipped FIRST, and whether you appended `"html"`
- robots.txt verdict, and any path you blocked by hand to honour it
- language confirmation in your own words, quoting a phrase you read; plus
  script/encoding notes for a non-Latin host
- what each strip selector actually removed, in chars (0 is a fine answer)
- anything surprising, or any call the orchestrator must make
```

---

## 11. Corpus issues filed

- **[#128](https://github.com/JesusFilm/jesusfilm-rag/issues/128)** — share-widget
  chrome embedded in all three **existing** EveryStudent sources, **live in prod**:
  `everystudent` 97/117 docs · `everystudent-ar` **67/67** · `everystudent-fr`
  **67/67** (232 chunks total). Fix is one selector (`.shareiconsmenupg`) plus a
  re-extract — no re-fetch, no Firecrawl credits.
  **Deliberately NOT part of this campaign's branch or PR** — it touches three
  existing sources and would make the 48-source PR unreviewable.
- Related open: **[#123](https://github.com/JesusFilm/jesusfilm-rag/issues/123)**
  content soundness, estate-wide (found in `-ar`, confirmed in `-fr`).
- **[#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129)** (new,
  2026-07-29) — whether `everystudent-sr` is a listable retrieval source at all,
  given our own network blackholes it. Blocks only `sr`. **The fix is NOT an
  `/etc/hosts` line** — see §4.
- **[#131](https://github.com/JesusFilm/jesusfilm-rag/issues/131)** (new,
  2026-07-30) — `everystudent-ar` seeds a **full Gospel of John** (23,624 ch),
  **live in prod**, against the scripture policy that entry itself established.
  Exactly one document; the other two prod sources were checked and are clean.
  Deletion, not re-acquisition — no Firecrawl credits. Rule 20.
- **[#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132)** (new,
  2026-07-30) — whether `everystudent-he` (igod.co.il) belongs in the corpus:
  **not a Cru property**, 1,020 articles rather than the ~5 #111 recorded, and
  a CDATA sitemap `discover.ts` cannot parse. Carries the full recon so the
  entry is a short write if the answer is yes.
- **[#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133)** (new,
  2026-07-30) — `lv` (katramstudentam.lv): `robots.txt` disallows `ClaudeBot`
  **by name**, so this is a rights question, not a crawling one. Recommends
  asking Agape Students Latvia. Also records that robots compliance on this
  estate has now been hand-patched **five times** because the acquire path
  never reads `robots.txt` (§13 #7).
- ✅ **[#138](https://github.com/JesusFilm/jesusfilm-rag/issues/138)** (filed
  2026-08-03, found 2026-07-31 — §0.4 finding 3). The
  LLM language detector's `DEFAULT_MAX_OUTPUT_TOKENS = 200`
  (`src/adapters/openrouter/openrouter-language-detector.ts:34`) can truncate a
  correct response mid-`evidence`-string, which the adapter then rejects as
  `response was not JSON`. Hit **1 document in 409** (an Albanian page —
  diacritic-heavy text tokenises poorly). The row is left untouched and logged as
  an anomaly, which is correct behaviour, **but the failure is indistinguishable
  from an honest abstain in the report's "Left null" section** — on a big run it
  reads as a detection limit rather than a bug. Two candidate fixes: raise the
  cap, or cap the `evidence` field length in `SYSTEM_PROMPT`. A plain re-run
  fixed this instance.

## 12. Decisions made

| Date           | Decision                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28     | Campaign file, not 48 `/slice` runs                                                          | Only acquisition is per-source; ingest/eval are already bulk. ~300 operator gates avoided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-28     | Fan out on registry authoring only                                                           | It is the sole per-source unit with no shared state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-28     | Discovery mode over hand-listed seeds                                                        | Sitemaps reachable, plain HTTP free. Seeds used only to patch stale sitemaps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-28     | Branch `feat/everystudent-siblings` off `origin/main`                                        | New work; `slice/everystudent-fr` was already merged upstream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-28     | #128 kept out of this branch                                                                 | Keeps the 48-source PR reviewable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-07-28     | Batch 2 sized at 12                                                                          | Pilot of 8 was comfortably reviewable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-28     | `contentSelectors` ships ONE measured selector, never the sibling chain                      | A zero-text match shadows everything after it (rule 1b). 5 of 8 pilot entries extracted 0 chars because `.content4` — an empty spacer — was listed first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-28     | Live-extraction check added to the Phase-1 gate                                              | `--dry-run` fetches nothing and the unit tests are tautological, so neither can see a broken selector. Only running `extractContent` on a real page can.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-28     | `extract.ts` NOT changed on this branch                                                      | Preferring the first text-yielding selector would fix the trap globally but alters extraction for all sources incl. the 3 live in prod. Raised as open question #5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-28     | `ro`'s 25 dead URLs hard-blocked, reversing the earlier call                                 | The "self-policing floor" reasoning ignored the `<body>` fallback; the real run staged 25 identical nav pages (rule 1c). 25-branch alternation is the cheap fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-28     | `ja` keeps `.content4` first — deliberately not normalised                                   | It is a genuine container there and carries the category kicker that `.contentpadding` omits (11 ch/page). Switching would lose the kicker on 79 pages to fix 0. Mixed-host caveat documented in the entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **2026-07-29** | **Predominantly Scripture pages quarantined while rights and attribution are unresolved**    | Five hosts carry full Bible text, but the corpus records only source-level rights and retrieval returns a source-page citation—not the Bible translation, its rights holder, reuse terms, or required attribution. Applied temporarily and uniformly: `et` `mn` `fa` already blocked; **`sq` `/a/gjoni.html` (98,887 ch) and `es` `/articulos/biblia_juan.html` (100,409 ch) newly blocked**, and the `es` row deleted from `raw_documents`. `et` proves the risk: its chapters are © Eesti Piibliselts, which the source-level `rights` line would misattribute. Ordinary Scripture quotations inside ministry articles remain in scope. A future decision must define when and how predominantly-Scripture documents may enter the corpus. |
| **2026-07-29** | **`bg` ingested despite being a pre-launch staging site**                                    | Operator call. Cru owns the property. All automated signals say keep out (`Disallow: /`, `noindex` header + meta, staging canonicals). Recorded prominently in the entry so nobody "fixes" it later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **2026-07-29** | **`bg` is SEED mode, not discovery**                                                         | Its 84 article `<loc>`s all name `staging.everystudent.bg`. Discovery would stamp a staging host into `canonical_url` — the dedup key — for all 84 documents, needing a rewrite at launch. `www` serves the identical pages at 200, so the paths are hand-listed against a `www` baseUrl. Precedent for seed-only: `everystudent-ar`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2026-07-29** | Batch 2 sized at 12, and it held                                                             | 12 concurrent agents, no scratch collisions (per-agent subdirectories worked), 11 clean entries + 1 correct refusal. Reviewable. Keep 12 for batch 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2026-07-29** | `bg`'s agent was right to STOP and write nothing                                             | It hit a robots `Disallow: /` and a staging canonical and escalated instead of shipping. That is the behaviour the prompt asks for; the recon it returned made the entry a 20-minute write once the operator decided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2026-07-29** | **Batch 3 sized at 12, and it held again**                                                   | 12 concurrent agents, zero scratch collisions, 12 clean entries, 0 refusals. Second consecutive clean run at 12. Keep 12 for batch 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2026-07-29** | **`contentSelectors` may carry a trailing `"html"` — rule 1e**                               | Orchestrator call. Rule 1b forbids an _unmeasured selector FIRST_; a trailing entry shadows nothing, and `<html>` beats `extract.ts`'s implicit `?? root` because it carries no `<!DOCTYPE html>` text node. Proven inert: all 24 batch-3 gate probes returned **byte-identical** values before and after. Applied to the 8 hosts whose primary has zero matched-but-empty pages, with `head` added to `stripSelectors`.                                                                                                                                                                                                                                                                                                                     |
| **2026-07-29** | **Three articles un-blocked that had been dropped over the doctype artefact**                | `th` `/a/300whatislife.html` (10,449 ch), `lt` `/m/istorija.html` (20,148 ch), `bn` `/a/followup.html` (3,255 ch, pinned as a seed). All verified extracting clean under rule 1e. `bn` had blocked one page while KEEPING another with the identical defect — the calls contradicted each other. Losing a real article to avoid 15 cosmetic characters is the wrong trade.                                                                                                                                                                                                                                                                                                                                                                   |
| **2026-07-29** | **`lt` `/m/istorija.html` exempted from the blanket `/m/` block**                            | Every sibling blocks `/m/` as navigation. Before reversing that here, the `/m/` namespace was probed on `ru`, `pl`, `hu` and `tr`: **nothing above 3,589 ch**, and the only two over 3k are a sitemap page and an "about us". So `lt`'s 20,148-ch testimony page is a genuine one-off, **not** content the blanket block has been quietly eating across 20 sources. No systemic loss to fix.                                                                                                                                                                                                                                                                                                                                                 |
| **2026-07-30** | **Batch 4 sized at 11 (all that remained), and it held a third time**                        | 11 concurrent agents, zero scratch collisions, 11 clean entries, 0 refusals, and **all 10 acquirable hosts staged 100% with zero skips** — the campaign's first perfect acquire. The §10 prompt's corrections-first design is now proven three consecutive rounds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **2026-07-30** | **`he` deferred rather than acquired, on THREE grounds**                                     | Orchestrator call, escalating rather than deciding. The entry is sound and gate-passed, but (1) `discover.ts` cannot parse its CDATA sitemap, (2) igod.co.il is **not a Cru property** — footer `© המכללה למקרא`, zero Cru/EveryStudent markers site-wide — so our `rights` line and `cru` tag would misattribute it, and (3) at **1,020 articles** it is 47% of the campaign corpus, which is a composition question, not a technical one. Only (1) is answerable in code. Same escalation shape as `bg` on 2026-07-29.                                                                                                                                                                                                                     |
| **2026-07-30** | **The CDATA fix to `discover.ts` NOT made on this branch**                                   | Consistent with `extract.ts` (#5) and `normalizeUrl` (#9): shared acquisition code changes get their own issue. Noted honestly that this one is _provably_ inert for the other 42 sources — a `<loc>` beginning `<![CDATA[` can only crash or be dropped today — so the argument for deferring is consistency and reviewability, not risk. §13 #10.                                                                                                                                                                                                                                                                                                                                                                                          |
| **2026-07-30** | **`om` shipped as `languages: ["om"]` despite the detector being unable to emit it**         | The registry declares what the source _is_, not what the detector can recognise. `tinyld` has no Oromo model, so 17 of 18 documents will store `language = null` and one stores `'ber'`. Declaring anything else would be a lie in the entry to paper over a gap in a different module. Recorded as §13 #11. ✅ **Vindicated 2026-07-31:** the LLM sweep labelled all 18 `om` at confidence 1.00. Declaring the truth and letting a _different_ module catch up was the right call.                                                                                                                                                                                                                                                          |
| **2026-07-31** | **Language corrected with `--source … --mode full` per source, NOT `--all`**                 | The corpus is 13,969 documents and had already had a full sweep before this campaign. `--all --mode full` would re-audit ~13,000 already-correct rows to fix 406. Eight sources needed `full` (they carried wrong labels); sixteen needed only `blanks`. Per-source also means per-source changelogs, so a bad relabel reverts without touching the others. Ran as 8 dry-runs → review → 8 applies → 16 blanks-applies.                                                                                                                                                                                                                                                                                                                      |
| **2026-07-31** | **Applied all eight `--mode full` relabels without a per-source operator pause**             | The Step-1 dry-runs returned 100% resolution to the declared language at confidence 0.99–1.00, with **zero** rows in the report's "Eyeball these" list and zero left null. There was no ambiguous call to escalate. Had any source come back mixed, or with a relabel _away_ from its declared language, that would have been a stop.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2026-07-31** | **§0.2's hand-maintained damage table treated as untrustworthy; fix list re-derived by SQL** | The table undercounted by 26 documents — it filed `everystudent-fa` under §0.3 as nulls-only and missed that 26 Persian pages were labelled `ar`, colliding with a source already live in prod. A table maintained by hand across five batches drifts; a query against the registry's declared `languages` cannot. Query preserved in §0.4.                                                                                                                                                                                                                                                                                                                                                                                                  |
| **2026-08-03** | **Phase 5 scope: ALL 45 campaign languages, not the 7-language shortlist**                   | Jaco's call. Capability decides, not convenience — a language is `evaluate: deferred` only for a stated, specific reason, never as the residue of a blanket "everything else". Two independent measurements backed it: the §0.4 sweep cleared guardrail 3a (0 nulls corpus-wide, so every source can now generate candidates), and the §0.6 floor probe found **no language collapses** — `ka` `om` `sw` `ti` `ne`, the ones assumed unusable, all retrieve at self@10 ≥ 0.88. The only remaining constraint was operator attention, which is Jaco's to spend.                                                                                                                                                                               |
| **2026-08-03** | **`evidence_tier` added, and the 130 existing cases left UNTAGGED rather than backfilled**   | The eval already had a process for a reviewer who cannot read the language (`eval-approach.md`: approve on an English translation of the question _and_ results) — it shipped for `ar` and `fr`. What it never named is that for French Jaco can spot a bad translation and for Tigrinya he cannot. The tier records that difference and `pnpm eval` reports the buckets apart; it is **not** a quality gate — nothing is discounted or excluded. Backfilling the old cases to `human-verified` was rejected: nobody now can say which of them the reviewer read unaided, and asserting it would be the same overreach the tier exists to prevent.                                                                                           |
| **2026-08-03** | **Part A scoped by SQL, not by assumption — 18 cases, not 130**                              | `es` and `zh` are the only two multi-source languages the campaign touched, and `cases already crediting a campaign source` measured **0**. `corpus-search-store.ts` applies a strict `eq(documents.language, …)`, so for the other 43 languages no existing case can resolve to a campaign document — Part A is a _provable_ no-op there. Same lesson as 2026-07-31: derive the work list from a query, never from a hand-kept table.                                                                                                                                                                                                                                                                                                       |
| **2026-08-03** | **The 10-topic canonical menu, engine-checked before the operator saw it**                   | Jaco approves the topic set ONCE, in English, and all 45 languages draw from it — so he never re-judges "is this a good question", only "did this language's articles answer it". Derived from what the estate actually publishes (the English parent's 117-article menu + the six smallest sources), because a topic Swahili's 13 documents lack would manufacture cases with no valid answer key. Reach 10/10 at 9/9 test sources spanning 13→128 docs; no paraphrase smell (max 0.701). Three topics were reworded after an A/B, one of them choosing the LOWER-scoring variant because it landed on the right document 6/8 vs 4/8.                                                                                                       |
| **2026-08-03** | **Part B questions authored IN-LANGUAGE, English used only for DISCOVERY**                   | Measured: an English question reaches the right source in 96.5% of pairs and 6 questions reach 6 distinct documents in 7 of 8 languages — good enough to build a candidate pool uniformly across 45 languages, and _not_ good enough to auto-credit (top-1 is often the wrong topic). But the case's question must be in-language: real users of `everystudent.co.th` ask in Thai, so an English-question eval would measure something nobody does.                                                                                                                                                                                                                                                                                          |
| **2026-08-03** | **`everystudent-zh-cn`'s 10 cases approved and written — the first campaign golden suite**   | Guardrail-#4 approval turn honoured: drafted → presented → stopped → written on an explicit "approve". 34 credits over 31 documents, every one judged on chunk text, every path verified to resolve 1:1. Result: recall 1.000, coverage **0.897** — second-highest per-source in the suite. Cross-source credits (`thelife-zh`, `zh-tw`) deliberately deferred to Part A rather than crediting documents nobody had read.                                                                                                                                                                                                                                                                                                                    |
| **2026-08-03** | **Part A promoted AHEAD of the remaining 13 tier-A sources**                                 | Reversal of the same session's earlier ordering, on evidence. Part A is 18 cases with the exact documents already identified, it recovers a measured coverage shortfall, and it unblocks the cross-source credits `zh-cn` had to leave out — hours of work against ~135 cases for the rest of tier A. Do the cheap thing that fixes a known regression first.                                                                                                                                                                                                                                                                                                                                                                                |
| **2026-07-29** | **`sr` deferred, and the `/etc/hosts` workaround explicitly rejected**                       | Jaco's call, reversing the earlier "add a hosts entry" decision. A host our own network filters cannot be listed as a publicly available retrieval source on the strength of a machine-local override — the workaround would hide the question rather than answer it. Tracked in [#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129). Note the domain IS publicly resolvable (both DoH providers return the real IP); what needs deciding is why our gateway blackholes it.                                                                                                                                                                                                                                                        |
| **2026-08-04** | **Bulk batches replace one-source-at-a-time, and guardrail #4 moves to batch granularity**   | Jaco's call — _"why not just do that in bulk parallel per remaining source so we can get this done?"_ Three suites had run per-source and **the operator approved every one, every time**: the exact signature the golden skill's guardrail #7 names — _"a gate that always returns the same answer is not oversight, it is latency."_ The gate is not removed, only re-grained: draft everything, present ONE consolidated report, write on ONE explicit approval, one commit per batch so a bad batch reverts cleanly. Result: 42 approval turns became 2.                                                                                                                                                                                 |
| **2026-08-06** | **Batches B, C and D collapsed into ONE 30-source batch**                                    | Jaco, on re-entry: _"we can't continue one source at a time. We need to knock out the remaining work fast."_ The real cost of batch 1 was not concurrency — it already ran 11 agents — but that **every agent hand-wrote its own check script**. Two generic tools (`phase5-openings.ts`, `phase5-check.ts`) removed that, validated by reproducing `hu`'s recorded batch-1 numbers exactly before any new agent launched. 30 suites in one turn; the `(untagged)` control moved 0.002.                                                                                                                                                                                                                                                      |
| **2026-08-06** | **The estate's 13 predominantly-Scripture "Who was Jesus?" pages quarantined**               | Extends the temporary 2026-07-29 rights-and-attribution quarantine; it does not declare Scripture out of scope. §0.12 had claimed one such document survived, "audited across all 45 sources" — the real count is **13**, all the same curated-highlights page carrying the stated formula _"no commentary added"_. Two take ranks 7 and 8 on a cross question, confirming that inclusion needs a deliberate rights/metadata design rather than an accidental crawl result. ⚠️ Method note: a verse-density regex under-detects (it missed `de`, `ro`, `sq`); **slug family + size band** found all 13.                                                                                                                                      |
| **2026-08-06** | **Video twins are NEVER credited, estate-wide**                                              | Several sources publish an abridged video transcript beside the full article (`th` has 8, plus `ro` `ms` `de` `id`), and `th`'s twin **outranks its own parent**. Crediting per-case would have made 5 sources inconsistent with each other for no measurement gain. Applied immediately: `/a/collins.html` dropped from the `hi` and `ur` suites with the reason recorded in both candidates files.                                                                                                                                                                                                                                                                                                                                         |
| **2026-08-06** | **`ru-ca` gets NO golden suite**                                                             | 5 documents; the 4-case floor is almost one question per document, which enumerates the corpus rather than measuring retrieval over it. It is a mirror of `everystudent-ru` (§16). Recorded as a `note` in `docs/source-status.yaml` so the lone `evaluate: pending` row explains itself. Revisit only if it grows past ~20 documents.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **2026-08-06** | **`evaluate` flipped green for all 44 sources in one pass, through the writer**              | §7 holds stage verdicts while Phase 5 is mid-flight; Phase 5 closed, so the flip was owed. Done via `pnpm status:set` — `docs/source-status.yaml` says in its own header never to hand-edit it, because the top-level `status` is _derived_ and a hand edit can make it disagree with the per-language state. `pnpm status:check` passes; rollup is 47 `done` · 2 `deferred` · 1 `in-progress`.                                                                                                                                                                                                                                                                                                                                              |

## 13. Open questions for the operator

> ✅ **EVERY QUESTION IN THIS SECTION IS NOW ANSWERED.** It is kept as the record
> of how each was decided. Current open items are in §0 START HERE — and there
> are only four: the raw-scripture exclusion (approved, not yet executed), the PR,
> prod, and the `lv` rights question.
>
> | Q                  | Answer                                                                                                                                                                                        | Where                 |
> | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
> | 1. Eval shortlist  | **ALL 45 languages get real golden cases**, with `evidence_tier` marking machine-translated answer keys so they are reported apart from human-verified ones. Delivered: 44 suites, 416 cases. | §7 · §0.13            |
> | Scripture policy   | Full Gospel of John excluded (3 documents). **Extended 2026-08-06** to the 13 "Who was Jesus?" curated-highlights pages.                                                                      | §12 · §0.13 finding 3 |
> | `sr` network route | **Deferred, no `/etc/hosts` workaround** → [#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129)                                                                                      | §4                    |
> | `he`               | **Deferred** — not a Cru property, CDATA sitemap, 200× the recon count → [#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132)                                                        | §16                   |
> | `lv`               | **Rights question, not engineering.** Ask Agape Students Latvia → [#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133)                                                               | §15                   |
> | `ru-ca`            | **Mirror of `ru`.** Registered with 5 seeds, no golden suite.                                                                                                                                 | §16                   |
> | Video twins        | **Never credit one.** Estate-wide, 2026-08-06.                                                                                                                                                | §0.13                 |

**Answered 2026-07-29:** scripture policy (now §12), `bg` (ingested, §12),
`sr` network route (hosts entry, §4).

1. **Eval shortlist (§7)** — confirm `es`/`zh`/`ru`/`pt`/`de`/`ja`/`ko` get real
   golden cases and the remaining 41 are `evaluate: deferred`, or name a
   different set. **Does not block Phases 1–4.** Batch 2 added 11 more languages,
   **10 of them entirely new to the corpus** (`sq` `fa` `mn` `tr` `cs` `hu` `pl`
   `et` `vi` `bg`) — for those, Stage-4 Part A is a provable no-op. Only `zh`
   (from `zh-tw`) lands in an existing language, and it makes that label
   **three-way ambiguous** (see #6).

   **Batch 3 adds 12 more, and ALL TWELVE are new to the corpus** — `sk` `id`
   `ms` `mk` `lt` `bn` `th` `hr` `am` `it` `ur` `el`. Stage-4 Part A is a
   provable no-op for every one (`corpus-search-store.ts` applies a strict
   `eq(documents.language, …)`, so no existing golden case can resolve to them).
   Running total after batch 3: **31 acquired sources across 30 distinct
   language labels** (`zh-cn` and `zh-tw` share `zh`). Existing golden cases
   cover only `ar` `fr` `en` `es` — so of this campaign's 30 labels, **exactly
   one (`es`) has any golden case today.** That is the scale that makes the
   question real: the "everything else is `evaluate: deferred`" half of the
   proposal now covers **~23 languages**, not a handful.

   ⚠️ One nuance for the shortlist: `it` (Italian) and `el` (Greek) are widely
   read and might deserve real golden cases even though they are new labels;
   `am` `bn` `ur` `th` `mk` `lt` are the ones nobody here can curate. Worth
   splitting the decision by _who can read it_, not by _is it new_.

2. **When to fix #128** — before the 48 land, after, or on its own schedule.
   Note the scope shrank: batch 2 measured `sitelevel_noindex` **well-formed** on
   6 of 11 hosts, so #128 is host-specific (rule 4, corrected).
3. ~~**The 5 sitemap-less domains**~~ — **ANSWERED 2026-07-29, see §15.**
   Hand-listed seeds from each site's own HTML map; **no Firecrawl** (4 of 5 are
   bare Apache serving 200 — there is no wall to pay for). ~234 docs.
   **One residual decision for Jaco: `lv` (katramstudentam.lv).** Its
   `robots.txt` disallows `ClaudeBot` and `CloudflareBrowserRenderingCrawler` by
   name and declares `Content-Signal: ai-train=no,use=reference`. Recommendation
   is to ask Agape Students Latvia (a Cru partner) rather than crawl it. Needs a
   yes/no from you; everything else in §15 is unblocked.
4. **Make the live-extraction gate a checked-in script?** (2026-07-28.) It has
   now been hand-rebuilt from this file **twice**. It caught nothing in batch 2
   — because the agents were told to measure — but it is what _proves_ that,
   and it took two extra variants this round (an IPv6 flag for `cs`, an
   offline file-based run for `sr`). Strong candidate for
   `pnpm acquire --source <key> --probe`. Still needs Jaco's yes.
5. **Should `extractContent` skip zero-text matches?** Unchanged, and batch 2
   strengthens the case: `sq` proved even `.contentpadding` can be the zero-char
   shadow (rule 1d), so there is no selector ordering that is safe by
   convention. Still deliberately NOT done on this branch.
6. **NEW — `zh` is now a three-way collision.** `thelife-zh` (uwota.com,
   Simplified), `everystudent-zh-cn` (Simplified) and `everystudent-zh-tw`
   (Traditional) all declare `zh`. Language-filtered retrieval cannot separate
   Traditional from Simplified. Recorded, not solved. `ru` / `ru-ca` will do the
   same when `studentstan.com` lands.
7. **NEW — the repo does not enforce `robots.txt` at all.** The `robots_cache`
   table, the `RobotsEntry` port and both its implementations exist, but **no
   caller in `src/acquisition/` invokes them** — verified 2026-07-29 — while
   `docs/architecture.md:150` declares Acquisition "Owns: … robots (RFC-9309
   longest-match, fail-open)". So that line is aspirational. It surfaced here
   because `bg` serves `Disallow: /` and `sq` disallows a real article path
   (`/a/ungjillin2.html`, blocked by URL by hand as the only thing that would
   honour it). **Deserves its own issue, not this branch** — same reasoning as
   #128.

8. **NEW (batch 3) — do film-transcript pages belong in this corpus?** Same
   shape as the scripture question you settled on 2026-07-29: a content-scope
   call, not a technical one. The "Falling Plates" / video-narration page exists
   estate-wide and agents keep deciding it one host at a time:

   | Source | Page                        |             Extracted | Call     | Measured reason                          |
   | ------ | --------------------------- | --------------------: | -------- | ---------------------------------------- |
   | `pl`   | `/wideo.html`               | ~60 one-line captions | blocked  | nav URL, chunks badly                    |
   | `ru`   | `/m/vid.html`               |                     — | blocked  | nav URL                                  |
   | `sr`   | `/a/tanjiri.html`           |                 33 ch | blocked  | stub                                     |
   | `hr`   | `/a/razbijeni-tanjuri.html` |              1,321 ch | **kept** | paragraph prose, in both maps            |
   | `am`   | `/a/plates.html`            |                953 ch | **kept** | flagged: ~40 lines, chunks poorly        |
   | `id`   | 2 pages                     |         ~205 ch/block | **kept** | indistinguishable from articles          |
   | `mk`   | 3 pages                     |        1,326–2,098 ch | **kept** | `pl`'s stated reason measured false here |
   | `th`   | 8 `-video` twins            |     0.1–78.2% overlap | **kept** | below the 87.9% near-dup band            |

   The principle each agent applied is consistent — keep paragraph prose, drop
   caption fragments and stubs — and the pages genuinely differ, so this is not
   sloppiness. But it recurs across the remaining 16 domains and is worth one
   ruling. **Exposure is ~1–8 documents per host.** Not blocking.

9. **NEW (batch 3) — should `normalizeUrl` canonicalise the URL scheme?**
   `everystudent.gr` publishes `http://` sitemap URLs, and nothing in the
   acquire path rewrites them (rule 13), so its 32 documents store `http://`
   canonical URLs. The dedup key is `(sourceKey, canonicalUrl)`, so if that host
   ever republishes as `https://`, a re-acquire **creates 32 duplicates instead
   of updating**. The fix is one line in `normalize-url.ts` — but it changes the
   dedup key for **every** source including the three live in prod, so it is the
   same shape as #5 and deliberately NOT done on this branch. Deserves its own
   issue.
10. **NEW (batch 4) — `discover.ts` cannot parse a CDATA sitemap.** Rule 16 has
    the mechanism, the two failure modes and the four-line fix. It is the only
    thing that makes `he` un-acquirable in code terms. **Deserves its own
    issue**, like #7 and #9. Unlike those two, this fix is provably inert for
    every other source, so it is the cheapest of the three to land.
11. ✅ **ANSWERED 2026-07-31 — no ruling needed.** The premise was wrong: `om` is
    undetectable _by `tinyld`_, not undetectable. The LLM sweep (§0.4) labelled
    **all 18 documents `om` at confidence 1.00**, including the `'ber'` row. Same
    for `ka` (Georgian, 16/16 at 1.00), which `tinyld` cannot read at all. The
    original text is kept below because it is the correct diagnosis of the
    _ingest-time_ detector, which is unchanged and will do this again on the next
    Oromo source and in prod (§0.4, "does NOT carry to production").

    ~~**NEW (batch 4) — `om` (Oromo) cannot be language-detected at all, and this
    is not fixable in the registry.**~~ `tinyld` has no Oromo model. Pushed
    through the real `decideLanguage` (gate 0.75, floor 500) on all 18 acquired
    articles:

    | Outcome                                                              |  Count |
    | -------------------------------------------------------------------- | -----: |
    | `documents.language = null` — confidence 0.242–0.717, below the gate | **17** |
    | stored as **`'ber'` (Berber)** at 0.784, with an out-of-set warning  |  **1** |

    Consequence: Oromo documents are retrievable in unfiltered search but
    invisible to a `language:"om"` filter, and one row carries an actively
    wrong label. The standing null-language policy already covers nulls
    (expected, excluded from eval, surfaced on the dashboard) — but that policy
    was written for scattered short documents, not for **94% of one source**.
    The `'ber'` row is the part that is arguably a bug rather than a gap.
    ~~**Not blocking; needs a ruling at Phase 3.**~~ Resolved by the sweep — the
    real lesson is that a source whose language `tinyld` cannot model needs a
    sweep pass wired in **per environment**, not a policy exception.

12. **NEW (batch 4) — is `he` (igod.co.il) in scope at all?** See §4. Three
    questions in one: the code fix (#10 above), whether a **non-Cru** ministry
    belongs under the EveryStudent campaign key with our standard `rights` line
    and `cru` tag, and whether **1,020 documents from one host** — 47% of the
    campaign corpus, ~4× the largest existing sibling — is proportionate. The
    content itself is squarely seeker-facing apologetics and reads as in-scope;
    the attribution and the scale are what need a decision.

13. **NEW (batch 5) — `ru-ca` is a mirror; which of three routes?** See §16 for
    the full measurement and the three options. **Not an agent's call**, and
    the recon needed for any of them is already done.
14. **NEW (batch 5) — `everystudent-ar` carries a full Gospel of John in prod.**
    Rule 20 has the evidence. One document, one prod source, and the policy it
    violates is the one that source's own docstring established. Needs an issue
    of its own, not this branch.
15. **NEW (batch 5) — clean up the 14 doctype-leaking documents before Phase 3?**
    See §4. Seven batch-1/2 entries predate rule 1e. The fix is mechanical and
    costs 7 plain-HTTP re-fetches **now**, versus re-chunking and re-embedding
    **after** `pnpm index`. This is the cheap moment and it closes shortly.
16. **NEW (batch 5) — `ti` will be MISLABELLED, not merely unlabelled.** Worse
    than `om` (#11). `tinyld` carries 61 languages with no `tir` entry, and its
    only Ge'ez-script model is Amharic — so each of the 14 Tigrinya documents
    lands as `null` or as **`'am'` with an out-of-set warning**. `om` at least
    has no competing model to be wrong about. With only 14 documents there is
    no margin for them to be both mislabelled and dropped from `language:ti`
    retrieval. Same root cause as #11; worth one ruling covering both.

## 14. Resume hint (cold start)

### Repo state, exactly

- Branch **`feat/everystudent-siblings`**, tracking `origin/main`.
- **Unpushed commits — read them, do not trust a number written here.**

  ```bash
  git log --oneline origin/main..HEAD
  ```

  ⚠️ This file previously hardcoded the count and it went stale **three times in
  one session** — every commit invalidates it, including the commit that
  updates it. Do not reintroduce a number. The commits are self-describing;
  the command above is the source of truth.

  The campaign's own history, oldest first, as anchors that will not change:
  `6e7f492` batch-1 entries · `2807832` state file + #128 ·
  `6a31631` container fixes + batch-1 acquire · `4cbd1d2` cold-start contract ·
  `9a0fec3` batch-2 entries (11 domains) ·
  `9c60b40` `bg` + estate-wide scripture policy ·
  the docs commits recording batch 2, the `sr` deferral (#129), and §0 ·
  `0e8b1e9` batch-3 entries (12 domains) · the batch-3 docs update and the §10
  prompt rewrite · `4fce4ee` batch-4 entries (11 domains) · the batch-4 docs
  update · `26e8861` batch-5 entries (3 seed-mode domains) · then this file's
  batch-5 update.

- **Nothing is pushed and there is no PR** — that is Phase 6, after all 48 land.
  Do not open one early.
- Working tree clean apart from an untracked `.playwright-mcp/` (unrelated).
- Local Postgres container `jesusfilm-rag-db` on port 5434 must be running.
  Query it with:
  `docker exec jesusfilm-rag-db psql -U jesusfilm_rag -d jesusfilm_rag -c "…"`
- Last full gate: green **2026-07-30**, re-run AFTER the batch-5 acquire —
  depcruise · lint · typecheck · db:check · status:check · **739 tests**
  (was 722 after batch 4, 650 before it, 575 before batch 3, 496 before
  batch 2).

⚠️ **Dates in this file and in the registry docstrings are the dates the work was
MEASURED** — `2026-07-28` for batch 1 (matching `6a31631`), `2026-07-29` for
batches 2 **and** 3 (they ran on the same day; tell them apart by commit, not by
date — `9a0fec3`/`9c60b40` are batch 2, `0e8b1e9` is batch 3). Cross-check
against `git log` and they will agree.

### Where the work stands

> ⚠️ **This paragraph is the PHASE-2 record and is preserved as history. It is
> not current state — §0 is.** Phases 1–5 are all closed; the campaign is at
> Phase 6 (one PR), with one operator-approved corpus change queued ahead of it.

**All five batches are through Phase 2. Phase 1-2 are functionally COMPLETE.**
44 sources acquired locally, **2,276 documents**, **zero duplicate-content
groups across all 46 everystudent keys**, `acquire: green` recorded for each.
Per-source counts and full skip accounting: §8.

**Nothing is half-finished.** Both deferrals are decisions, not omissions:

- `everystudent-sr` — network blackhole, see §4 and
  [#129](https://github.com/JesusFilm/jesusfilm-rag/issues/129). Do not add an
  `/etc/hosts` line; that workaround was considered and rejected on purpose.
- `everystudent-he` — see §4. Three open points, only one of which is code.
  Do not "just fix the CDATA parsing and acquire it."

**All the sitemap-reachable domains are done.** What remains of Phase 1–2 is
the 5 sitemap-less hosts in §15.

Nothing has been indexed — Phase 3 runs ONCE, after acquisition is complete.

### Do this next — decisions, then Phase 3 (no crawling left)

0. **Render §0's board back to Jaco as your opening message.** He asked for the
   state as tables, not prose. Regenerate the counts from the DB first (§0.1) —
   do not retype what §0 currently says without checking it.
1. **There is no crawling left to do.** Every acquirable host in the 48 has
   been acquired, and the pre-Phase-3 cleanup is done. Do NOT spawn
   entry-writing agents. The three remaining decisions are filed as
   [#131](https://github.com/JesusFilm/jesusfilm-rag/issues/131),
   [#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132) and
   [#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133), and **none of
   them blocks Phase 3.**
2. **Phase 3 — `pnpm index`.** ⓘ **A canary run is sanctioned and was used**:
   `everystudent-am` was indexed alone first, verified, then bulk. See §6
   Phase 3 for the checks that make a canary trustworthy and the two
   operational findings it produced (ingest-side embed timeouts self-heal; the
   QUERY side needs `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000`
   or it aborts outright). Drains every pending row across all
   45 acquired sources. This is the expensive step (embeddings); it is
   idempotent on re-run. Expect ~2,281 documents from this campaign plus the
   pre-existing corpus.
   ⚠️ **Re-run the FULL verify gate after ingest**, not just after code changes
   — integration tests query the live Postgres and a data-only change can turn
   them red (slice #3 precedent).
3. **Then Phase 4** (per-language retrieval smoke, scripted — do not hand-run
   45 times) and **Phase 5** (eval, §7), remembering the mandatory env
   override: `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 pnpm eval`.
   `pnpm eval` has **no resume** and one transient blip discards the whole run.
4. **Then Phase 6 — ONE PR** for the campaign, lowercase title (commitlint),
   `gh auth switch --user jaco-brink` first.
5. **Regenerate §0's board before you finish** (§0.1). This is the last step of
   every session, not an optional tidy-up.

**If you DO end up writing another entry** (e.g. Jaco picks option 2 for
`ru-ca`, or answers `lv`): read §9 rules 1b–1f, 2, 4, 12, 13, 16, 17 and 19
first. The newest reverse or correct earlier advice — **1f** (`.articletitle`
is a shadow trap extracting a plausible non-zero number), **2** (probe `#x` as
well as `.x`; #111's outlier flags were wrong in _both_ directions), **16**
(CDATA sitemaps break discovery), **17** (the Slavic word-boundary guard
fabricates evidence on Indic scripts), **19** (try `curl <base>/a/` — Apache
autoindex is ground truth where it is open). For a seed-mode host the §10
prompt must be adapted, as it was for batch 5: `baseUrl` + `seedPaths`, no
`sitemaps` and therefore no `block`, and **HEAD-sweep every harvested URL**.

**Expect an agent to refuse occasionally, and treat that as success.** Three
have now done it and all three were right: `bg` hit a robots `Disallow: /` and
wrote nothing; `he` wrote the entry AND escalated the three things it could not
decide; `ru-ca` measured an 84.1% mirror and wrote nothing. **The refusals have
been among the most valuable outputs of this campaign** — each one caught
something no gate downstream would have.

### Waiting on Jaco — this is now the critical path

**Sixteen** open questions in §13; **two have been answered and closed since**
(#13 `ru-ca`, #15 the doctype cleanup), and three are now filed as GitHub
issues (#131, #132, #133). Nothing blocks Phase 3. Answered on 2026-07-29: the scripture policy, `bg`,
and `sr` (deferred → #129).

**The four that decide what happens next:**

| #       | Question                                                        | Why it is urgent                                                                                                     |
| ------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ~~#15~~ | ~~Clean up the 14 doctype-leaking documents~~                   | ✅ **DONE** 2026-07-30, commit `2b6f8a0`. 0 leaks remain.                                                            |
| ~~#13~~ | ~~`ru-ca` — drop, separate key, or fold into `ru`?~~            | ✅ **DONE** 2026-07-30, commit `185a090`. Separate key, 5 seeds. §16.                                                |
| **#12** | Is `he` (igod.co.il) in scope — not a Cru property, 1,020 docs? | Filed as **[#132](https://github.com/JesusFilm/jesusfilm-rag/issues/132)**. Decides whether the corpus grows by ~45% |
| **#3**  | `lv` rights — ask Agape Students Latvia?                        | Filed as **[#133](https://github.com/JesusFilm/jesusfilm-rag/issues/133)**. Only host nobody has permission to crawl |
| **#14** | `everystudent-ar`'s Gospel of John, live in prod                | Filed as **[#131](https://github.com/JesusFilm/jesusfilm-rag/issues/131)**. One document; deletion, no re-fetch      |

**Still open, none blocking:** the eval shortlist (#1), #128 timing (#2), the
`--probe` flag (#4), the `extractContent` root-cause fix (#5), the three-way
`zh` collision (#6), **robots.txt not being enforced anywhere in the acquire
path (#7 — now hand-patched five times)**, film-transcript pages (#8),
`normalizeUrl` scheme canonicalisation (#9), the CDATA defect (#10),
~~Oromo being undetectable (#11)~~ ✅ **closed 2026-07-31 by the sweep (§0.4)**,
**`everystudent-ar` carrying a full Gospel of John in PROD (#14)**, and
~~`ti` being actively MISLABELLED `am` (#16)~~ ✅ **closed 2026-07-31 — all 14
`ti` documents relabelled at confidence 0.99–1.00**.

#7, #9, #10 and #14 each deserve their own issue. ~~#11 and #16 are one ruling.~~
✅ **Both answered by the language sweep, no ruling needed** — the LLM detector
reads every language `tinyld` cannot. One NEW unfiled defect replaced them: the
detector's 200-token output cap can truncate a correct verdict into a silent null
(§11, last entry).

---

## 15. The 5 sitemap-less domains — recon and route (2026-07-29)

Answers open question #3. **All five were probed live**; nothing here is
inferred from the other 43.

### Verdict: hand-listed seeds. **Do NOT use Firecrawl.**

**Firecrawl solves a bot wall, not a missing sitemap.** They are different
problems and the campaign has conflated them before. ADR-0012 makes Firecrawl a
per-source opt-in for hosts whose _bytes_ are unreachable to plain HTTP; a
missing `sitemap.xml` is a _discovery_ problem, and discovery has a cheaper
answer these sites already provide — their own HTML map page.

Measured 2026-07-29: **4 of 5 are bare Apache serving HTTP 200** to a plain
request with a full Chrome UA. Not one returns a Cloudflare challenge or block
page. Spending Firecrawl credits here would buy nothing.

The pattern is already proven twice in this estate — `everystudent-ar`
(68 hand-listed seeds) and `everystudent-bg` (84). Both are seed-only: no
`sitemaps` field, and therefore no `block` array, because the seed list IS the
filter.

| Lang    | Domain             | Server     | HTML map           | Articles | Route        |
| ------- | ------------------ | ---------- | ------------------ | -------: | ------------ |
| `ru-ca` | studentstan.com    | Apache     | `/m/karta.html`    |       87 | seeds        |
| `uk`    | svitstudentiv.com  | Apache     | `/m/sitemap.html`  |       47 | seeds        |
| `hy`    | 1patasxan.com      | Apache     | `/m/sitemap.html`  |       37 | seeds        |
| `ti`    | everytemhari.com   | Apache     | `/sitemap.html`    |       14 | seeds        |
| `lv`    | katramstudentam.lv | Cloudflare | `/lv/lapas-karte/` |       49 | ⛔ see below |

~234 documents in total — roughly one normal batch.

### Per-host notes

- **`hy` `ru-ca` `uk` `ti`** — the standard FreeFind/Apache banner, same family
  as batch 1–2. `robots.txt` is 404 on `hy`, `ru-ca` and `uk` (no rules exist);
  200 on `ti`. Harvest the HTML map, then **verify every harvested URL with a
  HEAD sweep before seeding** — `sr` taught us that a map can list dead URLs,
  and `mn`/`cs` that a map can hold articles the XML never had.
- **`ru-ca` (studentstan.com)** is the largest at 87 and will collide with `ru`
  (mirstudentov.com) on the `ru` language label — the same ambiguity as `zh`
  (§13 #6). Record it; do not try to solve it here.
- **`ti` (everytemhari.com)** yields only ~14 articles. Cheap, but check whether
  it is worth a source key at all before writing the entry.

### ⛔ `lv` (katramstudentam.lv) — a RIGHTS blocker, not a technical one

Do not treat this as "the hard one to crawl". Technically it is easy: the
apex serves a **meta-refresh** to `/lv/` (which `curl -L` does not follow —
that is why it first looked empty/JS-rendered, and it is neither). Behind it is
ordinary server-rendered HTML, 43 internal links on the homepage and a
`/lv/lapas-karte/` map listing 49 article-shaped pages.

The blocker is what its `robots.txt` says. Fetched live 2026-07-29:

```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: ClaudeBot                       Disallow: /
User-agent: GPTBot                          Disallow: /
User-agent: CCBot                           Disallow: /
User-agent: Google-Extended                 Disallow: /
User-agent: CloudflareBrowserRenderingCrawler   Disallow: /
… (also Amazonbot, Applebot-Extended, Bytespider, meta-externalagent)
```

Three things follow, and they matter:

1. **`ClaudeBot` is disallowed by name.**
2. **`CloudflareBrowserRenderingCrawler` is disallowed by name** — that is
   precisely the class of headless renderer Firecrawl belongs to. Reaching for
   Firecrawl here would not be a neutral technical choice; it would be
   circumventing a preference the operator wrote down explicitly.
3. **`Content-Signal: ai-train=no, use=reference`.** There is a genuine reading
   under which _this_ corpus is permitted — we do retrieval with attribution,
   which is `reference`, not `ai-train`. That reading may well be right. **It is
   still not an agent's call to make**, and it does not override the explicit
   `ClaudeBot Disallow`.

**Recommendation:** do not crawl `lv`. The site is Agape Students Latvia — a Cru
partner — so the cheap, correct route is to **ask them for the content or for
permission**, not to out-engineer their robots file. If the answer is no, drop
`lv` from the 48 and record it `deferred` with the reason.

⚠️ Note this is the second host in this campaign whose robots policy we can only
honour by hand, because **the acquire path does not read `robots.txt` at all**
(§13 #7). `sq` needed a manual URL block for the same reason. That gap is now
load-bearing twice over.

---

## 16. `ru-ca` (studentstan.com) — a MIRROR, not a sibling (2026-07-30)

> ## ✅ RESOLVED 2026-07-30 — commit `185a090`
>
> Registered as `everystudent-ru-ca` with **5 seeds, not 87** (operator's call:
> option 2 below, the one that HONOURS ADR-0006). Acquired 5/5, zero skips, and
> **zero rows share an md5 with any `everystudent-ru` document**.
> `/a/jfil.html` — the 6th unique page — was excluded as JESUS-film promo copy
> (~400 ch of prose before the nav), the same class as `everystudent-ro`'s
> skipped `/v/filmuliisus.html`. One line to reverse.
> 🔴 **Do NOT "complete" that seed list from the site's own map.** Its test
> asserts `toHaveLength(5)` and names four of the ≥99% duplicates precisely to
> stop that.

**The batch-5 agent wrote nothing and escalated. That was correct.** This is
the campaign's second correct refusal, after `bg`.

### The measurement

12-word shingle overlap of **all 87** studentstan articles against the **full
99-article** `everystudent-ru` corpus (mirstudentov.com) — not a sample:

| Best-match band                  | Articles |
| -------------------------------- | -------: |
| **≥95% — effectively identical** |   **42** |
| 80–95%                           |       25 |
| 50–80%                           |       14 |
| 20–50%                           |        0 |
| **<20% — genuinely new**         |    **6** |

**Mean 84.1%.** Same-slug pairs alone: mean 89.3%, median 94.6%. Worked
examples: `/a/christianstvo.html` **99.8%**, `/a/dostoy.html` **99.7%**,
`/a/abdul.html` **99.4%**.

### Why the LOW scores are not evidence of independence

The agent hand-diffed the lowest same-slug pair, `/a/ad.html` at **52.7%**, and
found the bodies **word-for-word the same translation**. The score is depressed
only because mirstudentov prepends a section kicker and title, and uses
en-dashes where studentstan uses hyphens. **True content identity is HIGHER
than the numbers show.** Do not re-run this and conclude "only half overlap".

Two corroborating signals: **78 of 87 slugs are byte-identical filenames**, and
studentstan's own `/a/fol.html` reads «Я координатор проекта
**Mirstudentov.com**» — the sibling's signup page, not even re-branded.

### Calibration — the same test on genuinely independent hosts

| Pair                   | Overlap                       | Verdict                |
| ---------------------- | ----------------------------- | ---------------------- |
| `ru-ca` vs `ru`        | **84.1% mean**                | **MIRROR**             |
| `uk` vs `ru`           | 0.00–0.04%                    | independent, both kept |
| `ti` vs `am`           | 0.0% on all 5 same-slug pairs | independent, both kept |
| `hr` vs `sr` (batch 3) | 0.4–0.9%                      | independent, both kept |
| `cs` vs `sk` (batch 3) | 0.00%                         | independent, both kept |

The test discriminates cleanly. A mirror is not a close call.

### Why this matters mechanically

**The ingest dedup gate keys on `(sourceKey, canonicalUrl)`.** Two source keys
means two sets of rows, so ~81 near-duplicate Russian articles would be
chunked, embedded and left to compete with each other in retrieval. Nothing
downstream catches this. It is the same mechanism that let `ro` stage 25
byte-identical homepages (rule 1c), one level up.

### The 6 genuinely unique articles (~31,500 chars)

`/a/aborti.html` (4,679) · `/a/uznat.html` (6,650 — studentstan uses the Four
Spiritual Laws tract where mirstudentov uses «Знать Бога лично») ·
`/a/svetlana.html` (3,273) · `/a/mutniye.html` (12,675) · `/a/rashmor.html`
(3,700) · `/a/jfil.html` (488).

⚠️ Two are judgement calls: **`/a/jfil.html` is 488 chars of film-promo copy**,
and **`/a/mutniye.html` is Carl Wieland / Answers in Genesis material** — a
third-party copyright our `rights` line would misattribute, same shape as the
`et`/`bn`/`te`/`sl` Bible-society catches.

### The options, none of which an agent should pick

1. **Drop `ru-ca` from the 48.** Record `deferred`, reason "mirror of
   `everystudent-ru`". Campaign becomes 47 domains. Cleanest.
2. **Register a 6-seed `everystudent-ru-ca`.** Honours ADR-0006
   (one domain = one key) and keeps the estate complete, at the cost of a
   6-document source. Everything needed is already measured — one pass to write.
3. **Add the 6 paths to `everystudent-ru`'s `seedPaths`.** Cheapest in
   documents-per-effort, but **violates ADR-0006** by serving two domains from
   one key, and would store mirstudentov `canonical_url`s for pages that live
   on studentstan. Not recommended.

### Recon already done, if option 2 is chosen

Seed mode (`/sitemap.xml`, `/sitemap_index.xml`, `/sitemap.xml.gz`,
`/wp-sitemap.xml`, `/robots.txt` all **404** on the canonical `www` host; apex
301s to `www`). **No robots.txt at all**, so no rights blocker. `/m/karta.html`
lists 86 articles; the href sweep adds `/a/fol.html` and `/n/nedos.html`, the
latter a **404** (site-wide typo for `/m/nedos.html`, repeated on 10 pages).

**This host is NOT the FreeFind template** — it is a WordPress theme, and the
container is **`.post-content`** (86/87 pages, 488–25,282 chars, zero empties).
`.content4` matched **0 pages, 0 chars**; it does not exist here in class or ID
form. Ship `[".post-content", "html"]`. Strip `.sectionlink` — this host's CTA,
**7,591 chars across 85 pages**, and the legacy FreeFind strip list is 100%
dead here.

⚠️ **`/a/bibliya.html` is a broken-markup rescue case**: its wrappers are
absent, `#content` closes after 55 chars, and the `"html"` fallback recovers
**32,980 chars** of a genuine apologetics essay about the Bible. It is not
scripture (no chapter-and-verse run, no Bible-society copyright) and must not
be dropped for its markup — rule 1e.
