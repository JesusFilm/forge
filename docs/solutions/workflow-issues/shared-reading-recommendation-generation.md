---
title: Shared-reading recommendation generation operator runbook
date: 2026-10-19
category: workflow-issues
module: Precomputed recommendations
problem_type: workflow_issue
component: local_operator
tags: [recommendations, shared-reading-v1, codex, subscription, checkpoints]
---

# Shared-reading recommendation generation

`shared-reading-v1` shares exhaustive target readings across up to four complete
sources. It uses `gpt-6-astra` through guarded ChatGPT subscription authentication.
Included allowance only: no paid APIs, paid-credit fallback, credit reset or
automatic allowance manipulation. Default `minimumRemainingPercent` stays at 25%.

Core: `apps/mastra/src/services/precomputed-recommendations/shared-reading-v1.ts`.
CLI: `apps/mastra/src/scripts/run-shared-reading-recommendations.ts`.
Scope: [feat-733](../../roadmap/content-discovery/feat-733-shared-reading-video-recommendations.md).
The accepted [v1 baseline](full-library-recommendation-generation.md) and private
history remain unchanged. Code deployment follows reviewed PR-to-main flow.
This CLI performs no serving import, direct Railway deploy or public activation.

## Complete inputs and references

Pin complete export bytes and tokenizer script with SHA-256. The frozen corpus
contains 1,031 videos, 1,297 complete selected per-edition transcripts, 2,757 chunks
and 114 metadata-only videos. Reuse the v1 validated contract: snapshot time,
identity, untruncated relevant metadata, selected descriptors and every declared
chunk index exactly once. Selection policy is
`english-per-edition-with-complete-fallback-v1`, not every available language.
Admission must review eligibility and upstream omissions. Metadata-only targets
remain eligible, with claims limited to exact metadata.

The renderer sorts videos by ID, assigns stable numeric video refs and partitions
**all** selected text into addressable spans without removing characters.
Metadata refs address exact string fields or individual array values. Every
reading receives original IDs, complete metadata/text and these refs. Discovery
writes fresh concise relation/value notes with evidence refs. Resolution verifies
video ownership and expands refs into verbatim original chunk excerpts or exact
metadata fields. Supplemental subtitle refs are private original-source refs,
**not database chunk IDs**. Preserve the run-specific private `references.json`;
do not pass these artifacts to a legacy database-chunk importer.

An entry that is both a source and target appears in full only once, in
`sources`. Its target is `{ref:N,sourceRef:N}`, resolving to that complete source
entry. Trusted phase instructions define this lookup. All original target
acknowledgments remain required; distinct group members can independently
recommend each other. This avoids duplicating the largest film's transcript
without removing target membership or changing context limits.

Exclude self and true duplicate identities (equal nonempty core ID/slug).
Distinct chapters, parent films and siblings remain eligible for model judgment.
No keyword/similarity/embedding/top-K gate or required profile stage.

## Plan and run

Use new private absolute paths. Omit `sourceIds` to select **every** eligible
source; specify a smaller calibration set if admitted, still against all targets.
`maxSourcesPerGroup` ranges from 1 to 4, default 4. The planner reduces source groups if complete
requests cannot fit. It never truncates entries. Freeze corpus, config, plan,
tokenizer and code before dispatch.

Example conservative context values come from v1; they do not prove output fit or
current allowance. Replace paths/hashes with reviewed values. `admission` and
`codexExecutable` are required only for `run`.

