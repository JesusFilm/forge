---
title: Migrate Manager Enrichment Pipelines to Mastra (Engine Consolidation)
type: feat
status: active
date: 2026-05-28
origin: docs/brainstorms/2026-05-28-manager-enrichment-mastra-consolidation-requirements.md
---

# ✨ Migrate Manager Enrichment Pipelines to Mastra (Engine Consolidation)

## Enhancement Summary

**Deepened on:** 2026-05-28 · **Agents used:** architecture-strategist, security-sentinel, data-integrity-guardian, data-migration-expert, deployment-verification-agent, performance-oracle, julik-frontend-races, code-simplicity, kieran-typescript, pattern-recognition, agent-native, framework-docs (Mastra 1.36 + LaunchDarkly v9 skeletons).

> **✅ Phase 0 VERIFIED on Railway (2026-05-29, production `@forge/manager`):** runs **1 replica** (`multiRegionConfig.us-west2.numReplicas: 1`, no volume); `WORKFLOW_API_KEY` / `WORKFLOW_TARGET_WORLD` / `VERCEL_DEPLOYMENT_ID` / `VERCEL` all **unset** → old `workflow` SDK resolves to the **Local World** (ephemeral disk, no cross-redeploy resume).
> **Consequences:** (a) the durability "regression" is confirmed non-existent — neither engine resumes on Railway today, so recovery-sweep + idempotent-steps is the correct model for **both**, not a Mastra-only patch; (b) **single-instance ⇒ the heavy P0-B (DB-atomic step-merge / `version`-column migration) is NOT needed** — `jobUpdateLocks` is sufficient at 1 replica and R-SSE collapses (callback + SSE co-located); the monotonic + error-dedup guard folds into the Phase-1 callback handler. **Revisit P0-B and R-SSE only if Manager is ever scaled >1 replica.**

### Corrections that flip prior assumptions (read first)

1. **No durable resume exists _today_, on either engine.** Manager's `workflow` SDK resolves to the **`local` World** on Railway (`WORKFLOW_TARGET_WORLD` and `VERCEL_DEPLOYMENT_ID` both unset → `.workflow-data/` on ephemeral disk). So "in-flight runs finish on the old engine across a deploy" was **never true on Railway**. R-DUR is therefore **not a Mastra regression** — it's the current reality. **Action: verify in prod (`printenv WORKFLOW_TARGET_WORLD VERCEL_DEPLOYMENT_ID`) before relying on any "drain old runs" logic.** Recovery sweep + idempotent steps become the safety net for the whole system, not a Mastra-only patch.
2. **The engine stamp is write-only as code stands (foundational P0).** `state.ts toJobRecord` hardcodes `options: {}` on read (mock path) and `updateJob`/`UpdateAdminJobInput` omit `options` entirely — so `job.options.engine` is **always empty on read**. The callback's accept-by-stamp gate and the Phase-2 drain query both read a field that's blank. **Fix `toJobRecord` to parse `node.options` + a round-trip test in both backend modes before anything else.**
3. **LaunchDarkly is already in the repo** as `@forge/feature-flags` (LD v9 wrapper with graceful degradation, used by `apps/web`). The runtime-flippable flag is cheap reuse, **not** net-new infra. Register `forge.enrichment.engine` in `packages/feature-flags/src/registry.ts`.
4. **Step-vocabulary fix:** `FORGE_WORKFLOW_STEPS` = `[transcription, translation, chapters, metadata, embeddings, mux_upload, audio_cleanup, theology_validation_bible_quotes, seo_improvements]`; the placeholders are `theology_validation_bible_quotes` + `seo_improvements`. **`scene_analysis` is NOT a step** — it's artifact-only (`scene-analysis.json`), runs outside the step model today. The callback must NOT emit a `scene_analysis` step transition.
5. **Async dispatch is justified but must be stated:** enrichment p95 is ~20–40 min, exceeding any HTTP/`after()` window, so the blocking pattern `transcriptOnlyPipeline` uses can't be reused for the full graph. Confirm with a one-time wall-clock measurement (Phase 0).

### Key improvements folded in

