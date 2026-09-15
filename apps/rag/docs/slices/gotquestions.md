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

**Current state: all four local stages complete.** This is the Icelandic resume
contract under the existing `gotquestions` source key. English remains complete;
all other translations remain in the deferred [campaign](./gotquestions-multilingual.md).
Roadmap: `docs/roadmap/rag/feat-466-gotquestions-icelandic-slice.md`.
[Forge PR #2202](https://github.com/JesusFilm/forge/pull/2202).

### Scope and completed operations

The operator pulled Icelandic forward as a standalone exception. The approved
local operations used `--source gotquestions --path-prefix /islenska/` for
acquisition and indexing. Source registration declares `en` and `is`; detected
content language remains authoritative. Each canonical acquisition, indexing,
golden, and lifecycle write was explicitly approved in the session.

- [x] Register and preview the one-sitemap slice: `/islenska/icelandic.xml`,
      plain HTTP, `main .content` extraction, 1,500 ms request delay, a 51-page
      cap, and an exact 51-article inventory check before resume or truncation.
      Exclude the landing page. The default English crawl remains unchanged.
- [x] Acquire 51 articles, all HTTP 200, titled, and distinct; zero skips or
      landing pages. Extracted lengths range from 1,427 to 8,697 characters;
      all 51 normalize to Icelandic. Pre-existing GotQuestions corpus unchanged.
- [x] Index 51 documents into **142 chunks / 142 embeddings**, all `is`, using
      `qwen/qwen3-embedding-8b`. Zero updates, skips, pending raws, or parity
      mismatches. A repeat preview selects zero candidates. Canonical path
      filtering occurs before normal and model-aware forced batch limits;
      ingest rejects out-of-scope rows before writes.
- [x] Verify fresh before/after fingerprints for all 24,518 pre-existing
      documents and 77,060 chunks/embeddings, including 10,562 English
      GotQuestions documents and 29,634 chunks/embeddings. All were unchanged.
      The historical fingerprint recipe was unavailable; this is a fresh local
      before/after comparison, not a historical or production identity claim.
- [x] Run three retrieval checks for Jesus' identity, forgiveness, and life after
      death with `--source gotquestions --language is --top-k 5`. The expected
      article ranks first for each. Recheck at **2026-09-08 03:55 UTC** passed on
      each first attempt; all 15 citations resolve once to this source/language,
      with five distinct URLs per query. The initial afterlife command had
      required one retry; its cause was not retained.

All database operations targeted the local Docker database. Only the embedding
credential was loaded in memory from the legacy checkout; no legacy database
configuration was used. This local proof does not establish exclusive Forge
credential ownership or close `feat-435` migration acceptance.

### Dedicated evaluation and final closure

The first lifecycle closure incorrectly treated retrieval smoke as proportional
evaluation. The operator clarified the requirement for a separate evaluation
stage; `evaluate` was reopened through `status:set`, and the actual golden
runner was then executed. Final closure below supersedes that premature closure.

- [x] Run the existing 425-case local suite: recall@3 **0.922**, recall@10
      **0.991**, coverage **0.816**, MRR **0.793**, P@1 **0.666**. It contained
      zero Icelandic cases. All nine expected documents for its four complete
      misses resolved uniquely and were language-eligible.
- [x] Draft six persona-diverse Icelandic cases from all 51 whole documents.
      Three separate contexts on `google/gemini-2.5-flash-lite` produced 153
      document reviews and 918 case/document judgments. The initial 17 credits
      achieved recall@10 **1.000** and coverage **0.925**; 22 disputed pairs
      were excluded provisionally. Translation checks raised no flags.
- [x] Resolve the 22 disagreements using the precedents below: **9 additions /
      13 exclusions**, yielding **26 relevant pairs across 21 documents**.
      An additional whole-document judgment for each disagreement brings the
      total to 940. Retrieval results and initial scores were withheld from
      that review; one proposed inclusion relying on a generic gospel ending
      was rejected. Original scores were not rewritten. All credits resolve once.
- [x] Rerun the adjudicated draft: recall@3/@10 **1.000**, coverage **0.769**,
      MRR **0.889**, P@1 **0.833**. Expanded relevant sets expose missed documents.
- [x] Append exactly the six approved cases to `eval/qa-golden.yaml` on
      2026-09-08, producing **431 cases**. The append preserved the preceding
      425 cases; nine English language pins were the earlier multilingual
      registry change. The historical first 416 cases are unchanged.
      Questions, English explanations, credited paths, and exclusion reasons
      remain in [the canonical golden file](../../eval/qa-golden.yaml) and its
      [approved review snapshot](../../eval/candidates-gotquestions-is.yaml).
- [x] Run all 431 canonical cases, completed **2026-09-08 09:35 UTC**. Global
      recall@3 **0.921**, recall@10 **0.991**, coverage **0.815**, MRR **0.795**,
      P@1 **0.671**. The six Icelandic cases have recall@3/@10 **1.000**,
      coverage **0.769**, MRR **0.917**, P@1 **0.833**. Corpus fingerprints are
      unchanged. The 23 cases crediting GotQuestions have source recall **0.870**
      and coverage **0.809**.

| Icelandic case suffix (`gq-is-`) | First relevant rank | Relevant returned / total |
| -------------------------------- | ------------------: | ------------------------: |
| `seeker-forgiveness`             |                   1 |                    7 / 10 |
| `skeptic-jesus-divinity`         |                   1 |                     6 / 6 |
| `skeptic-bible-trust`            |                   1 |                     1 / 1 |
| `believer-recurring-sin`         |                   2 |                     1 / 2 |
| `newcomer-next-steps`            |                   1 |                     2 / 3 |
| `seeker-purpose`                 |                   1 |                     3 / 4 |

The same four global misses remain: `cru-seeker-ethnic-identity`,
`esru-newcomer-krest`, `essq-newcomer-tre-veta`, and
`gq-believer-spiritual-warfare`. Their persistence does not establish a new
migration regression.

#### Limits and dispositions

- Two off-topic Icelandic probes (faucet repair and sourdough) returned zero
  hits. The programming probe returned **one off-topic hit**, reproduced on
  both repeats. These negatives were not rerun with the canonical suite.
  Retain the unchanged 0.37 cutoff and investigate in
  `docs/roadmap/rag/feat-467-gotquestions-icelandic-negative-retrieval.md`.
- Relevant-set coverage is partial; retain all 26 reviewed credits. Six
  LLM-translated questions and multiple contexts on one model do not constitute
  independent human or native-speaker validation. Relevance determined credits;
  soundness was reported separately, with no credited document below the
  initial panel's mean 0.75 soundness threshold.
- **Comparison: not run — no identity-matched control.** The retained comparator
  accepts only the historical 416-case control. Neither the 431-case suite nor
  the six-case bootstrap has a matching retained control. These descriptive
  local results do not claim a regression-gate pass. Broader baseline concerns
  remain in `feat-463`; migration, production, soak, and retirement acceptance
  remain in `feat-435`.

#### Run provenance

The standard `scripts/eval.ts` runner used language-scoped whole-corpus retrieval,
top-k 10, cutoff 0.37, model `qwen/qwen3-embedding-8b`, and no query instruction.
Queries ran with concurrency 8, a maximum of 8 attempts, and 25-second timeouts.
Canonical run ID: `5742fb83-54a7-4ef4-9ccd-b41d59d4b2a8`.

- `goldenRevision`: `sha256:fbd5bceff4436b00b1079c38ae3f9f860582b9ea21456828cc4dc2372460065b`.
- `caseSetRevision`: `sha256:e71e9c14aba974886e3b2f08459a11c054e6c372f438bf2acd61dffebb30c724`.
- `registryRevision`: `sha256:500a0b3b06ad89ff8646d765fd87b1fa4e2f5140ae5849da371bca9ee7712360`.
- `corpusRevision`: `local-md5:4073f4954401aaae0038dd4619f0e726`.
- `metricImplementation`: `jesusfilm-rag/eval-metrics@2026-08-06+forge-identity-v1`.

Detailed attempts stay untracked under `eval/attempts/`, following
[the evaluation procedure](../ops/evaluation.md). On 2026-09-09 the operator
requested removal of this PR's 11 separate evidence documents. Their necessary
results and decisions are consolidated here; the pre-existing English language
audit remains unchanged. No evaluation, golden key, or lifecycle result changed
as part of this documentation cleanup.

#### Final lifecycle update

After the canonical run and disposition of limitations, the operator approved
steps 1–4 and a PR. The final update executed once on 2026-09-08:

```sh
pnpm --filter @forge/rag status:set -- --source gotquestions --lang is --stage evaluate=green --status done
pnpm --filter @forge/rag status:check
```

`status:check` passed. Icelandic and English are done with all four stages green;
the derived source rollup is done. No local slice stage remains.

Implementation verification at closeout: 816 unit/CLI/contract tests and 23 real
PostgreSQL integration checks in a separate test database; typecheck, lint,
dependency boundaries, schema/drift, repeat migration deployment,
environment/status/dashboard checks, and repository-wide formatting passed.

### Relevance decisions

#### Precedents applied

- **P1 — substantive whole-document answers.** [Cru Stage 4](./cru.md) rejected sound-but-off-question material and reinstated 13 credits on review. [The eval approach](../eval-approach.md) requires judging the whole document, including answers buried after an introduction. Shared themes or assertions do not answer a request for reasons.
- **P2 — reject generic gospel endings.** [EveryStudent multilingual campaign §0.9](./everystudent-siblings.md) rejected otherwise off-topic articles whose closing invitation happened to match a query. An article that develops forgiveness or salvation in its body can still qualify.
- **P3 — match the requested stage and action.** [EveryStudent Arabic Stage 4](./everystudent-ar.md) rejected pre-conversion material for a believer’s next-step question. Conversion, assurance, and practical discipleship are distinct needs.
- **P4 — separate relevance from soundness.** [EveryStudent Arabic’s single-source decision](./everystudent-ar.md) uses relevance for credits, reporting soundness separately. Icelandic has the same single-source condition.
- **P5 — retain honest buried answers.** [EveryStudent multilingual campaign §0.9](./everystudent-siblings.md) retained relevant material even when coverage fell because the engine missed it. Retrieval results did not decide these keys.

#### Decisions

Whole extracted documents were reviewed in independent contexts without retrieval results or initial panel scores. The agent then applied the precedents to the 22 recommendations, rejecting one proposed inclusion that relied on a short gospel invitation. These decisions use machine-assisted Icelandic reading and English paraphrases; they do not claim native-speaker or human theological verification.

##### gq-is-seeker-forgiveness

I am ashamed of what I have done. How can I receive God's forgiveness and start again?

| Decision    | Document                                      | Reason                                                                                                                                                                     | Precedent |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/vegur-Romverjans-hjalpraedis.html` | The Romans Road develops the need for forgiveness, faith in Christ, repentance, and freedom from condemnation; forgiveness is its substance, not an appended invitation.   | P1, P2    |
| **exclude** | `/islenska/lif-eftir-daudann.html`            | The article explains the afterlife; the closing invitation does not turn it into an answer about receiving forgiveness for past actions.                                   | P2        |
| **include** | `/islenska/ekki-fremja-sjalfsmord.html`       | A substantive body section addresses grave past wrongdoing, repentance, forgiveness, and becoming new; its suicide-prevention framing does not erase that direct answer.   | P1        |
| **exclude** | `/islenska/gerist-eftir-daudann.html`         | It explains post-death destinations and judgment, without explaining how to receive forgiveness and begin again now.                                                       | P1        |
| **include** | `/islenska/eilift-lif.html`                   | The body develops sin, Christ’s sacrifice, repentance, and faith as the means of forgiveness; this is more than its concluding prayer.                                     | P1, P2    |
| **include** | `/islenska/hjalprad.html`                     | The salvation explanation connects separation caused by sin to forgiveness and restored relationship through Christ; that developed answer meets the question.             | P1, P2    |
| **exclude** | `/islenska/rett-tru-fyrir-mig.html`           | The article argues for choosing Christianity; its brief forgiveness offer and closing prayer are the gospel-tail pattern previously rejected in the multilingual campaign. | P2        |
| **include** | `/islenska/hvao-naest.html`                   | Its substantial opening explanation of salvation and assurance explains how forgiveness is received, even though later sections address new believers.                     | P1        |

##### gq-is-skeptic-jesus-divinity

Was Jesus just a good teacher, or are there biblical reasons to believe he is God?

| Decision    | Document                                | Reason                                                                                                                                           | Precedent |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **exclude** | `/islenska/lif-eftir-daudann.html`      | It assumes Christ’s divine identity while explaining the afterlife; it does not develop the requested case against the merely-good-teacher view. | P1        |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | It argues that Jesus is the route to salvation, while assuming rather than defending his divine identity against the question’s objection.       | P1        |
| **include** | `/islenska/rett-tru-fyrir-mig.html`     | The body develops Jesus’ authority and resurrection evidence, giving reasons to consider him more than an ordinary teacher.                      | P1        |

##### gq-is-skeptic-bible-trust

The Bible was written by people. Why should I trust that it is God's word?

| Decision    | Document                                | Reason                                                                                                                                       | Precedent |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | It uses biblical authority to explain salvation but does not defend that authority against the objection that human authors wrote the Bible. | P1        |

##### gq-is-believer-recurring-sin

I believe in Jesus but keep falling into the same sin. How can I resist it in daily life?

| Decision    | Document                           | Reason                                                                                                                                                  | Precedent |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/Kristni.html`           | The body explicitly addresses believers’ continuing struggle with sin and directs them to read and apply Scripture and follow the Spirit in daily life. | P1        |
| **exclude** | `/islenska/eitt-sinn-holpinn.html` | Assurance that salvation cannot be lost does not explain how to resist recurring sin in daily life.                                                     | P3        |

##### gq-is-newcomer-next-steps

I have just begun believing in Jesus. What should I do next to grow in faith?

| Decision    | Document                                      | Reason                                                                                                                                      | Precedent |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/Kristni.html`                      | It moves beyond conversion to practical post-conversion guidance: apply Scripture, follow the Spirit, and live in fellowship and obedience. | P1, P3    |
| **exclude** | `/islenska/endurfaedd-kristin-manneskja.html` | It explains becoming born again; the question is what someone who already believes should do to grow.                                       | P3        |
| **include** | `/islenska/merking-lifsins.html`              | The discipleship section explicitly recommends learning about Jesus, Bible reading, prayer, and obedience beyond initial belief.            | P1, P3    |
| **exclude** | `/islenska/vita-vissu-sina-himininn.html`     | It explains obtaining and being assured of salvation, without practical guidance for growth after conversion.                               | P3        |
| **exclude** | `/islenska/personulegur-Frelsari.html`        | It explains receiving Jesus as Savior and ends with a conversion invitation, rather than giving subsequent discipleship steps.              | P3        |

##### gq-is-seeker-purpose

My life feels empty even though things are going well. How can I find lasting purpose according to Christianity?

| Decision    | Document                                | Reason                                                                                                                                                    | Precedent |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **exclude** | `/islenska/eilift-lif.html`             | It explains receiving eternal life, without developing how faith addresses present emptiness and purpose; its invitation does not fill that gap.          | P1, P2    |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | Its focus is salvation’s exclusive route; it does not develop an answer about present meaning and fulfillment despite outward success.                    | P1        |
| **exclude** | `/islenska/pekktu-vilja-Guds.html`      | It discusses discerning permissible decisions and aligning desires with God’s will, rather than the question’s existential emptiness and lasting purpose. | P1        |
