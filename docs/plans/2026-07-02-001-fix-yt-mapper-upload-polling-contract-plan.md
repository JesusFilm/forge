---
title: "YT Mapper Upload Polling Contract - Plan"
type: "fix"
date: "2026-07-02"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# YT Mapper Upload Polling Contract - Plan

## Goal Capsule

| Field             | Value                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective         | Make `/match-jobs` work for common raw and multipart video uploads, and make completed empty results terminal for polling clients.                                                        |
| Authority         | Production investigation from Railway logs and smoke repro; `apps/yt-video-mapper-backend` API contract; existing route and service tests.                                                |
| Execution profile | Small production bug fix with a public API boundary.                                                                                                                                      |
| Stop conditions   | Stop if the complete response shape is found to be consumed by an incompatible in-repo caller, or if multipart support requires changing upload storage semantics beyond request parsing. |
| Tail ownership    | `ce-work` implements; `ce:review` reviews the final diff; smoke test verifies raw, multipart, and empty-complete polling behavior.                                                        |

---

## Product Contract

### Summary

The yt-mapper API should accept the two upload shapes clients naturally use: raw media bytes and `multipart/form-data` with a file/media part.
Polling should expose a terminal completion signal even when the candidate list is empty, so clients do not mistake a successful no-match result for an in-progress job.

### Problem Frame

Production logs showed jobs processing successfully while a Python client continued polling until its own timeout.
The API returned `{"candidates":[]}` for complete no-match jobs, which is terminal for a candidate-aware client but ambiguous for status-based clients.
A separate reproduction showed multipart uploads can turn a would-be match into zero candidates because the server hashed the multipart envelope rather than the enclosed video bytes.

### Requirements

**Upload ingestion**

- R1. `/match-jobs` continues to accept raw request bodies as media bytes with the request `Content-Type`.
- R2. `/match-jobs` accepts `multipart/form-data` and extracts the first file or media part as the uploaded media payload.
- R3. Multipart requests without a usable file/media part, including malformed multipart parser failures, fail with a safe 400 error instead of creating a queued job from form metadata.

**Polling contract**

- R4. Complete jobs return an explicit terminal response containing `jobId`, `status: "complete"`, and `candidates`, including when `candidates` is empty.
- R5. Queued, running, failed, and expired responses keep their existing terminal or in-progress status envelope semantics.
- R6. Public candidate objects still expose only `coreId`, `videoVariantId`, `confidence`, and `matchStrength`.

**Verification and operation**

- R7. Regression coverage proves raw upload behavior, multipart upload behavior, malformed multipart rejection, and complete empty-result polling.
- R8. Documentation tells callers that both raw bytes and multipart uploads are supported and that complete polls include terminal status.
- R9. A smoke test exercises raw upload, multipart upload, and complete empty-result polling after implementation.

### Acceptance Examples

- AE1. Given a multipart request with a `video/mp4` file part containing bytes that match an indexed structural signature, when the job is processed, then the API returns the same candidate as a raw `video/mp4` upload of those bytes.
- AE2. Given a multipart request with only a text field, when creating a match job, then the API returns a 400 safe error and does not create a queued job from the form body.
- AE3. Given a complete job with no candidates, when polling `/match-jobs/:id`, then the response includes `jobId`, `status: "complete"`, and `candidates: []`.
- AE4. Given a malformed multipart request, when creating a match job, then the API returns `{ error: "invalid_multipart_upload" }` with status 400 and does not create a job.

### Deferred to Follow-Up Work

- Real perceptual video/audio matching for re-encoded or clipped videos remains outside this fix.
- Production deployment and production smoke after merge are separate from this local formal pipeline unless explicitly requested.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Use a maintained multipart parser at the route boundary. `@fastify/busboy` should own multipart parsing rather than a hand-rolled boundary scanner, because this endpoint accepts user-supplied HTTP bodies.
- KTD2. Keep upload storage and matching services unaware of multipart. The route normalizes request shapes to `{ bytes, contentType }`, and `MatchJobService.createUploadJob` remains the single job creation boundary.
- KTD3. Make complete status additive. Returning `jobId` and `status: "complete"` alongside `candidates` preserves the existing candidate array field while making status-based clients terminate correctly.

### Existing Patterns

- `apps/yt-video-mapper-backend/src/routes/match-jobs.ts` already maps `SafeMatchJobError` to safe 400 responses.
- `apps/yt-video-mapper-backend/src/services/match-job.service.ts` already returns status envelopes for queued, running, failed, and expired jobs.
- `apps/yt-video-mapper-backend/src/routes/match-jobs.test.ts` already has route-level coverage using in-memory services and a real deterministic matcher fixture.
- `apps/yt-video-mapper-backend/src/services/match-job.service.test.ts` owns service-level job result shape expectations.

### Assumptions

- External clients can tolerate the additive complete fields because `candidates` remains present at the top level.
- Local smoke through the route/server boundary is sufficient before merge; production smoke requires the change to be deployed.

---

## Implementation Units

### U1. Normalize raw and multipart uploads

