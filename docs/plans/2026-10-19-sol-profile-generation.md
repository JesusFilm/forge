---
title: "Sol subscription generation with existing content profiles and candidate judgments"
date: 2026-10-19
status: in-progress
feature: feat-739
---

# Sol profile/candidate generation

The October 19 owner instruction returns new generation to the catalog-first architecture in [the subscription build plan](2026-10-08-precomputed-recommendation-subscription-build.md), selecting exact `gpt-6.1-sol` through the existing guarded coding subscription. Shared-reading code and historical Astra outputs remain available; its stopped campaign must stay stopped.

## Interface

Use the existing local manual command, after reviewed merge and coordinator admission:

```bash
pnpm --filter @forge/mastra precomputed:subscription:run-manual --config /absolute/private/sol-start.json --execute
```

The October 19 owner update intentionally disables analytics in the new Sol build. Set `input.analyticsPolicy: "disabled_by_operator_v1"` and exact `input.modelId: "gpt-6.1-sol"`. Omit `destination`, `originGenerationId`, and historical recovery. Mixed historical inputs are rejected. This branch constructs no GA/import/auth clients and makes no GA requests. Persist existing protocol 4 `content_only` / `observed_fenced` with null capture, qualification and source history, not an analytics failure or fabricated empty capture. Public readiness gates stay unchanged.

Prepare a fresh catalog/cutoff and reviewed source/corpus/candidate digests. Compute `manualGenerationInputDigest({ analyticsPolicy: "disabled_by_operator_v1", modelId: "gpt-6.1-sol", inputCutoff, videos, selectedCorpusDigest, candidatePoolDigest })`. This binds disabled policy, mode, model, prompt revisions and catalog identities. Do not use a historical digest or reuse Astra profile cache keys.

Config shape (replace placeholders with coordinator-verified values):

```json
{
  "input": {
    "analyticsPolicy": "disabled_by_operator_v1",
    "modelId": "gpt-6.1-sol",
    "invocation": "start",
    "generationId": "new-sol-content-only-YYYYMMDD-v1",
    "generationInputDigest": "RECOMPUTED-SHA256",
    "attemptId": "NEW-UUID",
    "inputCutoff": "VERIFIED-ISO-CUTOFF",
    "initiatingAccountRef": "VERIFIED-ACCOUNT-REFERENCE",
    "reviewed": {
      "sourceVideoIds": ["SORTED-COMPLETE-CATALOG-IDS"],
      "sourceSetDigest": "SHA256",
      "selectedCorpusDigest": "SHA256",
      "candidatePoolDigest": "SHA256"
    },
    "work": {
      "mode": "pilot",
      "sources": [{ "sourceVideoId": "VERIFIED-ID", "exclusiveEndRank": 8 }]
    }
  },
  "minimumRemainingPercent": 25,
  "concurrency": 1,
  "codexExecutable": "/absolute/guarded-codex",
  "stagingDirectory": "/absolute/private/new-staging",
  "capacityProbe": {
    "executable": "/absolute/verified-capacity-probe",
    "args": []
  }
}
```

Plan the source **and candidate-target profile union** for the bounded pilot. Coordinator admits inputs after normal review/deployment. A new `resume` attempt retains generation, cutoff, model, policy, digest and reviewed catalog; `work: { "mode": "full" }` expands work within that frozen identity after pilot acceptance. Frozen-catalog loading remains resume-only and verifies its existing generation/digest/cutoff fence. The existing CLI still requires stagingDirectory; content-only execution creates no GA artifact there.

Omitting `analyticsPolicy` retains historical required origin/destination, exact prior generation digest, default Astra and old profile/edge instructions. That branch supports compatibility, not the new restart. Never modify old captures, checkpoints, usage or identities to fit new input.

## Identity and history

The selected model is bound through manual generation digest, attestation, exact Codex `--model` argument, operator provenance, profile cache keys and edge input/reservation digests. Additive migration 0161 admits Sol alongside Astra in the existing attempt/edge CHECK constraints. No row is updated or relabeled. Admin rejects a generation/attempt mismatch, or a profile/edge model differing from its generation. Old shared-reading callers keep their Astra default, old recovery allowlists remain scoped to their reviewed Astra incidents, and public readiness qualification is unchanged.

Existing ready Astra profiles cannot be reused by merely changing a new generation's model: their cache keys include model/backend/prompt/schema/content, records are keyed by generation and cache key, and catalog validation requires profile model to match generation model. The supported first path creates fresh Sol profiles. A later cross-model import would require explicit origin, exact content/cache verification and honest physical usage lineage; this patch does not add that mechanism. Preserve the original 1031 profiles, prior choices and all ten legacy unknown edge calls.

## Execution and calibration

Complete selected per-edition transcripts still feed reusable profiles; deterministic candidate retrieval and batched directed evidence judgments remain the legacy implementation. New content-only builds bind `subscription-profile-edge-content-only-v1`, profile revision `complete-profile-v7-priority-anchors` and edge revision `shared-edge-content-only-v1`. Map/reduce retain citation IDs/reference restoration and full child coverage. The model prioritizes diverse, distinctive anchors: central question/tension and supported answer/development/practice/outcome in the first two distinct anchors when present, then other dimensions. Never force two, duplicate a passage or invent a resolution. Schemas, candidate bounds, complete-content handling and byte/output limits stay intact. No new stage or per-pair calls are added; actual usage and quality remain unmeasured. Content-only edges omit the historical snapshot and use a null capture reference; member history identity is SHA256 of JSON `null`. Instructions explicitly omit analytics expectations. A new source starts revision0/null, then the first real edge page applies revision1. Resume validates actual candidate cursor and physical calls without a fake history-ready checkpoint. Admin rejects injected history, unresolved consumption, incomplete coverage or failed capacity. Metadata-only stays identified: the 71 recovered private subtitle references are not DB chunk IDs and are not ingested or relabeled here. Private storage/review and runtime locales are reused.

