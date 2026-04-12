---
title: "fix: Manager transcription routing contract"
type: fix
status: completed
date: 2026-04-12
branch: fix/manager-transcription-routing-contract
related_todos:
  - todos/001-pending-p2-wire-transcription-routing-source-of-truth.md
  - todos/002-pending-p2-sanitize-transcription-routing-source-url.md
related_docs:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
---

# fix: Manager transcription routing contract

## Overview

Address two P2 review findings from the manager job page collapsible step refactor:

1. The new transcription detail panel reads `artifacts.transcriptionRouting`, but this branch does not write that artifact anywhere.
2. `setTranscriptionRoutingReport` can persist `sourceInputUrl` verbatim, and the job page currently renders that URL.

The recommended fix is to keep `transcriptionRouting` as the durable artifact source of truth, add a small current-provider producer for the existing Mux-only transcription flow, and remove raw URL persistence/display from the routing report. Do not pull in the full historical ElevenLabs/rerun feature in this review follow-up.

## Problem Statement

The job page now has a shared collapsible step row and uses it for secondary detail blocks. That is correct for Mux Uploads, translation failures, and Embeddings because their detail data already comes from real persisted job state.

The transcription panel is different. It reads `artifacts.transcriptionRouting` in `apps/manager/src/features/jobs/live-job-steps-table.tsx`, but the active workflow in `apps/manager/src/workflows/videoEnrichment.ts` only persists transcript/subtitle downloadables after `stepTranscribe`. That leaves the panel as future-only UI.

The redaction finding is separate but coupled: the new helper accepts `sourceInputUrl` and stores the report object as-is. Signed media URLs, credential-bearing URLs, and query-bearing source URLs must be treated as ephemeral transport, not durable job metadata.

## Proposed Solution

Keep `artifacts.transcriptionRouting` as the canonical routing artifact because it matches the existing artifact-backed patterns for `muxSync`, `embeddingSync`, and `sceneEmbeddingSync`. Avoid moving this into `steps[].details` because `JobStepDetails` currently only normalizes translation `languageResults`, and widening it would create a second source-of-truth shape for provider history.

For this branch, make the producer intentionally small:

- `transcribe()` returns `resolvedProvider: "mux"` and a compact `routingReport` for the existing Mux path.
- `runVideoEnrichment()` merges `setTranscriptionRoutingReport({}, transcription.routingReport)` with the transcript/subtitle artifact manifest after transcription succeeds.
- Jobs created before this change simply do not show the transcription routing detail block.
- `sourceInputUrl` is not persisted or rendered raw. If any diagnostic provenance is retained, store a display-safe field such as `sourceInputHost`; otherwise drop the field entirely.

This makes the UI honest without expanding scope into ElevenLabs routing, rerun routes, provider secrets, or downstream artifact reset semantics.

## Scope Boundaries

In scope:

- Add a real `transcriptionRouting` producer for the current Mux transcription path.
- Sanitize transcription routing metadata before persistence.
- Remove raw `sourceInputUrl` rendering from the transcription detail UI.
- Add red/green tests for both review findings.
- Run a user smoke test on the manager job detail page.
- Keep the existing shared `CollapsibleStepRow` refactor intact.

Out of scope:

- Full ElevenLabs transcription provider integration.
- Transcription rerun buttons or rerun API routes.
- Backfilling old jobs that do not have `transcriptionRouting`.
- Persisting source media URLs for future provider use.
- Adding React Testing Library or a jsdom component test stack to `apps/manager`.
- CMS schema changes or GraphQL codegen.

## Implementation Plan

### Unit 1: Sanitize routing metadata before write

Red:

- Update `apps/manager/src/lib/transcription-routing-report.test.ts`.
- Add a test that calls `setTranscriptionRoutingReport({}, report)` with a raw URL like `https://user:secret@cdn.example.com/video.mp4?token=123#note`.
- Assert the persisted `artifacts.transcriptionRouting.data` does not contain the raw `sourceInputUrl`, credentials, query string, or fragment.
- If the chosen retained field is `sourceInputHost`, assert it equals `cdn.example.com`.
- Add a legacy read test for an older artifact that still has `sourceInputUrl`; `getTranscriptionRoutingReport` must not return the raw URL.

Green:

- Add a small normalization helper in `apps/manager/src/lib/transcription-routing-report.ts`, such as `sanitizeTranscriptionRoutingReportForPersistence`.
- Prefer host-only provenance by reusing the local privacy pattern in `apps/manager/src/lib/video-sources.ts` when practical, or drop the source field when parsing fails.
- Update `TranscriptionRoutingReport` in `apps/manager/src/types/job.ts` so the public shape does not encourage raw URL rendering. Prefer `sourceInputHost?: string` over `sourceInputUrl?: string`.