```json
{
  "corpusPath": "/private/shared-reading/complete-export.json",
  "corpusSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "context": {
    "modelId": "gpt-6-astra",
    "modelVersion": "alias; immutable backend revision unreported",
    "contextWindowTokens": 272000,
    "effectiveContextTokens": 258400,
    "autoCompactLimitTokens": 244800,
    "outputReserveTokens": 28400,
    "overheadReserveTokens": 15000,
    "tokenizer": "tiktoken0.14.0/o200k_harmony; exact encoding count, Astra estimate",
    "contextEvidence": "Reviewed private limits and new-renderer plan; live completeness unverified."
  },
  "tokenizer": {
    "executable": "/usr/bin/python3",
    "args": ["/private/shared-reading/count-tokens.py"],
    "scriptPath": "/private/shared-reading/count-tokens.py",
    "scriptSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "runDirectory": "/private/shared-reading/shared-reading-v1-20261019/run",
  "planPath": "/private/shared-reading/shared-reading-v1-20261019/plan.json",
  "maxSourcesPerGroup": 4,
  "readingConcurrency": 2,
  "timeoutMs": 900000,
  "minimumRemainingPercent": 25,
  "codexExecutable": "/absolute/path/to/codex",
  "admission": {
    "admitted": true,
    "evidencePath": "/private/shared-reading/admission.json",
    "evidenceSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

From repository root:

```sh
pnpm exec tsx apps/mastra/src/scripts/run-shared-reading-recommendations.ts plan --config /private/shared-reading/config.json
pnpm exec tsx apps/mastra/src/scripts/run-shared-reading-recommendations.ts run --config /private/shared-reading/config.json
```

`plan` is offline: no account/model calls, and the plan path must be new. `run`
verifies coordinator admission and included-subscription identity/allowance,
recomputes the plan and freezes config/code hashes, reference mapping, model and
run location in the manifest. A nonempty directory without that matching
manifest is rejected. Fresh invocation refreshes account observations; frozen
run config stays unchanged.

Measure the actual adapter JSON envelope: phase-specific trusted `instructions`,
JSON data string in `untrustedCatalogData` and JSON-only response instruction.
Count the dynamic JSON response schema separately. Every admitted reading/rank
must fit 2,000,000 prompt bytes, 128,000 schema bytes and
`input + schema + overhead + output <= min(effectiveContext, autoCompactLimit)`.
The reviewed script reads raw UTF-8 stdin and prints one positive integer.
Local `o200k_harmony` BPE counts are exact for that encoding, **Astra estimates**.
Actual input/output remain authoritative. Output reserve is checked after
response, not provider-enforced; actual input+output must also fit. Unrelated
API/cache limits do not establish a larger window.

## Uncapped discovery and global handoff

Trusted discovery requires all worthwhile directional connections, with no
per-source/per-batch count quota. Operator tasks belong in trusted instructions,
never inside untrusted catalog/model content. Numeric-ID schema constraints and
exact postvalidation reject invented/missing/duplicate acknowledgments,
self/true duplicates and unresolved evidence.

Every group supplies every complete target to every complete source. Complete
leaves must cover all targets exactly once per source. A valid known response
with `complete:false` preserves its receipt and every useful partial discovery,
then deterministically halves complete target assignments into new child calls.
A singleton target splits sources instead. Parent and child discoveries reach
ranking in declared order, with no assumed model memory. Rereads increase usage.
An incomplete single-source/single-target assignment stops.

Each source global ranking explicitly receives its complete source, **all**
carried notes and resolved original evidence with stable discovery IDs. It
chooses final 5–8 directional recommendations, fewer with a reason, and writes full
explanations/value with immutable revalidated evidence. Duplicate target
identities are rejected. Rank requests are measured after discovery; an oversized
global pool stops without pruning or a shortlist.

Complete target transcripts are read during discovery, not repeated wholesale
at ranking. Selected spans/metadata and concise notes may lose nuance; missed
discoveries, incomplete attention, irrelevant evidence and ranking omissions
remain possible. Structural checks do not establish semantic quality. Independent
review and actual shared-reading usage/allowance movement must precede any
quality/savings claim. Offline counts do not prove subscription-week fit.

## Checkpoints, pauses and usage

At most two readers run concurrently. Source groups and rankings advance in
deterministic order. Errors stop new dispatch and settle in-flight calls before
the pause is recorded. Successful checkpoints survive resume: invoke the
**same run command/config** with fresh included-allowance admission.
No daemon, scheduled retry, automatic reset or fallback is created.

- Proven **before-reservation no-dispatch** rejection is `not_dispatched` with no
  physical usage. Preserve that attempt; fresh invocation may create another.
  CLI-level admission rejection can occur before any attempt exists.
- Reserved pending work, physical failure, unknown consumption, invalid IDs/
  evidence, output overflow or actual-context overflow blocks blind resume.
  Investigate without deleting artifacts, relabeling receipts or assuming zero
  usage. There is no automatic model retry.
- Valid complete/incomplete success replays from bound response/result/receipt
  without dispatch. Incomplete parents reconstruct the same children.
  A process lock prevents concurrent producers. After a crash, investigate
  process and receipt state before any operator action on a stale lock.

Private `calls/CALL/aNNNN/` stores reservation, returned response, validated result
and receipt under a stable origin identity. `split.json` binds refinement;
`groups/GROUP/coverage.json` preserves discoveries/complete leaves. Group and
top-level `recommendations.json` remain private. `pauses/` is append-only history,
not a blanket failed marker.

Derived `usage-summary.json` separates known physical calls, unknown origins and
no-dispatch attempts. Input/output totals are **known physical usage only**,
including incomplete parents and rejected known responses. Cached/reasoning
are subsets, not extra usage; absent counters stay null, unknown consumption
stays unknown. This counts this runner's calls, not all account AI usage.
Manifest, receipt and producer-lock protections must not be bypassed.
