---
title: Full-library recommendation generation operator runbook
date: 2026-10-16
category: workflow-issues
module: Precomputed recommendations
problem_type: workflow_issue
component: local_operator
tags: [recommendations, full-library-v1, codex, subscription, checkpoints]
---

# Full-library recommendation generation

`full-library-v1` generates private, directional recommendations with
`gpt-6-astra` through the guarded coding-subscription transport and existing
ChatGPT authentication. Use included subscription allowance only: no paid APIs,
paid-credit fallback or credit resets. Stop when included allowance is unavailable.
The current verification path is one source across the complete eligible library.
The earlier three-source results remain reviewable, but their capped discovery
is not proof of uncapped coverage. Full-run estimates remain conditional on a
new admitted uncapped pilot; no quality or savings gain is established.

Implementation: `apps/mastra/src/services/precomputed-recommendations/full-library-v1.ts`.
CLI: `apps/mastra/src/scripts/run-full-library-recommendations.ts`.
Keep this version's private run directory separate from preserved legacy results;
leave the old producer paused. This CLI performs no database import or public
activation. Public activation remains a separate owner decision after review and
the normal PR-to-main flow.

## Admit a complete corpus

Use the investigator's **complete export**, not the earlier DB-only export.
Pin its exact bytes with SHA-256 and retain upstream provenance, eligibility,
snapshot time, transcript-selection decisions and supplemental subtitle mappings.
The admitted pilot export contains 1,031 eligible videos, 1,297 selected
transcripts and 2,757 references/chunks; 114 videos have metadata only. It adds
71 original subtitle transcripts across 66 videos.

The input contract is `FullLibraryCorpusSchema`: `snapshot.inputCutoff` or
`observedAt`, plus `entries: [{ video, chunks }]`. Each video carries identity,
complete title/description/keywords/citations, family IDs and
`transcriptSelection` using `english-per-edition-with-complete-fallback-v1`.
Each selected descriptor names its transcript, edition, language and total chunk
count; chunks contain unique `id`, `transcriptId`, `language`, `chunkIndex` and
complete `text`. All selected chunk indices must be present exactly once.
Incomplete/skipped selections and any true `*Truncated` flag are rejected.
Completeness means the declared selection policy, not every available language.
Schema checks cannot detect upstream omissions; coordinator admission must verify
the export against its provenance and eligible library.

Metadata-only entries remain eligible with `availableTranscriptCount: 0`,
`selected: []` and `chunks: []`. Their evidence must explicitly identify exact
metadata fields/values and limit the claim accordingly. Supplemental
`subtitle-…` references are private source references tied to original subtitles,
**not database chunk IDs**; preserve their provenance and do not feed them to a
legacy database-chunk importer. Keep transcripts, requests and receipts private.

## Configure and measure offline

Create a private configuration like this. Replace the paths, source ID
and all-zero hash placeholders with reviewed files and their actual SHA-256
digests. The example uses the measured pilot context limits and a **15,000-token
overhead reserve for fresh plans**. Remeasure before changing transport or limits.
Admission evidence must identify the corpus digest,
eligibility/completeness checks and admitted source IDs.

```json
{
  "corpusPath": "/private/full-library/complete-export.json",
  "corpusSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "sourceIds": ["SOURCE_VIDEO_1"],
  "context": {
    "modelId": "gpt-6-astra",
    "modelVersion": "alias; immutable backend revision unreported",
    "contextWindowTokens": 272000,
    "effectiveContextTokens": 258400,
    "autoCompactLimitTokens": 244800,
    "outputReserveTokens": 28400,
    "overheadReserveTokens": 15000,
    "tokenizer": "tiktoken0.14.0/o200k_harmony; exact encoding count, Astra estimate",
    "contextEvidence": "Private measurements.json: conservative subscription limits; larger API/cache windows unverified."
  },
  "tokenizer": {
    "executable": "/usr/bin/python3",
    "args": ["/private/full-library/count-tokens.py"],
    "scriptPath": "/private/full-library/count-tokens.py",
    "scriptSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "runDirectory": "/private/full-library/full-library-v1-trusted-stage/run",
  "planPath": "/private/full-library/full-library-v1-trusted-stage/plan.json",
  "minimumRemainingPercent": 25,
  "codexExecutable": "/absolute/path/to/codex",
  "readingConcurrency": 2,
  "timeoutMs": 900000,
  "admission": {
    "admitted": true,
    "evidencePath": "/private/full-library/admission.json",
    "evidenceSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

The reviewed, hash-bound tokenizer script reads raw UTF-8 from stdin and prints
one positive integer. The pilot uses local `tiktoken` 0.14.0,
`get_encoding("o200k_harmony").encode(text, disallowed_special=())`, with a
compatible Python environment. This counts the actual rendered JSON envelope and
schema exactly for that encoding; it estimates Astra tokens. The measured envelope
uses the selected phase-specific system instruction as `instructions`, the
JSON data string as `untrustedCatalogData`, and the adapter's JSON-only response
instruction. The dynamic response schema is measured separately. Shared planning,
discovery planning and each dispatch use their exact phase instruction. Plans
bind all three instruction digests; per-call request digests bind instructions,
payload, schema and output reserve. Changed instructions require a fresh plan/run
and code-bound manifest, rather than replaying historical checkpoints. Token measurement
makes no model call. Do not substitute character ratios or advertised API/cache
windows for effective subscription context measurements.

Run from the repository root; parent directories must already exist:

```bash
pnpm exec tsx apps/mastra/src/scripts/run-full-library-recommendations.ts plan --config /private/full-library/config.json
```

`plan` is offline and does not require `admission` or `codexExecutable`. It creates
`planPath` exclusively; use a fresh path for a changed plan. Reading schemas
enumerate exactly the supplied source/target IDs, with exact acknowledgement
lengths, including shared mode. This constrains response IDs while every eligible
target remains in the complete input. Exact uniqueness, coverage and evidence
postvalidation still applies. Planning and dispatch measure each actual dynamic
schema's tokens and bytes; old static-schema measurements cannot be reused.
Requests must fit both adapter caps (2,000,000 prompt bytes; 128,000 schema bytes)
and:

```text
inputTokens + schemaTokens + overheadReserveTokens + outputReserveTokens
  <= min(effectiveContextTokens, autoCompactLimitTokens)
