# Slice: GotQuestions — English (gotquestions)

_Branch: `slice/gotquestions` · Started: 2026-08-21 · Completed: 2026-08-24 · Status: done_

<!-- Status: in-progress | blocked | done | deferred -->

## Goal (architecture altitude)

Get the English teaching corpus on `www.gotquestions.org` queryable end-to-end:
acquire → ingest → retrieve → spot-check. This slice deliberately proves the
large English estate on its own. Translations on the same domain remain part of
the same `gotquestions` source and will follow as a separately resumable,
batched campaign recorded in
[`gotquestions-multilingual.md`](./gotquestions-multilingual.md).

## Recon and scope (2026-08-20–21)

- **Domain:** one source, `www.gotquestions.org`; all language sections share it.
- **English inventory:** the live sitemap contains **10,853 URLs**, including
  10,841 flat `.html` pages, 204 `content_*.html` topic indexes, and 30
  `questions_*.html` indexes. The prior jfa registry estimate (~1,500) is stale.
- **Bot-wall probe:** a real article returned HTTP 200 through plain HTTP with
  article markup and no Cloudflare block-page signature. Strategy: normal HTTP,
  not Firecrawl.
- **Robots/sitemap:** `robots.txt` advertises `/sitemapindex.xml`; the English
  URL set is available at `/sitemap.xml`.
- **Article shape:** flat `/<slug>.html`; real sample
  `/Christian-Platonism.html` exposes Question and Answer regions inside the
  main content wrapper. Index, utility, audio/XML, and navigation pages must be
  excluded by tested policy rather than assumed from the flat URL shape.
- **Language plan:** this slice declares only `en`. Language is still detected
  per document from extracted content during ingest; URL paths and `<html lang>`
  are not labels. Null-language documents are expected, excluded from eval
  credits, and reported as evidence.
- **Budget gate:** no live discovery crawl until the tested policy produces an
  exact kept-URL count and the operator approves `maxPages`, crawl time, and
  embedding spend.

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents

- [x] 1a — Register the English `gotquestions` source with a tested discovery
      and extraction policy that admits real answer articles and rejects topic
      indexes, utility pages, feeds, and non-content pages.
      **Evidence:** plain-HTTP live sample extracted 4,169 chars from the measured
      `itemprop="articleBody"` container with the correct title and no surrounding
      related/navigation furniture; 5 focused policy/extraction tests and the
      810-test full gate pass. <!-- sha: checkpoint commit -->
- [x] 1b — Dry-discover the live English inventory through that policy; classify
      kept/dropped shapes, sample adversarial edges, and present exact crawl and
      embedding budgets for operator approval.
      **Evidence:** 10,858 live sitemap URLs → **10,565 kept / 293 dropped**.
      The 293 drops cover 205 `content*` indexes, 30 `questions_*` indexes,
      feeds/XML, top lists, and measured utility/application pages. A
      deterministic 20-page spread across the kept set returned 20/20 HTTP 200
      answer bodies (2,332–9,946 chars in the reported sample); adversarial
      utility pages lacked `articleBody` and were explicitly blocked because
      their chrome/form text can clear the length floor. Proposed safety cap:
      **11,000 pages**. At 1,500 ms politeness delay the fetch floor is **4.4
      hours** plus network time. Sampled bodies imply roughly 10–15M embedding
      input tokens including chunk overlap: about **$0.10–$0.21** at the current
      qwen3 embedding list/effective provider range. <!-- sha: checkpoint commit -->
- [x] 1c — Run the approved live crawl and verify `raw_documents` counts,
      uniqueness, status distribution, and clean Question/Answer article text.
      **Evidence:** the interrupted crawl resumed from 4,032 staged URLs and
      skipped them exactly, then staged 6,530 of the remaining 6,533 candidates;
      3 were honestly rejected as too thin. Final staging is **10,562 rows / 10,562
      distinct canonical URLs**, all pending, all HTTP 200, and all titled.
      Extracted answer bodies range 719–39,802 chars (average 3,871); targeted and
      random samples begin with the article's `Answer` content and exclude
      navigation/related-page furniture. <!-- sha: checkpoint commit -->
