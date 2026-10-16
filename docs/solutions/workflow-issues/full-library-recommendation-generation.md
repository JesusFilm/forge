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

`full-library-v1` generates private directional recommendations with
`gpt-6-astra` through the guarded coding-subscription transport and existing
ChatGPT authentication. Use included allowance only: no paid APIs, paid-credit
fallback or credit resets. Stop when included allowance is unavailable.

Core: `apps/mastra/src/services/precomputed-recommendations/full-library-v1.ts`.
CLI: `apps/mastra/src/scripts/run-full-library-recommendations.ts`.
Scope: [feat-710](../../roadmap/content-discovery/feat-710-full-library-video-recommendations.md).
Keep each attempt separate from preserved legacy results and leave the old
producer paused. This CLI performs no database import or public activation.
Code deployment follows normal reviewed PR-to-main flow; direct Railway
deployment is outside this workflow. Public activation is a separate owner decision.

## Admit complete inputs

Pin the complete export's exact bytes with SHA-256 and retain eligibility,
snapshot time, transcript-selection decisions and supplemental subtitle provenance.
The frozen pilot library has 1,031 videos, 1,297 selected complete per-edition
transcripts and 2,757 chunks; 114 videos have metadata only. Its complete export
includes 71 original subtitle transcripts across 66 videos. The earlier DB-only
export is not admitted.

`FullLibraryCorpusSchema` requires `snapshot.inputCutoff` or `observedAt`, plus
`entries: [{ video, chunks }]`. Videos carry identity, complete relevant metadata,
family IDs and `transcriptSelection` with policy
`english-per-edition-with-complete-fallback-v1`. Selected descriptors identify
transcript, edition, language and total chunk count. Chunks contain unique `id`,
`transcriptId`, `language`, `chunkIndex` and complete `text`; every selected index
must occur exactly once. Incomplete/skipped selections and true `*Truncated`
flags are rejected. Completeness means the declared selection policy, not every
available language; coordinator admission must check upstream omissions/provenance.

Metadata-only entries use `availableTranscriptCount: 0`, `selected: []` and
`chunks: []` and remain eligible. Evidence must identify exact metadata fields/
values and limit claims accordingly. Supplemental `subtitle-…` references are
private source references tied to original subtitles, **not database chunk IDs**;
preserve their mappings and do not pass them to a legacy database-chunk importer.
Keep transcripts, model requests, evidence and receipts private.

## Configure and measure offline

Replace placeholder paths/IDs/digests with reviewed private files. Admission
evidence binds the complete corpus, eligibility and source set. Freeze the config
and code before dispatch; never edit them underneath an active run.

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

The hash-bound tokenizer script reads raw UTF-8 stdin and prints one positive
integer. The pilot uses `tiktoken` 0.14.0 with
`get_encoding("o200k_harmony").encode(text, disallowed_special=())`. This is an
exact count for that local encoding, an **estimate of Astra tokens**. Measure the
actual selected phase envelope: trusted `instructions`, the JSON data string in
`untrustedCatalogData`, and the adapter's JSON-only response instruction. Measure
the dynamic JSON response schema separately. Planning and dispatch use identical
phase instructions/rendering; plan instruction digests, per-call request digests
and code/config-bound manifests prevent changed instructions from reusing old work.
Token measurement makes no model call. Remeasure changed inputs/transport; do not
substitute character ratios or advertised API/cache windows.

From the repository root, with private parent directories already created:

```bash
pnpm exec tsx apps/mastra/src/scripts/run-full-library-recommendations.ts plan --config /private/full-library/config.json
```

`plan` is offline, needs neither admission nor a Codex executable, and creates
`planPath` exclusively. Changed plans need fresh paths. Every actual dynamic
schema enumerates exactly the supplied source/target IDs and acknowledgement
lengths, including shared mode. This constrains output identity without filtering
input eligibility. Exact uniqueness, coverage and evidence postvalidation remains
required. Requests must fit 2,000,000 envelope bytes, 128,000 schema bytes and:

```text
inputTokens + schemaTokens + overheadReserveTokens + outputReserveTokens
  <= min(effectiveContextTokens, autoCompactLimitTokens)
```

Use conservative subscription limits and at least 15,000 overhead tokens for
fresh plans. Earlier measured actual input exceeded local envelope/schema counts
by roughly 11.3–11.5k tokens; this supports that reserve for those calls, not a
universal tokenizer mapping. The 28,400 output/reasoning reserve is checked after
each response, not enforced as a provider generation cap. Audit actual input plus
output against context for every physical call.

## Execute discovery and global ranking

After coordinator admission, run the frozen plan/config:

```bash
pnpm exec tsx apps/mastra/src/scripts/run-full-library-recommendations.ts run --config /private/full-library/config.json
```

`run` checks file hashes, source/context identity, ChatGPT account identity and
fresh included allowance before dispatch. The default reserve requires remaining
allowance strictly above 25%. The supported alternative `0` needs explicit owner
authorization; exhausted, unknown or credit-only allowance still blocks dispatch.
`readingConcurrency` is 1 or 2; at 2, each independent batch retains its own
physical reservation/receipt. Ranking starts only after all reads settle.
`timeoutMs` is an integer 1..900000, default 900000 for this CLI; the shared
adapter's legacy default remains 300000. A longer deadline enables no retry.

Every eligible target is supplied with complete available content. Exclude only
self and actual duplicate identities (equal nonempty core ID/slug, including
alternate Dubs of the same Video). Distinct chapters, parents and siblings remain
eligible when useful; family membership alone excludes nothing. There is no
keyword/similarity/embedding/top-K gate, required profile or pairwise framework.