```

The original nine-batch pilot plan used a 244,800-token ceiling, 10,000 overhead
tokens and 28,400 output/reasoning tokens. Successful reads measured **actual
input = local prompt estimate + 11,963–11,967 tokens**. The original overhead plus
640 static-schema tokens (10,640 total) under-reserved that observed difference, even
though observed actual input plus output stayed below context. This is a measured
offset for those calls, not an exact Astra tokenizer mapping. Future fresh plans
must reserve **at least 15,000 overhead tokens and remeasure**; their batching may
change. Preserve the original saved plan as historical evidence. The 28,400 output
limit is checked **after** each response, not enforced as a provider generation
cap; audit actual input plus output against context for every new call.

## Run and carry evidence into global ranking

After coordinator admission, use the same frozen plan/config:

```bash
pnpm exec tsx apps/mastra/src/scripts/run-full-library-recommendations.ts run --config /private/full-library/config.json
```

`run` verifies file hashes, plan sources/context and fresh included allowance.
The default 25% reserve requires remaining allowance strictly above that
threshold. The supported alternative `0` requires explicit owner authorization;
zero, unknown or credit-only allowance still blocks dispatch. Never change reserve
or config underneath an active run.

`timeoutMs` accepts integer milliseconds from 1 through 900,000. This CLI defaults
to 900,000 (15 minutes) per physical call, including ranking; the shared adapter's
legacy default remains 300,000 (five minutes). The effective CLI value is frozen
in the execution manifest's config. A timeout preserves known usage or marks
consumption unknown and stops; increasing the deadline never enables a retry.

Every source's complete selected transcripts repeat in every target-reading
batch. All eligible videos are available as targets, excluding self and actual
duplicate identities (equal nonempty core ID/slug, including alternate Dubs of
the same Video). Distinct chapters, siblings and parent films remain eligible
when they add viewing value; shared family membership alone excludes nothing.
The model independently judges their directional value. There is no keyword/similarity/embedding/top-K
eligibility gate, required profile stage or pairwise-judgment framework.

`readingConcurrency: 2` allows at most two reading calls at once; `1` is available
for diagnostics. Each batch has its own physical reservation and receipt. Calls
share no memory. Trusted discovery instructions require **all clearly worthwhile**
directional connections with concise supported explanation, added watching value
and exact evidence, with no fixed per-source/per-batch quota, shortlist or required
number. The common instruction contains no final recommendation count. The data
payload contains only version/sources/targets, with no operator task. Catalog
content and model-produced discoveries remain untrusted evidence. Trusted shared
and global-ranking instructions alone specify 5–8 final recommendations, fewer
with a substantive explanation; ranking data contains only version/sources/
discoveries/informationLoss, with no operator task.

Discovery may truthfully return `allWorthwhileConnectionsReturned: false` when
output cannot contain all discoveries. That physically returned response and its
known usage are preserved, but semantic validation raises `discovery_incomplete`
before coverage or ranking. New dispatch stops, in-flight calls settle, and the
reading-failure marker pauses the run; there is no model retry. A `true` flag is
required for accepted discovery and still does not prove exhaustive reasoning.
Validated discoveries from **all** batches enter one global ranking request in
frozen batch order; batches have no recommendation quota. Ranking selects target
IDs/ranks from that evidence, aiming for 5–8 strong results per source, fewer
with a substantive explanation. Reverse recommendations are separate decisions.

Coverage proves complete inputs supplied and acknowledged, not exhaustive model
attention. Reading may miss connections; ranking receives carried discoveries
and their exact evidence, not complete target transcripts or omitted connections.
If that complete handoff exceeds context, the run stops with
`request_exceeds_context`; it never silently drops evidence. No equal-quality or
savings claim follows from exhaustive input coverage.

## Checkpoints, accounting and recovery

The private run directory retains the frozen manifest/corpus, code/config hashes,
`calls/read-NNNN/` and `calls/rank-global/` requests, reservations, results and
receipts. `coverage-NNNN.json` records source/target/chunk coverage.
`recommendations.json` holds ordered target IDs, connection explanations, added
watching value, exact source/target evidence and shortfall reasons. Validation
rejects invalid IDs, duplicates, self targets and non-verbatim transcript
excerpts or mismatched metadata evidence. It cannot establish semantic quality.

After success, `usage-summary.json` totals actual usage once per physical call.
During a pause, inspect the receipts directly: failed receipts preserve known
usage or explicitly unknown consumption, even when no summary exists. Cached
input is a subset of input; reasoning is a subset of output. Do not add those
subsets again. Missing counters/backend revision remain explicitly unknown/null;
estimates never replace receipts. Unknown consumption blocks continuation. A
successful physical receipt alone does not establish valid coverage/evidence or
a completed recommendation run.

On a reading failure, no further batches launch. Already in-flight calls settle
and retain receipts before `reading-failure.json` pauses the run before ranking.
There are no automatic retries. For an interruption with no failed/pending/unknown
call, repeat the identical `run` command: validated successful calls are reused
without duplicate physical work. Manifest/config/code, corpus, request/result
hashes, model and known usage must still match; concurrency is frozen too.

A failed receipt, unknown consumption, reservation without a terminal receipt or
reading-failure marker blocks resume. Preserve everything for coordinator
reconciliation; never delete these files to force a retry. A crash may leave
`producer.lock`: remove only that lock after verifying its producer is dead.
Removing it does not reconcile consumption. Changed inputs/code or a reconciled
failure need an explicitly coordinated new run, preserving the old run and its
usage accounting. Inspect private recommendations and actual receipts before
projecting a full-library run or considering any separate import/activation.

### Settled original pilot and corrected fresh run

Five pilot reads returned in roughly 3–5 minutes. `read-0004` physically succeeded
but acknowledged one mistyped target ID; do not accept or repair that result.
`read-0005` hit the inherited 300,000ms timeout with **unknown consumption**.
The original attempt remains immutable, invalid/unknown receipts included.

The original instructions also wrongly excluded parent/child/sibling relationships.
Even reads 0–3 with valid acknowledgements cannot establish corrected exhaustive
discovery. That correction required a **fresh plan and private run across all 1,031 targets**,
with the same 3 sources, overhead 15000/output 28400, timeout 900000 and concurrency 2. No old
discoveries or checkpoints are imported. The unfinished recovery importer was
archived and removed; there is no recovery config option. Additional generation
is required by this eligibility correction, with no savings claim.

Preserve the original run byte-for-byte. Its five known physical calls consumed
1,028,132 input and 60,039 output tokens, cached input 0; a sixth physical call has
unknown consumption. These known subtotals include rejected read 4. Keep this
historical usage separate from the fresh attempt, then report each physical call
once across attempts and the original unknown separately. Never relabel unknown
consumption zero or known because a later attempt succeeds. Admit the fresh
corpus/source plan before dispatch; generation and public activation remain
separate decisions.

### Trusted-stage verification after the capped three-source pilot

The corrected-family three-source attempt completed 24 evidence-supported final
results with 1,935,561 input and 92,699 output tokens of known usage. However,
all nine reads returned exactly eight discoveries per source, and notes explicitly
treated the payload's inner task as untrusted. Thus its complete input coverage
and valid selected evidence do not establish compliance with uncapped discovery.
Preserve its requests, results, receipts and earlier full-run projections as
historical artifacts; do not use that capped usage as an accepted uncapped
baseline or import its discoveries into new exhaustive coverage.

Prepare a fresh `full-library-v1-pilot-20261016-trusted-stage` attempt for **How to
Forgive Others** (`cmp787v3r05eoqm01rgaq2yug`) across all 1,031 targets, using the
same complete corpus, overhead 15000/output 28400, timeout 900000 and concurrency 2. This reduces source count without assuming uncapped multi-source output fits.
Coordinator admission and live verification are required; this correction alone
does not establish pilot completion or uncapped output fit. Keep all prior known
usage and the original unknown consumption separate in aggregate reporting.