The configured local custom catalog observed October 19 contains exact `gpt-6.1-sol`, context 272,000 with a 95% effective setting (258,400); existing worker rollout metadata independently reports that effective window. The guarded generation transport ignores user config, so these observations are not a generation transport probe or an output-fit guarantee. Its stale `models_cache.json` omission does not prove unavailability. Coordinator must verify the isolated transport during a small explicitly bounded calibration after review/merge. No API-advertised context is assumed. Existing profile prompts remain bounded to 65,536 bytes, profile parts to 24,576 bytes, map/reduce output to 2,048 tokens; edge requests retain their existing bounded page/output contract. These byte bounds are not an exact tokenizer/context proof. Do not increase them without measurement.

For calibration, set existing `input.work` to `{"mode":"pilot","sources":[{"sourceVideoId":"ADMITTED-SOURCE-ID","exclusiveEndRank":8}]}` with a real reviewed candidate boundary. Profiles for that source and its required targets are generated first. Record actual per-physical-call input/output/cached usage, elapsed behavior and evidence validity before admitting `{"mode":"full"}`. No savings, quality, weekly-fit or throughput claims follow from this model-selection patch.

Resume uses `input.invocation: "resume"`, the **same model and frozen generation digest**, a fresh attempt UUID and fresh account/capacity admission. Preserve all receipts and source checkpoints. Unknown/pending physical work is not authorization to retry; old reviewed recovery exceptions do not become a general Sol recovery path. Fresh pre-call allowance/identity checks, no tools, no paid/API-key/credit/reset fallback and stop/drain semantics remain unchanged. No automation is started by this change.

## Verification and delivery

Focused fake-Codex tests check exact Sol argv/provenance, Astra compatibility, 25% reserve refusal before reservation, unchanged trusted/untrusted envelope, once-only known usage and fail-closed unknown handling. Generation and profile identities differ across models while content digests stay stable. Admin tests reject model mismatches before reservation/cache mutation; a disposable-schema migration test exercises both allowed identities and rejects aliases without changing historical rows. Existing profile/edge/account/runner suites and touched lint/format/typechecks precede independent review.

Normal reviewed PR-to-main deployment is allowed. No production generation/import before coordinator admission, direct Railway deployment or public A/B activation is included. The roadmap remains in progress until independent review and the admitted calibration establish the runnable path.

## Preserve stopped generations while pausing future-growth reservations

The stopped legacy generations still hold logical future-growth reservations. They must remain resumable with all evidence, unknown receipts and checkpoints intact; cancellation is unsuitable because it closes resumption and ordinary retention prunes provisional state. The existing authenticated ingest boundary gains one narrow action, after reviewed deployment and coordinator admission:

```json
{
  "action": "capacity_pause",
  "generationId": "EXACT-EXISTING-STOPPED-GENERATION",
  "generationInputDigest": "EXACT-EXISTING-DIGEST",
  "reason": "superseded_by_new_sol_generation",
  "noLiveProducerAttested": true
}
```

Only protocol3/4 `incomplete` or `capacity_blocked` generations qualify. Normal bearer authentication and exact identity apply. An exclusive generation lock followed by the existing capacity advisory lock serializes admission, attempts, leases and reservations. The action requires zero open execution attempts and zero live source leases, plus explicit operator physical-producer-stop attestation. Pending unknown edge rows are preserved history; they are neither proof of a live process nor converted into known/zero usage.

Pause changes only generation status to `capacity_blocked`, capacity status to `paused`, server `blockedAt`, `rollbackRetentionHold:true` and bounded first-pause provenance (reason/time/attestation/prior capacity). It preserves original capacity measurements, projected/held bytes and last successful admission, identities and every child row. Replay returns the original pause timestamp without another mutation. The preservation hold protects idle auto-abandonment, provisional checkpoint pruning and terminal cleanup.

This releases **no physical bytes** and does not reduce the configured reserve. Existing timestamp-aware overlap still charges the old held growth to physical observations at or before `blockedAt`; only a new post-pause PGDATA sample may exclude it for another admission. General storage/health summaries remain conservatively inclusive of blocked holds and may therefore exceed the build-specific fresh-sample overlap. A fresh capacity refresh preserves pause provenance and retention hold. Resumption still requires the original model, normal fresh account/attempt and successful capacity checks; the pause action never resumes Astra. A refresh of the paused generation itself must use a sample strictly newer than its pause. A later genuine pause after resumption records a new blocking epoch while preserving first-pause provenance.

Native disposable-PostgreSQL checks cover authenticated refusal, pause/replay/child and unknown preservation, open attempts/leases, protocol/state restrictions, old versus fresh physical samples, retention and explicit capacity resumption, and concurrent replay. Coordinator separately owns before/after production fingerprints, stopped-process proof, exact identities, new physical observation and independent review. No production pause, cancellation, cleanup, capture or model call is performed by this implementation work.