- [x] 1d — Close Acquire: record evidence, set English acquire green through the
      status tool, update source/status docs, and run the full verify gate.
      **Evidence:** English acquire is green in the asserted status tracker and
      the post-crawl full gate passes with 810 tests. <!-- sha: checkpoint commit -->

### 2. Ingest → corpus tables

- [x] 2a — Ingest all pending English raws and verify document/chunk/embedding
      parity, sane chunk distribution, and the recorded embedding model.
      **Evidence:** the corpus already held the completed drain when this session
      resumed: **10,562 documents / 29,634 chunks / 29,634 embeddings**, with
      zero `chunk_count` mismatches, 1–29 chunks per document (average 2.81),
      and one model, `qwen/qwen3-embedding-8b`. <!-- sha: checkpoint commit -->
- [x] 2b — Re-run ingest to prove idempotency; report detected-language and null
      counts plus the exact null-language paths as evidence.
      **Evidence:** a repeat `pnpm index --source gotquestions` drained **0**
      pending rows. Per-document detection recorded **9,796 `en` / 763 `null`
      / 3 false-positive outliers** (`fr`, `ber`, `de`); spot-reading confirms
      all three outliers are English articles, so this is isolated detector
      noise rather than systematically low confidence. The settled null policy
      applies: the 763 rows remain retrievable and dashboard-visible but are
      excluded from language-scoped eval credits. Exact inventory:
      [`gotquestions-null-language-paths.md`](../slice-evidence/gotquestions-null-language-paths.md).
      <!-- sha: checkpoint commit -->
- [x] 2c — Close Ingest with the full verify gate and English status update.
      **Evidence:** English ingest is green in the asserted status tracker; the
      architecture-level trackers carry the measured corpus and language
      evidence, and the closing full gate passes with 810 tests.
      <!-- sha: checkpoint commit -->

### 3. Retrieve → ranked results

- [x] 3a — Run representative seeker, skeptic, believer, and newcomer queries;
      verify ranked, cited GotQuestions hits and cross-source health.
      **Evidence:** GotQuestions ranked first for all four representative
      perspectives: guilt/forgiveness (`guilt-dealing.html`, 0.738), resurrection
      evidence (`did-Jesus-rise-from-the-dead.html`, 0.783), the Trinity without
      tritheism (`Trinity-Bible.html`, 0.728), and first-time Bible reading
      (`start-reading-Bible.html`, 0.815). Every result carried its real title and
      canonical URL. Cross-source health remains visible in the same top fives:
      thelife, Sightline, Cru, Jesus Film, and Starting With God all retain
      relevant placements; the established heaven-assurance query still returns
      Starting With God at rank 3 (0.705). <!-- sha: checkpoint commit -->
- [x] 3b — Verify `language:en`, source scoping, deduplication, and cutoff
      behavior; re-check the living-eval displacement signal before diagnosing
      any metric movement.
      **Evidence:** a GotQuestions-scoped unanswered-prayer query returned 10/10
      GotQuestions hits with 10 distinct canonical URLs, led by the exact article
      at 0.800; an `en`-scoped evidence-for-God query returned only English rows
      and retained cross-source results. The filter is a strict document-language
      equality in the store, with live integration coverage for excluding other
      languages and nulls. A clean faucet-repair negative returned zero at the
      default 0.37 cutoff; its unrestricted ceiling was 0.341, so the established
      noise floor still holds. The 416-case living eval retained recall@10 1.000
      but moved from the pre-source baseline (coverage 0.887 · recall@3 0.966 ·
      MRR 0.872 · P@1 0.781) to 0.867 · 0.954 · 0.841 · 0.733. The movement is
      concentrated in the 78 English cases (coverage 0.528); their top hits now
      visibly include uncredited, directly relevant GotQuestions documents such
      as `start-reading-Bible.html`, `lack-of-faith.html`, and
      `Christianity-beliefs.html`. This is the expected stale-relevant-set signal
      for Stage 4, not evidence for changing ranking or the cutoff. The batch
      retry posture recovered four transient embedding timeouts. <!-- sha: checkpoint commit -->