- **Goal:** Make `/match-jobs` extract raw media bytes from either direct body uploads or multipart file/media parts.
- **Requirements:** R1, R2, R3, R7, AE1, AE2
- **Dependencies:** None
- **Files:** `apps/yt-video-mapper-backend/src/routes/match-jobs.ts`, `apps/yt-video-mapper-backend/src/routes/match-jobs.test.ts`, `apps/yt-video-mapper-backend/package.json`, `pnpm-lock.yaml`
- **Approach:** Add `@fastify/busboy` as a direct backend dependency. Keep the existing max request size read, then parse multipart bodies into the first file/media part before calling `createUploadJob`. Throw `SafeMatchJobError("invalid_multipart_upload")` for multipart bodies without an upload part.
- **Execution note:** Start from route-level failing tests that prove multipart matching and safe rejection before implementation.
- **Patterns to follow:** Existing safe error mapping in `createJob`; existing real matcher route test fixture.
- **Test scenarios:** Multipart `video/mp4` file part with bytes `[1,2,3,4]` returns the known structural-signature candidate after manual process. Multipart form with only a text field returns `{ error: "invalid_multipart_upload" }` with status 400. Malformed multipart returns `{ error: "invalid_multipart_upload" }` with status 400. Existing raw upload tests still pass.
- **Verification:** Route tests pass, typecheck accepts the parser import and callbacks, and lint catches no new formatting or unused code issues.

### U2. Make complete polling responses explicit

- **Goal:** Completed jobs should be unambiguous terminal states for clients that poll by `status`.
- **Requirements:** R4, R5, R6, R7, AE3
- **Dependencies:** None
- **Files:** `apps/yt-video-mapper-backend/src/services/match-job.service.ts`, `apps/yt-video-mapper-backend/src/services/match-job.service.test.ts`, `apps/yt-video-mapper-backend/src/routes/match-jobs.test.ts`
- **Approach:** Update the `MatchJobResult` complete variant and `getJobResult` complete branch to include `jobId` and `status: "complete"` while preserving `candidates`. Update route and service tests that own completed response shape, including an explicit empty-candidate case.
- **Execution note:** Treat this as a public API contract fix; prefer additive assertions over removing existing candidate shape checks.
- **Patterns to follow:** Existing status envelopes for failed and expired jobs in `getJobResult`.
- **Test scenarios:** Complete job with candidates returns `{ jobId, status: "complete", candidates: [...] }`. Complete job with no candidates returns `{ jobId, status: "complete", candidates: [] }`. JSON does not expose evidence fields. Queued, expired, failed, and unknown-job responses remain unchanged.
- **Verification:** Service tests and route tests pass against the new terminal complete shape.

### U3. Document and smoke-test the API contract

- **Goal:** Make the caller-facing behavior clear and prove it through a local smoke run.
- **Requirements:** R8, R9
- **Dependencies:** U1, U2
- **Files:** `apps/yt-video-mapper-backend/README.md`, optional smoke script or inline smoke command output in the final report
- **Approach:** Update README matching notes to say `/match-jobs` accepts raw bytes and multipart file/media parts, and that completed polls include `status: "complete"`. Run a smoke test that submits raw and multipart uploads through the route/server boundary, verifies raw and multipart candidate parity with a valid tiny media payload when a local generator is available, and polls a complete empty result.
- **Execution note:** If a live local server requires unavailable database setup, run the smoke in-process against `createHandleRequest` with the same route and service wiring used by tests, and state that production smoke still requires deploy.
- **Patterns to follow:** Existing README matching and smoke sections.
- **Test scenarios:** Smoke output shows raw upload creates and completes, multipart upload creates and completes with the same candidate set for a valid media payload, and empty candidate completion returns terminal `status: "complete"`.
- **Verification:** README is updated and smoke result is recorded in the phase summary.

---

## Verification Contract

| Gate                                                                                                                        | Applies to | Done signal                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @forge/yt-video-mapper-backend test -- src/routes/match-jobs.test.ts src/services/match-job.service.test.ts` | U1, U2     | Focused route/service regressions pass.                                                                                                           |
| `pnpm --filter @forge/yt-video-mapper-backend test`                                                                         | U1, U2, U3 | Full backend suite passes.                                                                                                                        |
| `pnpm --filter @forge/yt-video-mapper-backend typecheck`                                                                    | U1, U2     | Strict TypeScript accepts the API shape and parser dependency.                                                                                    |
| `pnpm --filter @forge/yt-video-mapper-backend lint`                                                                         | U1, U2, U3 | ESLint/Prettier pass.                                                                                                                             |
| `pnpm --filter @forge/yt-video-mapper-backend build`                                                                        | U1, U2     | Production build accepts dependency and generated Prisma copy.                                                                                    |
| Local smoke                                                                                                                 | U1, U2, U3 | Raw, multipart, and complete-empty polling responses show terminal behavior; raw and multipart known-match uploads return the same candidate set. |

---

## Definition of Done

- U1 is done when multipart uploads feed the matcher the part bytes, malformed multipart uploads return a safe 400, and raw upload behavior is unchanged.
- U2 is done when complete polling responses are explicit terminal envelopes for both non-empty and empty candidate lists.
- U3 is done when README reflects the contract and a smoke test confirms the behavior.
- The full backend verification contract passes.
- The final diff contains no abandoned parser experiments or unrelated refactors.