Refactor:

- Keep the read helper tolerant of legacy `sourceInputUrl` artifacts so old records do not crash the page.
- Avoid making URL redaction a UI concern; the UI should receive only sanitized metadata.

### Unit 2: Add the missing producer for transcription routing

Red:

- Update `apps/manager/src/services/transcription.test.ts` so the existing Mux success case expects:
  - `resolvedProvider: "mux"`
  - `routingReport.finalProvider: "mux"`
  - one completed attempt with `requestedProvider: "automatic"` and `resolvedProvider: "mux"`
  - `routingReport.finalSourceLanguageCode` matching the resolved track language.
- Update `apps/manager/src/workflows/videoEnrichment.test.ts` with a focused assertion that a successful transcription step persists `artifacts.transcriptionRouting` along with `transcript` and `subtitles`.

Green:

- Extend `TranscriptionResult` in `apps/manager/src/services/transcription.ts` with `resolvedProvider` and `routingReport`.
- Build a compact Mux routing report in the Mux success path. The report should describe current truth only, for example:

```ts
{
  attempts: [{
    attemptId: "...",
    requestedProvider: "automatic",
    resolvedProvider: "mux",
    status: "completed",
    sourceLanguageCode: result.language,
    decisionReason: "Automatic routing used Mux.",
    startedAt: "...",
    finishedAt: "..."
  }],
  finalProvider: "mux",
  finalSourceLanguageCode: result.language
}
```

- In `apps/manager/src/workflows/videoEnrichment.ts`, merge the routing artifact into `artifactManifest` immediately after the successful transcription result, before marking the transcription step complete.

Refactor:

- If report construction starts to sprawl, extract only a tiny builder in `transcription-routing-report.ts`.
- Do not reintroduce historical ElevenLabs code paths unless a separate plan/ticket explicitly expands scope.

### Unit 3: Make the UI display only sanitized transcription details

Red:

- Rely on Unit 1 tests to prove raw URL data cannot reach the parsed report.
- Add a narrow testable helper only if the existing JSX logic becomes hard to reason about in `apps/manager/src/features/jobs/live-job-steps-table.tsx`.

Green:

- Remove the `Source input URL:` rendering block from `LiveJobStepsTable`.
- If `sourceInputHost` is retained, render it as non-sensitive provenance copy such as `Source host: stream.mux.com`.
- Keep transcription details collapsed by default. Continue to auto-open Embeddings only when its existing issue heuristics say to do so.
- Keep older jobs without `transcriptionRouting` hidden: no empty transcription detail row.

Refactor:

- Keep `CollapsibleStepRow` presentation-only. It should not parse job artifacts or know the routing schema.

### Unit 4: PR and workflow hygiene

- Continue on `fix/manager-transcription-routing-contract`, which now satisfies the repo branch convention.
- Keep this PR scope to `apps/manager` plus the plan/review todo bookkeeping.
- If this review follow-up is not already attached to the current PR's roadmap/plan context, create or attach an appropriate `docs/roadmap/media-generation/feat-NNN-*.md` ticket before implementation.
- Use PR title `fix(manager): repair transcription routing contract`.
- Fill the PR template and include this plan path in Notes.
- Do not skip hooks with `--no-verify`.

## Acceptance Criteria

- [x] The transcription detail panel is backed by a real `transcriptionRouting` producer in the active manager workflow.
- [x] The routing report for the current Mux transcription path records final provider, resolved source language, and at least one attempt.
- [x] `setTranscriptionRoutingReport` never persists raw credential-bearing or query-bearing `sourceInputUrl` values.
- [x] The job page never renders a raw source URL or source path in the transcription detail block.
- [x] Existing jobs without `transcriptionRouting` do not show a misleading empty transcription provider panel.
- [x] Mux Upload, Translation, and Embeddings secondary details remain collapsed/expandable through `CollapsibleStepRow`.
- [x] Embeddings keeps its existing issue-driven default expansion behavior.
- [x] Red/Green TDD evidence is captured in the work notes.
- [x] User smoke test evidence is captured in the work notes.

Status note, 2026-04-12: this pass resolved the redaction and producer findings
from `todos/001-pending-p2-wire-transcription-routing-source-of-truth.md` and
`todos/002-pending-p2-sanitize-transcription-routing-source-url.md`. The review
follow-up is attached to the existing in-progress `feat-031` roadmap ticket for
the manager enrichment pipeline.

