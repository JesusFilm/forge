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