- [x] 3c — Close Retrieve with the full verify gate and English status update.
      **Evidence:** English retrieval is green in the asserted tracker; the
      architecture-level trackers carry the ranked-query, scope, cutoff, and
      pre-curation eval evidence; the closing full gate passes with 810 tests.
      <!-- sha: checkpoint commit -->

### 4. Spot-check and evaluate

- [x] 4a — Invoke `$golden gotquestions` for corpus-grounded re-review and new
      persona-diverse English cases; stop at its operator write-approval gate.
      **Evidence:** the 416-case pre-curation baseline identified eight stale
      English cases; the operator approved eight focused living-set additions
      plus nine new cases spanning seeker, skeptic, believer, and newcomer.
      Null-language documents were excluded from the curation pool. <!-- sha: checkpoint commit -->
- [x] 4b — Apply only approved golden changes, verify every credited path
      resolves exactly once, and run the batch eval with the offline retry
      posture. **Evidence:** all **1,489** unique credited `(source, path)` pairs
      resolve exactly once. At 425 cases, recall@3 **0.960**, recall@10 **0.998**,
      coverage **0.869**, MRR **0.844**, and P@1 **0.736**; GotQuestions-specific
      coverage is **0.941** across 17 cases. Eight of nine new cases hit in the
      top 10. The spiritual-warfare case is an honest vocabulary/ranking miss.
      Three transient query-embedding timeouts recovered under the batch retry
      posture. <!-- sha: checkpoint commit -->
- [x] 4c — Record representative results and negatives, run the full verify
      gate, mark English done, and hand off the normal non-walled production
      promotion path after merge. **Evidence:** four secular negatives—faucet
      repair, New Zealand GST filing, a TypeScript race condition, and sourdough
      hydration—each returned zero GotQuestions hits at the 0.37 cutoff. English
      is `done` with all four asserted stages green. <!-- sha: checkpoint commit -->

## Decisions made (this slice)

- 2026-08-20 — Use source key `gotquestions` for the whole domain — one domain
  remains one source even when later language sections are added.
- 2026-08-21 — Prove the full English estate as a standalone slice — it is the
  largest section and establishes extraction/discovery before bulk translation
  work.
- 2026-08-21 — Handle remaining languages as one automated, resumable campaign
  with canary and count-based batches — not 215 slices or operator sessions.
- 2026-08-21 — Land campaign work as small merged checkpoint PRs — each PR
  updates the durable campaign file so the next session starts from `main`.

## Open question / blocker

- none

## Resume hint (for a cold start)

Done: English is queryable and evaluated end-to-end. Next: run the final full
verify gate, checkpoint the completed slice, then merge before following the
normal non-walled production promotion path. Branch: `slice/gotquestions`.

## Icelandic standalone exception — 2026-09-08

The operator explicitly pulled `is` forward from the deferred multilingual
campaign. English above remains complete; all other languages stay deferred.
This section is the Icelandic resume contract under the existing source key.
**Current state: all four local stages complete.** The six-case canonical append,
431-case rerun, limitations, and final lifecycle closure are recorded below.
Roadmap: `docs/roadmap/rag/feat-466-gotquestions-icelandic-slice.md`.

### Migration acceptance context