## Work Notes

- Red source-host tests failed first in
  `pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts`,
  proving raw `sourceInputHost` values persisted and rendered.
- Green implementation normalizes both `sourceInputHost` and legacy
  `sourceInputUrl` at the shared transcription-routing report boundary.
- Subagent Goodall added the Mux-only routing producer in
  `transcribe()` and persisted `artifacts.transcriptionRouting` from
  `runVideoEnrichment()`.
- Subagent McClintock generalized the collapsible row UI for Transcription,
  Translation, Mux Upload, and Embeddings, then the main thread tightened the
  disclosure control to a native button with `aria-expanded` and
  `aria-controls`.
- User-like Playwright smoke used a temporary fixture route, removed before
  final validation, and captured
  `output/playwright/collapsible-step-row-smoke.png`.

## Verification

Run targeted red tests first and confirm they fail before the green implementation:

```bash
pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts
pnpm --filter @forge/manager test -- src/services/transcription.test.ts
pnpm --filter @forge/manager test -- src/workflows/videoEnrichment.test.ts
```

After implementation:

```bash
pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts src/services/transcription.test.ts src/workflows/videoEnrichment.test.ts src/features/jobs/embedding-sync-card.test.ts src/features/jobs/mux-sync-presenter.test.ts
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
git diff --check
```

Before PR, run the broader manager test suite if time allows:

```bash
pnpm --filter @forge/manager test
```

## User Smoke Test

Use a real manager job detail page, not only unit tests.

1. Start or reuse the local manager and CMS dev servers.
2. Create a fresh enrichment job, or use an existing local job record that has transcript/subtitle artifacts and Mux sync comparison data.
3. Open `/dashboard/jobs/<jobId>`.
4. Confirm Transcription, Mux Upload, and Embeddings rows are collapsed by default unless an existing Embeddings issue should auto-open.
5. Expand Transcription and confirm the provider summary is backed by the job's `artifacts.transcriptionRouting` data.
6. Confirm the transcription detail block does not show a raw URL, query string, credential, or internal object-storage path.
7. Expand Mux Uploads and confirm subtitle sync details and override affordances still behave as before.
8. Expand Embeddings and confirm its detail content still matches the previous behavior.
9. Inspect `/api/jobs/<jobId>` and confirm `artifacts.transcriptionRouting.data` contains only sanitized routing metadata.

If local CMS data cannot produce a job with both Mux sync data and transcription routing, document that limitation in the PR notes and smoke the two states separately.

## Risks

- A minimal Mux-only producer could look like a partial ElevenLabs feature. Keep copy and code honest: this change reports current provider truth only.
- Future ElevenLabs work may need an authorized way to reacquire the source media. Do not solve that by persisting signed URLs now.
- If the report shape changes from `sourceInputUrl` to `sourceInputHost`, existing legacy records may still contain the old field. Keep the parser backward-compatible and sanitized.
- Adding DOM test infrastructure would slow this fix and drift from `apps/manager/vitest.config.ts`, which currently runs node-only `src/**/*.test.ts`.

## Research Notes

Local findings:

- `apps/manager/src/workflows/videoEnrichment.ts` persists transcription downloadables but not `transcriptionRouting`.
- `apps/manager/src/lib/transcription-routing-report.ts` currently sanitizes on read but stores the report object verbatim on write.
- `apps/manager/src/app/api/enrich/route.ts` already uses `redactSourceUrlForMetadata` to avoid persisting raw source URLs in materialization metadata.
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md` says read-model fields should project persisted truth through a shared boundary.
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md` says operator UI should not expose actions or state without a real backing producer/state machine.
- `docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md` supports additive artifact evolution when the contract remains explicit.
- `docs/solutions/cms/strapi-enrichment-job-content-type.md` confirms flexible JSON artifacts are the intended durable job-state surface.

External privacy references:

- [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [AWS presigned URL logging best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/logging-interactions.html)
- [Google Cloud signed URLs](https://docs.cloud.google.com/storage/docs/access-control/signed-urls)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

Framework references:

- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [React directives](https://react.dev/reference/rsc/directives)

## Open Questions

Default assumptions are included here so implementation can proceed without blocking if no one overrides them:

- Should routing live in artifacts or `steps[].details`? Default: artifacts.
- Should source provenance be retained at all? Default: host-only if useful, otherwise drop.
- Should older jobs show a transcription provider panel? Default: no.
- Should Mux Upload and Transcription auto-open when secondary data exists? Default: no; keep them collapsed unless a later UX request asks for issue-driven expansion.