- **Callbacks are per-STEP, not per-language** (~14 vs ~200 Admin writes/job). The translation step's `completed` callback carries aggregated `languageResults` in `details` — exact parity with today's single `getTranslationStepDetails` write. (perf, simplicity)
- **runId fencing token** on the callback gate (accept iff `runId === job.currentRunId` AND stamp is `mastra`) — kills zombie-callback corruption from a not-actually-dead old run. Unifies with the recovery claim-lease. (security C1, julik R-OOO-c)
- **DB-atomic job write** for the callback (transaction + `SELECT … FOR UPDATE` or version-CAS), because `jobUpdateLocks` is per-process and callbacks land on arbitrary Railway instances. (data-integrity P0, perf, julik N-1)
- **Recovery skip via `languageResults` first** (O(1) from the job record), S3 only for the ambiguous tail via one `ListObjectsV2` — not 100 `HeadObject`s; skip gate is `languageResults===completed AND artifact verifies`, falling **closed** to re-translate. (perf P1-5, data-integrity P1)
- **Phase 0.5 primitives spike**: `.parallel` / `.foreach({concurrency})` / nested-workflow-as-step / fatal-branch-cancellation are **greenfield in `apps/mastra`** (all 7 existing workflows are linear `.then` chains) — prove them on `@mastra/core@1.36` before trusting the parity harness.
- **Drop explicit production shadow dual-run**; rely on golden-parity harness + staged flag ramp. Keep a **global cross-engine concurrency ceiling** for the ramp window (both engines share OpenRouter/Mux quota). (simplicity, perf)
- **Agent-native gaps closed**: engine flag readable/settable via bearer API (automated rollback can't drive a web console); immediate `accepted`/`dispatchedAt`+`runId` written on dispatch (pre-first-callback visibility without Studio); polling declared the agent progress contract; `POST /api/jobs/[id]/redispatch`; assert `engine` projected into the read model. (agent-native)

---

## Overview

Manager runs its AI video-enrichment pipeline on the Vercel `workflow` npm SDK (`^4.2.2`). `apps/mastra` is the strategic AI-orchestration runtime (`@mastra/core@1.36`, 7 production workflows, Studio, Postgres store, Railway) and **Manager already calls Mastra** for transcript embeddings. This plan retires the `workflow` SDK from Manager — the 4th in the proven Mastra↔Admin migration series (feat-132/133/134/135), explicitly anticipated by `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md` and `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md` R10. Maps to roadmap **feat-031** (P0, in-progress).

**Locked decisions** (see origin: `docs/brainstorms/2026-05-28-manager-enrichment-mastra-consolidation-requirements.md`): consolidate on one engine; all 4 SDK-bound pipelines + scene analysis; **Mastra → Manager callback** seam; **runtime-flippable** flag + per-job **stamp**; parity-first + bounded fixes.

## Problem Statement

Two workflow engines carry the same orchestration concern. The migration crosses real cliffs the deepening quantified:

- **Mastra `run.start()` blocks**, no managed queue, **no auto-resume in production** — but the old engine's Local World _also_ has no Railway-durable resume (correction #1), so the regression is smaller than first framed; the fix (recovery sweep + idempotent steps + job-record-as-checkpoint) is the same.
- **Mastra cannot write GraphQL** (no client; `apps/mastra/CLAUDE.md` bans importing `apps/admin|manager|auth`) → write-back is REST → Manager callback.
- **No S3 client and no fan-out/concurrency primitive in use** in `apps/mastra` — both net-new (though `.foreach({concurrency})` exists in 1.36 and is _better_ than the old SDK for the 50-language cap).

## Proposed Solution

Re-home the enrichment graph into Mastra as `createWorkflow`/`createStep` workflows, triggered **asynchronously** by Manager (sync ack + `void run.start()`), reporting progress back through a **new internal Manager callback** that drives an **atomic** job-write. Cut over behind a **runtime-flippable engine flag** (`@forge/feature-flags`) with a **per-job stamp + runId fence**, validated by a **golden-parity harness** + staged ramp, then remove the `workflow` dependency in a second deploy.

### The "single cutover" reconciliation (unchanged, still load-bearing)

You cannot remove the `workflow` dep + `withWorkflow` **and** keep runtime rollback to `workflow`. So "single cutover" = **one comprehensive migration of all 4 pipelines, shipped in two deploys**: Phase 1 ships Mastra + flag + stamp + callback with the dep **still installed** (rollback works); Phase 2 removes the dep, **gated on zero in-flight `workflow`-stamped jobs (with a staleness cutoff for wedged jobs — correction #1 means wedged jobs WILL occur on redeploys)**. The rollback lever exists only during Phase 1.

## Technical Approach

### Architecture

```
 apps/manager (trigger + UI)                                   apps/mastra (engine)
  POST /api/enrich · /api/jobs · /rerun · /admin-trigger/*
        │ createManagerJob → STAMP options.engine = flagClient.read(jobId)  ◀── @forge/feature-flags (forge.enrichment.engine)
        │ persist options.engine AND currentRunId
        ▼
  launchVideoEnrichment ── switch(readEngineStamp(job)) ──┐
   │ "workflow" (Phase 1 only)                            │ "mastra"
   ▼                                                      ▼
  start(runVideoEnrichment)        POST {MASTRA_BASE_URL}/forge-video-enrichment  (Bearer MASTRA_ENRICHMENT_API_KEYS)
                                          │  validate bearer → Zod parse → mint runId server-side → createRun({runId})
                                          │  ── SYNC ACK {ok,runId} (202) ──┐  then  void run.start().catch(log)
   Manager: non-2xx ack ⇒ job.status=failed (parity);    │  Manager persists runId + dispatchedAt (pre-callback visibility)
            2xx ⇒ 202; watchdog fails stuck `pending`     │
                                                          ▼  one callback PER STEP transition (NOT per language)
  POST /api/internal/enrichment-callback  (Bearer ENRICHMENT_CALLBACK_API_KEYS + per-job runId fence)
     accept IFF readEngineStamp(job)==="mastra" AND body.runId===job.currentRunId   ◀── fencing token
     → DB-ATOMIC step-merge (txn + FOR UPDATE / version-CAS), monotonic by (step,sequence), error-dedup, bounded payload
     → existing SSE + POLLING (job record = source of truth) renders UI
                                          ▲
  recovery sweep (Manager, claim-lease, atomic) re-dispatches stale running mastra jobs → steps SKIP via languageResults
```

### Critical prerequisites (must land before the seam works)

- **P0-A — make the stamp readable.** Fix `state.ts toJobRecord` (L263) to parse `node.options`; confirm `JOB_SELECTION` includes `options`; widen `UpdateAdminJobInput` only for a dedicated `restampEngine(jobId, engine)` that _merges_ (never bare-replaces) `options`. Round-trip test in **both** backend modes. Without this the whole design reads an empty field.
- **P0-B — DB-atomic job write.** Add an Admin mutation `applyManagerJobStepTransition(jobId, runId, step, status, sequence, details?, error?, artifactsDelta?)` that does read-modify-write inside one `$transaction` (`SELECT … FOR UPDATE` or version-CAS). The Manager callback calls this. `jobUpdateLocks` stays as a same-process coalescer only, with a comment that it is **not** the correctness boundary.
- **P0-C — drain query.** Add a filtered `managerJobs(status, engine, updatedBefore)` (or a documented page-all-and-filter checker) with a **staleness cutoff**; plus an operator runbook to force-terminal wedged `workflow` jobs so Phase 2 can't be blocked forever.

### Service relocation map (unchanged; Mastra gets its own external clients, S3 key scheme is a shared contract `{assetId}/{artifactType}.{ext}`)

| Move fully to Mastra                                                                                                            | Manager keeps a thin helper                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `subtitleTranslation/*`, `chapters`, `metadata`, `sceneAnalysis`, `sceneBoundaries`, `sceneEmbeddingSync`, `openrouter`         | type re-exports only                                                                                                                     |
| `transcription`, `mux-sync`, `audioCleanup`, `elevenlabs-transcription` (Mastra re-owns over its own Mux/S3/OpenRouter clients) | `normalizeSourceLanguageCode`, `applySubtitleOverride`, `isAudioCleanupConfigured`, `isSupportedElevenLabsLanguage` (route/UI consumers) |
| —                                                                                                                               | `mux`, `storage` **read path** (`/api/jobs/[id]/artifacts/[artifact]`, review player) stay                                               |

### Callback contract (kieran-typescript: discriminated by `status`, `.strict()`, no `pending` arm)

```ts
// Manager owns the schema; Mastra declares a byte-identical local copy (CLAUDE.md import ban) — lockstep via a checked-in fixture test.
EnrichmentCallback =
  | { jobId, engine:"mastra", runId, sequence, status:"running",   step: EnrichmentStep }
  | { jobId, engine:"mastra", runId, sequence, status:"completed", step, languageResults?: TranslationLanguageResult[], artifactsDelta?: string[] }
  | { jobId, engine:"mastra", runId, sequence, status:"failed",    step, error: string /* required here only */, artifactsDelta?: string[] }
  | { jobId, engine:"mastra", runId, sequence, status:"skipped",   step }
// + optional { jobStatus?: "completed"|"failed" }
```

- `EnrichmentStep` = `z.enum(FORGE_WORKFLOW_STEPS)` (the 9-member closed set; **no `scene_analysis`**). A `_subset` compile-assert proves it's a subset of `WorkflowStepName` so a divergence is a **build break**.
- `artifactsDelta` is **logical keys** (`["subtitles-fr","chapters-vtt"]`), validated against a **closed key set + trusted-host** rule, run through `buildDownloadableArtifactManifest` + merge — never raw manifest entries (security C1b).
- Engine stamp read via `z.enum(["workflow","mastra"]).catch("workflow")` — legacy/missing/corrupt → `workflow` (the engine whose dep is installed in Phase 1).
- Monotonic guard: per-step `STATUS_RANK: Record<StepStatus,number>` floor (terminal never regresses) + `(step,sequence)` ordering. **Sequence orders within a step only — never across parallel steps.** Error-dedup by `{step,sequence}` (not `{step,message}`, which a timestamped provider message defeats).

### Implementation Phases

#### Phase 0 — Baseline, measurement & primitives spike (no engine code merged to prod path)

- **Verify the durability premise**: `printenv` on the Manager Railway service for `WORKFLOW_TARGET_WORLD`/`VERCEL_DEPLOYMENT_ID`; record whether the old engine is Local World (correction #1). Reframe R-DUR/drain accordingly.
- **Measure** longest enrichment wall-clock (60+-scene feature, 50 langs) vs Railway/gateway timeout → confirms async dispatch is required (it is).
- **Phase 0.5 primitives spike**: a throwaway Mastra workflow proving `.parallel` (branch-output keying + branch input typing), `.foreach(nestedWorkflow,{concurrency})` (+ `workflow-step-progress`), nested-committed-workflow-as-step, and **fatal-branch-cancellation semantics** on `@mastra/core@1.36`. No existing precedent in `apps/mastra`.
- **Lock a byte-identical regression snapshot** of current outputs (test-first-regression-snapshot pattern).
- **Parity harness** with **fail-loud on empty/under-sized/unauth corpus** (literal prior scar — `parity-harness-prod-gate-defects-20260514`). Corpus: short clip, 60+-scene feature, no-transcript, CJK, RTL, transcript-only, scene-analysis. **Oracle:** deterministic envelope byte-identical (S3 key SET, terminal `job.status`, per-step status vector, `muxSync.comparisons`, language-coverage set) + **request-count assertions** (OpenRouter/Admin/S3 call counts — the dangerous regressions are invisible to output diff: inner-loop fan-out width, per-step-vs-per-language callbacks, 429-degraded coverage) + LLM text via semantic cosine. Chunking allowed to differ.

#### Phase 1 — Dual-engine, flag-gated (`workflow` dep STAYS installed)

1. **Mastra enrichment workflow** mirroring `videoEnrichment`: `.parallel` over {translation-branch, chapters, metadata, embeddings}; translation-branch = `fan-out step → .foreach(perLanguageWorkflow, { concurrency: 10 })` (preserve p-limit cap; **keep inner chunk loop sequential** — parallelizing chunks would 10× the OpenRouter rate). Compose `transcriptEmbeddingWorkflow` + `sceneEmbeddingWorkflow` in-process (pass committed workflows directly to `.then`/`.foreach`, not `createStep`-wrapped). Fatal steps (`transcribe`, `mux_upload`) **throw** typed failures (Studio red; `{ok:false}` is a GREEN run); non-fatal (`audio_cleanup`) catch-return-sentinel; `scene_analysis` stays **artifact-only**, `bail()` for "not requested" → `skipped`. `mux_upload` = persist `muxSync` artifact FIRST → await audio_cleanup → then fail on `comparison==="failed"`.
2. **Port `transcriptOnlyPipeline` + `sceneAnalysisPipeline`** to Mastra (no flag; mechanical). **Reconcile rerun vs idempotent-skip**: transcription rerun's purpose is to RE-transcribe with a new provider, so the transcribe step must **force** on rerun (not skip-on-`transcript.json`-exists); idempotent-skip applies to _recovery resume_, not _intentional rerun_. Rerun also prunes the same artifact keys and **re-stamps** engine via `restampEngine` (merge, not replace).
3. **Mastra routes** `/forge-video-enrichment`, `/forge-transcript-only`, `/forge-scene-analysis` — **per-route** bearer (never `/api/*` middleware), **own CSV `MASTRA_ENRICHMENT_API_KEYS`** distinct from `MASTRA_SERVICE_API_KEYS` (enrichment is a heavier cost/abuse surface than embeddings — security H2). Mint `runId` **server-side** (never from body — security M3). Sync ack `{ok,runId}` → `void run.start().catch(log)`. This route is **net-new** (all existing routes block on `await run.start()`); design its ack/slot contract fresh + a fire-and-forget sync-throw test.
4. **Manager callback** `POST /api/internal/enrichment-callback`: reuse `apps/manager/src/lib/admin-trigger-auth.ts` validator (don't hand-roll); add **boot-time CSV disjointness invariant** (`assertBearerCsvsDisjoint` over Manager's CSVs — security H1); **rate-limit before auth** (security H3); accept iff stamp `mastra` AND `runId===job.currentRunId` (fence); apply via **P0-B atomic mutation**; monotonic + dedup live **in the handler, not in `doUpdateStepStatus`** (mutating that would change the Phase-1 old-engine path too — pattern reviewer); unknown step → 400 (`.strict()`); unknown jobId / stale runId → **2xx ack-and-drop**; bound `error`/`details` size; never log raw body.
5. **Engine flag + stamp**: register `forge.enrichment.engine` in `@forge/feature-flags`; `resolveEnrichmentEngine(jobId)` read **once** at create, persisted to `options.engine` (P0-A); `launchVideoEnrichment` switches on `readEngineStamp`; **default missing→`workflow`**. Expose **`GET/PUT /api/admin/engine-flag`** (bearer) so automated rollback isn't a web-console action (agent-native Gap 2); document the LD-targeting % ramp.
6. **Async-launch parity + visibility**: non-2xx ack ⇒ `failed`; persist `dispatchedAt`+`runId` on ack (pre-first-callback visibility — agent-native Gap 3); **two watchdogs** calibrated from Phase-0 p95 — ack→first-callback (armed at dispatch, disarmed on first callback) and inter-callback staleness — both monotonic-aware so a late callback can't resurrect/clobber.
7. **Recovery**: Manager sweep (owns durable job records) finds stale `running`/`pending` mastra jobs; **atomic claim-lease that writes the new `currentRunId` in the same write** (claim = fence); idempotent skip via `languageResults===completed AND artifact verifies` (one `ListObjectsV2`/asset, not 100 HEADs); `POST /api/jobs/[id]/redispatch` exposes manual re-drive (agent-native Gap 4). Mastra `restartAllActiveWorkflowRuns()` is a **backstop only** — the Manager sweep is authoritative; do not let both double-fire (the claim-lease + runId fence prevents it).
8. **Per-asset cross-engine concurrency guard** via the P0-C Admin query (process-local `inFlightMap` is insufficient cross-instance) — same atomic-claim primitive keyed by `assetId`; right-size to the verified Manager instance count.
9. **Timeout budgets** (correct from deepening): dispatch ack **10–15s** (NOT the 120s embedding-client value — it only awaits the ack), watchdog `pending` **60s**, per-language step **~10 min**, run total **45 min** (verify < Railway deploy-drain), callback inner **<10s** < step budget. Typed `TimeoutError` → retryable.
10. **Plain-string logs** `[label] event=name key=value` (Railway logsV2 drops JSON) — note `admin-trigger-route.ts` currently violates this; don't copy its logging.
11. **Validate**: parity harness green + non-vacuous → staged flag ramp by **new-run %** (5→25→50→100), holding each tier until ≥1 full feature-length run completes + verified; monitor error/latency/**cost**/coverage + **global cross-engine concurrency ceiling** (≤~5 concurrent jobs both engines, tuned to OpenRouter 429 onset) with automated flag-flip rollback. (No separate shadow dual-run — the ramp is the real-traffic validation.)

#### Phase 2 — Decommission old engine (gated on P0-C drain: zero in-flight `workflow` jobs for N min, wedged jobs force-terminaled)

- Remove `start(...)`, `import "workflow/api"`, the 13 directives, `jobStateSteps.ts` directives, `withWorkflow` in `next.config.ts`, the `workflow` dep, `WORKFLOW_API_KEY`. Update `apps/manager/CLAUDE.md`.
- **Pre-deploy safety pin**: tag the pre-Phase-2 SHA and confirm Railway retains the prior `forge-manager` image (the only rollback path once the dep is gone).
- Verify: grep `"use workflow"|"use step"` in `apps/manager` → empty; `workflow` absent from deps.

## Alternative Approaches Considered

- **Mastra → Admin direct REST write-back**: cleaner long-term but needs a new Admin route + replicating Manager's per-job serialization → race risk. Rejected for parity-first; revisit post-migration.
- **Env-var flag**: rollback needs redeploy; and `@forge/feature-flags` already exists, so runtime-flippable is cheap. Chosen runtime-flippable.
- **Sync/`after()` blocking dispatch** (like `transcriptOnlyPipeline`): elegant and deletes the watchdog/callback-async machinery, BUT enrichment is 20–40 min — exceeds the HTTP/`after()` window. Rejected after the Phase-0 measurement confirms it (if measurement surprises, revisit).
- **True single-commit cutover**: contradicts flag/stamp/rollback. Rejected for two-phase.

## System-Wide Impact

### Interaction Graph

Trigger (6 sites) → `createManagerJob` (+ stamp + currentRunId) → `launchVideoEnrichment` switch → Mastra route sync ack (persist runId/dispatchedAt) → `void run.start()` → steps call moved services → **per-step** callback → P0-B atomic merge → SSE + polling → UI; artifacts to S3 by Mastra, read by Manager's unchanged route.

### Error & Failure Propagation

Fatal steps throw → run `failed` → callback `failed`. Non-fatal catch + sentinel + `skipped`/`failed` step, run continues. `mux_upload` fatal-**after**-side-effect. Inner timeouts < caller budget (no retry storm). Per-language soft-failure stays inside the translation step (parity with `Promise.allSettled`) — verify `.foreach` does **not** short-circuit on a rejected item (else the partial-success contract breaks — integration scenario #5).

### State Lifecycle Risks

- Durable checkpoint = Admin job record + S3 (Mastra has no mid-step memoization; `restart()` is from-last-step). Recovery relies on idempotent per-language skip.
- **Cross-process SSE (R-SSE) is a regression** (today the workflow + SSE are co-located in-process). Polling = correctness floor; SSE = decoration.
- Zombie callback from a previous run → **runId fence** rejects it.
- Concurrent callbacks across instances → **P0-B atomic merge** + monotonic guard.
- `mergeJobArtifacts` must be **commutative/additive** (esp. nested `languageResults`) — a shallow `{...a,...b}` spread loses one instance's languages (julik N-1).

### API Surface Parity (incl. agent-native)

All 6 trigger sites keep contracts. New internal callback. New bearer-readable `engine-flag` API + `redispatch`. `options.engine` **must be projected into the `GET /api/jobs/[id]` read model** (agent-native Gap 5). Polling is the agent progress contract. Closed step vocab `FORGE_WORKFLOW_STEPS` (9 members; placeholders `theology_validation_bible_quotes`+`seo_improvements`).

### Integration Test Scenarios

1. Restart mid-fan-out (30/50) → recovery skips 30 via `languageResults` (0 redundant OpenRouter, ≤1 S3 list — request-counter assert).
2. Flag rolled back to `workflow` while a mastra job runs → callbacks still accepted by stamp+runId; completes on mastra.
3. Retried + out-of-order callback (`completed` then late `running`, parallel `chapters:running` after `metadata:completed`) → per-step monotonic, no cross-step rejection, no dup error.
4. **Zombie run**: old run fires `translation:completed` after a rerun minted a new runId → rejected by fence.
5. `mux_upload` comparison-failed → `muxSync` persisted, audio_cleanup ran, then `failed`.
6. Partial-language (3/50 fail) → translation step `completed`, `languageResults` has 3 `failed`, job not failed, 47 VTTs.
7. Mastra route rejects (bad payload/401/503) → job `failed` (no stuck `pending`); 2xx-but-never-started → watchdog fails it.
8. Two concurrent sweeps / two `/api/enrich` for one asset → exactly one dispatch (atomic claim).
9. Stamp round-trips in **both** backend modes (P0-A regression guard).

## Acceptance Criteria

### Functional

- [ ] All 6 trigger sites drive enrichment via Mastra when stamp=`mastra`; automation (via `/api/enrich`) included.
- [ ] **P0-A**: `job.options.engine` round-trips create→read in both backend modes; projected into `GET /api/jobs/[id]`.
- [ ] **Parity oracle + request-counter assertions** pass on the golden corpus.
- [ ] Callback contract enforced: `.strict()` discriminated union; accept iff stamp=`mastra` AND `runId===currentRunId`; monotonic per-step; error-dedup; bounded payload; unknown step→400; unknown job/stale runId→2xx drop; `artifactsDelta` closed-key+trusted-host validated.
- [ ] Per-STEP callbacks only (≤~14/job); translation `completed` carries aggregated `languageResults`.
- [ ] Partial-language: step `completed`, per-lang `failed` recorded, job not failed. `.foreach` non-short-circuit verified.
- [ ] `scene_analysis` artifact-only (no step callback); audio_cleanup non-fatal; "not requested"→`skipped`.
- [ ] mux_upload fatal-after-side-effect.
- [ ] Rerun re-stamps (merge), forces re-transcription, prunes same keys (incl. `muxSync`); recovery skip is `languageResults===completed AND artifact verifies`, falling closed.
- [ ] Async: non-2xx ack→`failed`; `dispatchedAt`+`runId` visible pre-first-callback; two calibrated watchdogs.
- [ ] Engine flag readable/settable via bearer API; automated rollback uses it, not a console.

### Non-Functional

- [ ] **P0-B**: job-write is DB-atomic (txn/CAS); proven race-safe with 2 concurrent callbacks for one job.
- [ ] Global cross-engine concurrency ceiling during ramp; app-level 429 retry; `rate_limited` discriminant so quota-degraded coverage fails parity.
- [ ] Rollback: flag flip affects new jobs within LD-stream window; in-flight unaffected; seconds-level in Phase 1.
- [ ] New env vars `.optional()` (Mastra: + `assertMastraRuntimeEnv` prod-gate; Manager: t3-env, runtime fallback). Receiver-first deploy, curl-verified 503→401. **Callback/trigger CSVs outlive the last mastra-stamped job** (not removed on flag rollback — security M1).
- [ ] R-SSE resolved per verified instance count (polling floor if >1).
- [ ] Plain-string logs.

### Quality Gates

- [ ] Phase-0.5 primitives spike green before parity harness is trusted.
- [ ] Parity harness non-vacuous (min sample, empty/unauth fails loud).
- [ ] Per-branch tests use real typed shapes; ≥1 per branch where only it matches; fixture-tested callback contract lockstep across manager/mastra.
- [ ] Output-shape contract property tests over malformed/partial job records (not just idempotence reflexivity).
- [ ] Real-system smoke deletion gate before Phase 2: Studio run → Admin record persisted → read back via job-detail path.
- [ ] **Tier-2 `/ce-code-review` mandatory** before push (cross-app auth, data write-back, migration).

## Success Metrics

- `apps/manager` has no `workflow` dep / directives (Phase 2 grep clean); Mastra is the sole engine; Studio shows runs with per-step traces.
- Per-video LLM/Mux cost + latency within parity band of the Phase-0 baseline; **no Admin-write amplification** (≤~14 callbacks/job).
- Zero stuck-`pending`; recovery re-drives without duplicate provider spend.
- Documented rollback exercised in staging.

## Dependencies & Prerequisites

- P0-A/B/C are prerequisites, not phases — they gate everything.
- Mastra: own Mux + S3 (same bucket/keys) + OpenRouter clients; boot-recovery backstop; `MASTRA_ENRICHMENT_API_KEYS`.
- Manager: callback endpoint + `ENRICHMENT_CALLBACK_API_KEYS` + disjointness invariant + rate-limit; `@forge/feature-flags` registry entry; engine-flag API; redispatch; watchdogs; recovery sweep.
- WAF passthrough inherited from existing manager→admin/web→admin `Authorization` usage — no fresh probe.
- **Investigate first**: Manager Railway replica count (R-SSE/R-S3 blast radius); old-engine World (`printenv`).

## Risk Analysis & Mitigation

| #            | Risk                                                                | Sev          | Mitigation                                                                              |
| ------------ | ------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| R-STAMP      | Stamp write-only on read (P0-A) → entire gate/drain non-functional  | **Critical** | Fix `toJobRecord`; both-mode round-trip test                                            |
| R-ATOMIC     | Per-process lock → cross-instance callbacks lose writes (P0-B)      | **Critical** | DB txn/CAS step-merge; lock demoted to coalescer                                        |
| R-FENCE      | Zombie callback from a not-dead old run corrupts new run            | **Critical** | runId fencing token on callback gate (= claim write)                                    |
| R-AUTHZ      | Callback bearer authorizes caller-class not job; artifact poisoning | **Critical** | runId fence + closed-key `artifactsDelta` + bounded payload + disjointness + rate-limit |
| R-DUR        | No durable resume on Railway (BOTH engines — correction #1)         | High         | Recovery sweep + idempotent skip + job-record checkpoint; verify World in prod          |
| R-SSE        | Multi-instance live UI silently freezes (regression)                | High         | Polling = correctness floor; verify instance count                                      |
| R-START      | `void start()` stuck-`pending`                                      | High         | Sync ack + 2 calibrated watchdogs                                                       |
| R-PROV       | Dual-engine shares LLM quota → 429 storm degrades coverage silently | High         | Global ceiling; app 429 retry; `rate_limited` discriminant                              |
| R-PRIMITIVES | `.parallel`/`.foreach`/nested-wf greenfield in apps/mastra          | High         | Phase-0.5 spike incl. fatal-branch-cancellation                                         |
| R-RERUN      | Idempotent-skip would no-op a provider-switch rerun                 | Med          | Transcribe forces on rerun; skip only on recovery                                       |
| R-DRAIN      | No drain query; wedged jobs block Phase 2 forever                   | Med          | P0-C filtered query + staleness cutoff + force-terminal runbook                         |
| R-PHASE      | Removing dep too early kills rollback                               | High         | Two-phase; Phase 2 gated on drain                                                       |
| R-ENV        | Required env var bricks Railway deploy                              | Med          | `.optional()` + prod-assert; receiver-first; env-import-unset test                      |

## Future Considerations

- Move write-back to Mastra→Admin direct REST once proven.
- Promote `options.engine` to a first-class Admin field if drain-by-engine querying gets hot (P0-C client-side filter is the interim).
- Shared cross-engine token-bucket (Redis/PG) if concurrency needs outgrow the job-count ceiling.

## Documentation Plan

Update `apps/manager/CLAUDE.md` + `apps/mastra/CLAUDE.md`; add a cutover runbook (receiver-first env sequence + 503→401 checks, ramp schedule, rollback triggers, drain query with staleness, wedged-job remediation, Phase-2 image-pin); `ce:compound` the durability-cliff + write-only-stamp + per-step-callback learnings; update roadmap feat-031.

## Sources & References

### Origin

- [docs/brainstorms/2026-05-28-manager-enrichment-mastra-consolidation-requirements.md](docs/brainstorms/2026-05-28-manager-enrichment-mastra-consolidation-requirements.md) — consolidate; all-4-pipelines single cutover; Mastra→Manager callback; runtime flag + stamp; parity-first.

### Internal (highest authority)

- `apps/manager/src/workflows/{videoEnrichment,launchVideoEnrichment,jobStateSteps,transcriptOnlyPipeline,sceneAnalysisPipeline}.ts`; `next.config.ts`
- `apps/manager/src/lib/{state.ts (toJobRecord L263, jobUpdateLocks L655, doUpdateStepStatus L701-734),job-events.ts,workflow-steps.ts,admin-trigger-auth.ts,admin-trigger-route.ts}`; `src/types/job.ts`; `src/services/{storage,mux,mux-sync,transcription,audioCleanup,subtitleTranslation,mastra-transcript-embeddings}.ts`; `src/backend/admin-client.ts`
- `apps/mastra/src/mastra/{index.ts,workflows/transcript-embedding.ts,workflows/scene-embedding.ts}`; `src/services/admin-embedding-ingest-client.ts`; `src/server/service-bearer.ts`; `src/config/env.ts`
- `apps/admin/src/services/manager-job.service.ts`; `apps/admin/src/graphql/types/managerJob.ts`; `apps/admin/prisma/schema.prisma`
- `packages/feature-flags/src/{launchdarkly.ts,registry.ts,index.ts}` (reuse for the engine flag)
- Solutions: `mastra-embedding-workflow-ownership-pattern`, `local-embed-pipeline-pattern-20260429`, `admin-manager-enrichment-trigger-endpoint-20260506`, `bearer-as-passport-multi-csv-composition-20260518`, `parity-harness-prod-gate-defects-20260514`, `test-first-regression-snapshot-byte-identical-default-20260429`, `branched-orchestrator-opt-in-mode-pattern-20260429`, `backfill-worker-pattern-manager-20260407`, `outbound-timeout-shorter-than-caller-budget-20260506`, `in-memory-slot-reservation-fire-and-forget-20260506`, `mocked-shape-vs-real-contract-discipline-20260506`, `idempotence-property-test-vacuous-on-malformed-fixed-point-20260528`, `required-env-var-without-default-broke-railway-deploy-20260511`, `railway-logsv2-silences-nextjs-stdout-runtime-20260518`, `mastra-studio-api-auth-guard`, `manager-job-read-model-source-language-metadata-20260409`, `mastra-eval-workflow-local-dev-contracts`
- Plans: `docs/plans/2026-04-22-001-feat-031-manager-workflow-durability-plan.md`, `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md` (R10 = this work)

### External

- Mastra 1.36: [workflows overview](https://mastra.ai/docs/workflows/overview), [control-flow](https://mastra.ai/docs/workflows/control-flow), [error-handling](https://mastra.ai/docs/workflows/error-handling), [snapshots](https://mastra.ai/docs/workflows/snapshots), [streaming events](https://mastra.ai/docs/streaming/events), [custom API routes](https://mastra.ai/docs/server/custom-api-routes)
- Vercel `workflow`: [docs](https://vercel.com/docs/workflows), [start()](https://workflow-sdk.dev/v5/docs/api-reference/workflow-api/start), [self-host World](https://workflow-sdk.dev/v5/docs/deploying/building-a-world)
- LaunchDarkly v9: [flag changes/streaming](https://launchdarkly.com/docs/sdk/features/flag-changes), [resilience/waitForInitialization](https://launchdarkly.com/docs/tutorials/sdk-resilience-best-practices)
- Cutover/parity: [Cloudflare Workflows v2](https://blog.cloudflare.com/workflows-v2/), [Temporal idempotency](https://temporal.io/blog/idempotency-and-durable-execution), [strangler-fig validate-before-cutover](https://www.webstackbuilders.com/articles/strangler-fig-migration-complete-guide)

### Related Work

- Mastra migration series feat-132/133/134/135; roadmap feat-031.
