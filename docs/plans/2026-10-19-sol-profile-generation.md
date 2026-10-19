---
title: "Sol subscription generation with existing content profiles and candidate judgments"
date: 2026-10-19
status: in-progress
feature: feat-738
---

# Sol profile/candidate generation

The October 19 owner instruction returns new generation to the catalog-first architecture in [the subscription build plan](2026-10-08-precomputed-recommendation-subscription-build.md), selecting exact `gpt-6.1-sol` through the existing guarded coding subscription. Shared-reading code and historical Astra outputs remain available; its stopped campaign must stay stopped.

## Interface

Use the existing local manual command, after reviewed merge and coordinator admission:

```bash
pnpm --filter @forge/mastra precomputed:subscription:run-manual --config /absolute/private/sol-start.json --execute
```

The existing strict config gains one optional field: `input.modelId`. Set it to `"gpt-6.1-sol"` for new Sol calls. Omitted or explicit `"gpt-6-astra"` preserves previous behavior. No aliases or fallback models. All other config fields and the authenticated Admin boundary are unchanged. Keep `minimumRemainingPercent: 25`; concurrency defaults to one and can be bounded explicitly by the existing command.

Generate a **new** generation ID, attempt UUID and generation input digest. Existing operator preparation must pass `modelId: "gpt-6.1-sol"` to `manualGenerationInputDigest({ inputCutoff, videos, selectedCorpusDigest, candidatePoolDigest, modelId })`, then bind that digest into `input.generationInputDigest` and `input.destination.generationInputDigest`. Keep the reviewed source/corpus/candidate digests and destination qualification contract exact; do not substitute shared-reading corpus/digests into the legacy catalog format. Account bindings and destination/capacity helpers remain private.

A minimal config change to an independently prepared, complete existing manual config is:

```json
{
  "input": {
    "modelId": "gpt-6.1-sol",
    "invocation": "start",
    "generationId": "new-sol-catalog-YYYYMMDD-v1",
    "attemptId": "NEW-UUID",
    "generationInputDigest": "RECOMPUTED-SOL-DIGEST"
  },
  "minimumRemainingPercent": 25,
  "concurrency": 1
}
```

This fragment shows changed fields, **not** a complete executable config. Retain existing `inputCutoff`, initiating account, reviewed manifest, origin/destination GA snapshot bindings, work boundary, executable, staging directory and verified capacity probe. The existing parser requires them; it rejects unknown fields. The preparation helper and production credentials are coordinator-owned and must not be copied into source control.

The old sealed GA origin and frozen catalog are not automatically reusable for a fresh start. Frozen catalog loading is resume-only and pins the original generation/digest/cutoff; current Admin timestamp fences can refuse that historical cutoff on changed rows. The supported fresh route is a current catalog/cutoff plus a newly prepared qualified GA origin/capture and exact destination bindings through the existing operator helpers. Coordinator owns those writes after admission. Reusing the old GA capture is conditional on proving every existing cutoff/content/query/range/route/coverage invariant; do not relax fences or relabel its bytes to make it pass.

## Identity and history

The selected model is bound through manual generation digest, attestation, exact Codex `--model` argument, operator provenance, profile cache keys and edge input/reservation digests. Additive migration 0161 admits Sol alongside Astra in the existing attempt/edge CHECK constraints. No row is updated or relabeled. Admin rejects a generation/attempt mismatch, or a profile/edge model differing from its generation. Old shared-reading callers keep their Astra default, old recovery allowlists remain scoped to their reviewed Astra incidents, and public readiness qualification is unchanged.

Existing ready Astra profiles cannot be reused by merely changing a new generation's model: their cache keys include model/backend/prompt/schema/content, records are keyed by generation and cache key, and catalog validation requires profile model to match generation model. The supported first path creates fresh Sol profiles. A later cross-model import would require explicit origin, exact content/cache verification and honest physical usage lineage; this patch does not add that mechanism. Preserve the original 1031 profiles, prior choices and all ten legacy unknown edge calls.

## Execution and calibration

Complete selected per-edition transcripts still feed reusable profiles; deterministic candidate retrieval and batched directed evidence judgments remain the legacy implementation. Profile/reducer prompts, schemas, complete-content handling and byte/output limits are unchanged. No GA/profile provenance, DB chunk IDs or per-pair calls are fabricated. Private storage/review and runtime locales are reused.

The configured local custom catalog observed October 19 contains exact `gpt-6.1-sol`, context 272,000 with a 95% effective setting (258,400); existing worker rollout metadata independently reports that effective window. The guarded generation transport ignores user config, so these observations are not a generation transport probe or an output-fit guarantee. Its stale `models_cache.json` omission does not prove unavailability. Coordinator must verify the isolated transport during a small explicitly bounded calibration after review/merge. No API-advertised context is assumed. Existing profile prompts remain bounded to 65,536 bytes, profile parts to 24,576 bytes, map/reduce output to 2,048 tokens; edge requests retain their existing bounded page/output contract. These byte bounds are not an exact tokenizer/context proof. Do not increase them without measurement.

For calibration, set existing `input.work` to `{"mode":"pilot","sources":[{"sourceVideoId":"ADMITTED-SOURCE-ID","exclusiveEndRank":8}]}` with a real reviewed candidate boundary. Profiles for that source and its required targets are generated first. Record actual per-physical-call input/output/cached usage, elapsed behavior and evidence validity before admitting `{"mode":"full"}`. No savings, quality, weekly-fit or throughput claims follow from this model-selection patch.

Resume uses `input.invocation: "resume"`, the **same model and frozen generation digest**, a fresh attempt UUID and fresh account/capacity admission. Preserve all receipts and source checkpoints. Unknown/pending physical work is not authorization to retry; old reviewed recovery exceptions do not become a general Sol recovery path. Fresh pre-call allowance/identity checks, no tools, no paid/API-key/credit/reset fallback and stop/drain semantics remain unchanged. No automation is started by this change.

## Verification and delivery

Focused fake-Codex tests check exact Sol argv/provenance, Astra compatibility, 25% reserve refusal before reservation, unchanged trusted/untrusted envelope, once-only known usage and fail-closed unknown handling. Generation and profile identities differ across models while content digests stay stable. Admin tests reject model mismatches before reservation/cache mutation; a disposable-schema migration test exercises both allowed identities and rejects aliases without changing historical rows. Existing profile/edge/account/runner suites and touched lint/format/typechecks precede independent review.

Normal reviewed PR-to-main deployment is allowed. No production generation/import before coordinator admission, direct Railway deployment or public A/B activation is included. The roadmap remains in progress until independent review and the admitted calibration establish the runnable path.