The operator confirmed on 2026-09-08 that this work contributes to
[jfrag #168: prove one small source end to end, soak, and archive jfrag](https://github.com/JesusFilm/jesusfilm-rag/issues/168),
tracked in Forge by `docs/roadmap/rag/feat-435-rag-proof-soak-archive.md`.
`feat-466` is the bounded local Icelandic slice within that broader outcome.

The local evidence below proves acquisition through indexing, reconciled
counts/model, unchanged pre-existing corpus, three retrieval checks, and the
approved canonical evaluation below. Closing
this slice's lifecycle record does not close #168 or `feat-435`. The migration
acceptance still needs its own evidence for dimensions, dashboard and golden
evaluation, production soak and repeated eval/smoke checks, public/private
consumer inventory, rollback exercise and expiry, retained final jfrag snapshot,
default operational aliases, and approved service/secrets/repository retirement.
The three-query proportional evaluation is not the ticket's golden-eval proof.
The local run also used an embedding credential from the legacy checkout;
exclusive Forge operational ownership is not established by this run alone.

Issue #168 requires its preceding migration/cutover work to be complete before
the final confidence step. Verify those receipts and the `feat-435` production
current acceptance and production-authority boundaries when resuming the broader
ticket. This linkage grants no production or retirement approval. The operator
separately approved the local canonical append and final lifecycle closure.

### Scope and plan

- Acquire only `/islenska/` from
  `https://www.gotquestions.org/islenska/icelandic.xml` with plain HTTP.
- Use the opt-in registered `--path-prefix /islenska/` policy, `main .content`,
  1,500 ms delay, 51-page cap, and an exact 51-article gate before resume or cap.
  The default English sitemap and `articleBody` extraction remain unchanged.
- Index only canonical URLs under `https://www.gotquestions.org/islenska/`,
  filtering before `--limit`; detected content language remains authoritative.
- Pin the nine existing `gq-*` golden cases to `language: en`.
- Evaluate proportionately through three queries, each with
  `--source gotquestions --language is`: “Hver er Jesús Kristur?”,
  “Hvernig get ég fengið fyrirgefningu Guðs?”, and “Er líf eftir dauðann?”.
  This initial plan was subsequently expanded by the operator to include six
  reviewed Icelandic golden cases and a full canonical evaluation.
- Obtain fresh approval separately for `status:add-lang gotquestions/is`,
  local `acquire source gotquestions`, local `index source gotquestions`, and
  the evidence-backed `status:set gotquestions/is` mutation.

### Icelandic checklist

- [x] Read English resume state; prepare path scoping and English eval pins.
- [x] Public read-only inventory: **52 seen / 51 unique articles / 1 landing
      page excluded**, one sitemap. Samples at positions 1, 26, and 51 returned
      HTTP 200, 2,926 / 1,792 / 3,840 extracted characters, each detected `is`
      at confidence 1.0. No corpus text retained in evidence.
- [x] Validate the local environment and capture existing English/corpus counts:
      10,562 documents / 29,634 chunks / 29,634 embeddings; 10,562 raws and no
      Icelandic pending raws. Detected labels match the historical English
      record (9,796 `en`, 763 null, one each `ber`/`de`/`fr`).
- [x] Acquisition preview: 51 resolved, zero already staged, zero written.
      Read-only model-aware index preview: zero Icelandic candidates. Local
      environment, 88 focused tests, typecheck, lint, dependency checks, golden
      schema and nine English pins pass. See
      [redacted preflight evidence](../slice-evidence/gotquestions-is-preflight.json).
- [x] Operator approved `status:add-lang gotquestions/is` on 2026-09-08;
      added the scoped language with all four stages pending and declared `is`
      alongside `en`. English remains done/all-green; source rollup is now
      in-progress. `status:check` and 44 affected tests pass.
- [x] Operator approved local `acquire source gotquestions`; acquired **51/51**
      articles with zero skips. Staging has 51 unique canonical URLs, all pending,
      HTTP 200 and titled; zero landing pages. Extracted bodies range from
      1,427 to 8,697 characters and normalize to **51 `is` / 0 null / 0 other**.
      The pre-existing 10,562-document corpus digest is unchanged. See
      [acquisition evidence](../slice-evidence/gotquestions-is-acquisition.json).
- [x] Index preview resolves exactly 51 Icelandic pending rows with model
      `qwen/qwen3-embedding-8b`; no writes. Chunking projects 142 chunks and
      roughly 54,412 input tokens using the existing character/4 estimator
      (actual Icelandic tokenizer usage may differ).
- [x] Operator approved local `index source gotquestions` on 2026-09-08;
      indexed **51 documents / 142 chunks / 142 embeddings**, all detected `is`,
      with zero skips, updates, pending raws, or chunk-count mismatches. The
      read-only repeat preview finds zero candidates. Fresh before/after
      fingerprints prove all 24,518 pre-existing documents and their 77,060
      chunks/embeddings unchanged, including the 10,562 English GotQuestions
      documents and 29,634 chunks/embeddings. The historical SHA-256 recipe was
      not recorded, so this run uses an explicitly documented fresh fingerprint
      comparison. See [indexing evidence](../slice-evidence/gotquestions-is-indexing.json).
- [x] Run and assess the three Icelandic queries. The directly matching article
      ranks first for Jesus' identity (`hver-Jesus-Kristur.html`, **0.685**),
      God's forgiveness (`thiggja-fyrirgefningu-Guds.html`, **0.688**), and life
      after death (`lif-eftir-daudann.html`, **0.626**). All 15 returned citations
      resolve exactly once and belong to `gotquestions` with detected language
      `is`; each query has five distinct URLs. The third query initially exited
      without results and passed on one standalone retry; its initial cause was
      not retained. This is the planned three-query proportional evaluation,
      not a full golden campaign. See
      [retrieval evidence](../slice-evidence/gotquestions-is-retrieval.json).
- Fresh retrieval recheck on 2026-09-08 at 03:55 UTC: the operator requested
  retrieval verification before lifecycle closure. All three query commands
  passed on their first attempt against the local database with read-only
  sessions and explicit `--source gotquestions --language is --top-k 5`.
  Expected articles again ranked first: Jesus' identity **0.687**, forgiveness
  **0.689**, and life after death **0.626**. All 15 citations resolved exactly
  once to `gotquestions` / `is`, with five distinct URLs per query. The local
  inventory still contains 51 Icelandic documents. Only the embedding key was
  loaded in memory from the legacy checkout; no corpus text or secrets were
  retained. See [fresh retrieval evidence](../slice-evidence/gotquestions-is-retrieval-recheck.json).
  Lifecycle closure was subsequently approved and executed below.
- [x] Operator approved `status:set` for exact target `gotquestions/is` on
      2026-09-08 after the fresh retrieval recheck. The command below executed
      successfully, setting all four stages green and Icelandic done;
      `status:check` passed. English remains done/all-green, and the derived
      source rollup is done. Completion is recorded here, in the campaign
      ledger, and in roadmap ticket `feat-466`. Approval is consumed.

### Icelandic resume hint

Acquisition, indexing, and retrieval are complete locally: 51 Icelandic documents
and 142 chunks and embeddings, with a fresh three-query retrieval recheck.
Dedicated evaluation was reopened and then completed with the approved six-case
canonical append and full 431-case run on 2026-09-08; see the final closure below.
No local acquisition, indexing, retrieval, or evaluation stage remains. English
remains complete, and the broader multilingual campaign remains deferred.

Executed once with fresh operator approval on 2026-09-08 (approval consumed):

```sh
pnpm --filter @forge/rag status:set -- --source gotquestions --lang is --stage acquire=green --stage ingest=green --stage retrieve=green --stage evaluate=green --status done
```

The post-mutation `status:check` passed. Resume the broader migration acceptance
separately through `feat-435`; its production, golden-eval, soak, and retirement
requirements remain open as described above. Local completion does not authorize
production work or a multilingual campaign. Add the Forge PR link to `feat-466`
before merge; the operator subsequently explicitly requested the PR closeout.

Durable resume lesson: lifecycle flags assert recorded evidence; `status:set`
does not execute retrieval. When fresh retrieval is requested, run the queries
and record their timestamp separately before the approved lifecycle closure.

Local target remains the `apps/rag/docker-compose.yml` database on port 5435.
Only the embedding key was read into memory from the sibling
`/Users/jacobusbrink/Jaxs/projects/jesusfilm-rag/.env` and injected into the local
index/query processes; no legacy database configuration or secrets were copied.

### Dedicated evaluation addendum — 2026-09-08

The operator clarified that evaluation must follow retrieval as a separate stage.
The earlier closure used the three-query check as proportional evaluation; it
was not a run of the golden evaluation runner. Approval to start dedicated eval
reopened `gotquestions/is` with `evaluate=pending` and `status=in-progress` via
`status:set`. Acquisition, ingest, and retrieval stay green.

- [x] Inspect the evaluation contract and existing cases: the current canonical
      suite contains 425 cases and zero Icelandic cases. Local `status:check`,
      dependency checks, and 48 focused evaluation tests pass.
- [x] Run the current 425-case local evaluation and preserve a redacted receipt.
      Recall@3 **0.922**, recall@10 **0.991**, coverage **0.816**, MRR **0.793**,
      P@1 **0.666**. The 17 cases crediting GotQuestions have source recall and
      coverage **0.824**; this suite has no Icelandic cases. Four cases miss all
      credited documents in the top 10; all nine expected documents resolve
      uniquely and are language-eligible. No matched control exists for this
      run, so these are descriptive metrics, not a regression-gate pass. See
      [existing-suite evidence](../slice-evidence/gotquestions-evaluation-current.json).
- [x] Bootstrap six persona-diverse Icelandic candidate cases from all 51 whole
      extracted documents, independently reviewed through three lenses. Fan-out:
      51 documents × 3 lenses = 153 document reviews, covering 918 case/document
      judgments. Use mean relevance at least 0.75 and escalate disagreement
      greater than 0.5. This single-source language uses relevance for credits
      and reports soundness separately. The panel proposed 17 credits and
      escalated 22 disputed pairs, initially excluded provisionally. Those pairs
      were subsequently resolved by delegated precedent review below. All
      question-translation checks passed. Separate contexts
      on one model are not independent human corroboration. Oversized reviewer
      outputs were discarded and remaining work split into smaller requests;
      completed reviews were reused without changing their scores.
- [x] Validate every proposed credit against the local corpus; run the unchanged
      evaluation runner against an isolated candidate golden file, using
      language-scoped whole-corpus retrieval at top 10 and cutoff 0.37. Check
      three off-topic Icelandic negatives separately. All 17 credits resolve
      exactly once. Six draft cases achieved recall@3 and recall@10 **1.000**,
      coverage **0.925**, MRR **0.889**, and P@1 **0.833**. This coverage is
      provisional until disputed exclusions are reviewed. Two negatives return
      zero hits; the programming negative returns one hit, reproduced on both
      repeat checks. Do not call the negative check clean or change the cutoff
      to make it pass. Before/after fingerprints show the corpus unchanged.
      See [candidate metrics](../slice-evidence/gotquestions-is-evaluation-candidates.json).
- [x] Resolve the 22 disputed pairs under the operator's explicit instruction to
      use decisions from prior sources. Cru's whole-document review,
      EveryStudent's gospel-tail exclusions, and the Arabic audience/next-step
      distinction yield **9 additions / 13 exclusions**, for **26 relevant pairs
      across 21 documents**. A supplemental full-document review supports each
      decision; the agent rejected one recommendation that relied on a generic
      gospel tail. No retrieval results or original scores were supplied to that
      review. Original scores were preserved, not rewritten to pass the gate.
      Total pair judgments: 918 initial + 22 supplemental = **940**.
      [All decisions and precedents](../slice-evidence/gotquestions-is-relevance-adjudication.md).
- [x] Rerun the six-case draft against the adjudicated keys: recall@3 and
      recall@10 **1.000**, coverage **0.769**, MRR **0.889**, P@1 **0.833**.
      All credits resolve once; corpus fingerprints are unchanged. The expanded
      keys expose additional missing relevant documents. Questions, model,
      language, top-k, and cutoff are unchanged. The prior negative evidence is
      retained, not rerun or reclassified. See
      [adjudicated evaluation](../slice-evidence/gotquestions-is-evaluation-adjudicated.json).
- [x] The operator approved steps 1–4 and a PR on 2026-09-08. Append exactly
      the six reviewed cases and their English explanations to canonical
      `eval/qa-golden.yaml`: **431 total cases / 26 Icelandic relevant pairs**.
      The append preserved the preceding 425 cases; the nine English language
      pins are the earlier necessary multilingual-registry change. The retained
      first 416 cases are unchanged. The candidate file is now a review snapshot.
- [x] Rerun all 431 canonical cases with the standard runner, language-scoped
      whole-corpus retrieval, top-k 10, and score floor 0.37. Completed
      **2026-09-08 09:35 UTC**, run `5742fb83-54a7-4ef4-9ccd-b41d59d4b2a8`:
      recall@3 **0.921**, recall@10 **0.991**, coverage **0.815**, MRR **0.795**,
      P@1 **0.671**. All six Icelandic cases find a relevant document within the
      top three: recall@3/@10 **1.000**, coverage **0.769**, MRR **0.917**,
      P@1 **0.833**. All corpus fingerprints remain unchanged. The same four
      global misses remain; this is not evidence of a new migration regression.
      See [canonical receipt](../slice-evidence/gotquestions-is-evaluation-canonical.json).
- [x] Record explicit limitations. The programming negative is a confirmed local
      false positive, reproduced twice; the other two negative probes returned
      zero hits. Retain the unchanged cutoff and track investigation in
      `docs/roadmap/rag/feat-467-gotquestions-icelandic-negative-retrieval.md`.
      Partial relevant-set coverage remains visible; do not remove legitimate
      credits to improve metrics. Six LLM-translated questions and contexts on
      one review model do not constitute independent human validation.
- [x] Record comparison as **not run: no identity-matched control**. The retained
      comparator accepts only the historical 416-case control; neither the new
      431-case suite nor the six-case bootstrap has a matching retained control.
      This completes local bootstrap evaluation with descriptive evidence, not a
      regression-gate pass. Broader baseline and migration acceptance remain in
      `feat-463` and `feat-435`; their status is unchanged by this slice.
- [x] Execute the operator-approved final lifecycle update once, after canonical
      evaluation and the dispositions above. `gotquestions/is` is done with all
      four stages green; English remains done and the source rollup is done.
      Re-run `status:check` successfully and close `feat-466`.

### Final closure — 2026-09-08

The operator's instruction to proceed with steps 1–4 authorized the reviewed
canonical append and final `gotquestions/is` lifecycle update. These operations
executed once and their approval is consumed:

```sh
pnpm --filter @forge/rag status:set -- --source gotquestions --lang is --stage evaluate=green --status done
pnpm --filter @forge/rag status:check
```

All local stages in this slice are complete. The known false positive is deferred
to `feat-467`; unavailable historical comparison is explicitly unclaimed. Resume
other translations through the deferred campaign ledger or migration acceptance
through `feat-435`, each within its own scope.

PR verification: 816 unit/CLI/contract tests, 23 real PostgreSQL integration
checks in a separate test database, typecheck, lint, dependency boundaries,
schema validation/drift, repeat migration deployment, environment/status checks,
dashboard verification, and repository-wide formatting passed. Review added a
real-database assertion that normal and model-aware forced reads apply literal
path boundaries before limits. The lock test now waits for its first callback
instead of assuming the filesystem starts within 10 ms.

Durable correction: retrieval smoke, draft evaluation, approved golden evaluation,
and a matched-control regression pass are different receipts. Never infer one
from another or close `evaluate` merely because several retrieval queries worked.