When the complete library fits, trusted shared instructions discover and rank in
one call. Otherwise each reading batch repeats complete source transcripts.
Trusted discovery instructions request **all clearly worthwhile connections**,
with no fixed per-source/per-batch quota, shortlist or required number. They
require concise supported explanations, added watching value and exact evidence.
Only trusted shared/global-ranking instructions specify 5–8 final recommendations
per source, fewer with a substantive reason. Common/discovery instructions contain
no final count. Catalog and model-produced content remain untrusted evidence;
payloads contain only version/sources/targets or discoveries/informationLoss,
never operator tasks. Keep this boundary: an inner untrusted task cannot reliably
override a trusted final recommendation count.

Discovery may report `allWorthwhileConnectionsReturned: false` if output cannot
contain all discoveries. Preserve that physical response and known usage, stop
new dispatch immediately, settle in-flight calls and pause with
`discovery_incomplete` before coverage/ranking. True is required for accepted
discovery but is not proof of exhaustive attention.

All validated discoveries enter one measured global ranking unchanged in frozen
batch order. Calls share no memory. Ranking selects IDs/ranks without inventing
IDs or rewriting evidence; reverse direction is a separate decision. It sees
carried evidence and complete sources, not complete target transcripts or omitted
connections. An oversized handoff stops with `request_exceeds_context`, never a
silent shortlist. Complete input coverage does not prove exhaustive reasoning,
recommendation quality or savings.

## Checkpoints, failures and accounting

Private artifacts include frozen manifest/corpus/code/config identities;
`calls/read-NNNN/` and `calls/rank-global/` requests, reservations, results and
receipts; `coverage-NNNN.json`; final `recommendations.json`; and, on success,
`usage-summary.json`. Recommendations retain target ID/rank, directional
explanation, added watching value, exact evidence and shortfall reasons.
Validation rejects invalid IDs, self/true duplicates, wrong direction/ranks,
non-verbatim excerpts and mismatched metadata values; it cannot establish quality.

Count actual input/output once per physical call, including rejected known-usage
calls. Cached input is a subset of input, reasoning a subset of output; never add
them again. Missing counters/backend revisions remain unknown/null. On a pause,
read each receipt even if no success summary exists. Unknown consumption stays
unknown, never zero or replaced by an estimate or later successful attempt.
A physically succeeded receipt alone does not establish semantic completeness.

On failure or invalid/incomplete output, stop new reads, settle in-flight calls,
retain receipts and write `reading-failure.json` before ranking. There are no
automatic retries. Resume a valid interruption with the identical `run` command:
only validated successful checkpoints with matching manifest/code/config/corpus/
request/result/model/known usage can be reused without physical redispatch.
Failed/pending/unknown consumption and the pause marker block continuation.
Preserve them for coordinator investigation; never delete them to force retry.
Remove a stale `producer.lock` only after verifying its producer is dead; this
does not reconcile usage. Changed inputs/code or reconciled failures require a
separately coordinated new attempt. No recovery-import option ships.

## Measured pilot and historical accounting

The completed trusted-stage pilot used one complete How to Forgive Others source
(`cmp787v3r05eoqm01rgaq2yug`) across all 1,031 targets. Nine reads returned 249
discoveries (30, 22, 24, 21, 29, 35, 38, 19, 31); one global rank selected eight
recommendations. The full shared envelope/schema measured 1,656,482/31,753 local
tokens, so the plan used batches under a 244,800-token ceiling, with 15,000 overhead
tokens, 28,400 output tokens, a 900,000ms timeout and concurrency 2. Actual
input plus the full output reserve fit that ceiling for every call. Independent
mechanical/semantic acceptance is tracked by feat-710 status; private results and
reports remain outside Git.

Ten physical calls recorded 1,890,507 input/102,005 output tokens, cached input 0
and reasoning output 2,812 as subsets. No current call has failed or unknown
consumption. First reservation to final receipt took 1,317.403 seconds (~21.96
minutes); this excludes corpus preparation, planning, reviews and earlier
attempts, and is not end-to-end project time. Variable discovery counts and true
completeness flags do not prove exhaustive model attention.

Preserve each attempt byte-for-byte and account separately; no old discoveries
were imported:

| Attempt                                                    | Known input | Known output | Physical accounting                                                           |
| ---------------------------------------------------------- | ----------: | -----------: | ----------------------------------------------------------------------------- |
| Original, invalid identity/family constraints              |   1,028,132 |       60,039 | Five known calls (includes rejected read4), plus one unknown-consumption call |
| Family-corrected, discovery capped by instruction boundary |   1,935,561 |       92,699 | Ten known calls; historical results are not uncapped discovery proof          |
| Completed trusted-stage pilot                              |   1,890,507 |      102,005 | Ten known calls; 249 discoveries and eight final recommendations              |
| Known subtotal across these attempts                       |   4,854,200 |      254,743 | 25 known calls, plus the separate unknown-consumption call                    |

Prior attempts contribute 2,963,693 known input/152,738 known output plus that
unknown. These totals cover recommendation generation receipts, **not all AI
usage**: legacy generation and worker/coordinator usage remain separate. Never
count unknown consumption as zero or accept capped historical usage as an
uncapped baseline.

The full run has not started. Cloning this one-source pilot across 1,031 groups
would yield 10,310 calls, 1,949,112,717 input/105,167,155 output tokens and about
377.3 processing hours. This conditional reference is not a forecast, calendar
ETA, permission for paid credits or proof of quality/savings. Local nine- and
seventeen-read examples are not upper bounds: source length, discovery density,
output/handoff fit and allowance waits vary. Public activation stays off pending
a separate owner decision.
