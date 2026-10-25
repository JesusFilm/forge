---
title: "fix: Harden transcription routing source host redaction"
type: fix
status: completed
date: 2026-04-12
branch: fix/manager-transcription-routing-contract
related_todos:
  - todos/002-pending-p2-sanitize-transcription-routing-source-url.md
related_docs:
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
---

# fix: Harden transcription routing source host redaction

## Overview

The `sourceInputUrl` redaction fix still leaves a bypass through
`sourceInputHost`. `setTranscriptionRoutingReport()` trusts caller-supplied
`sourceInputHost` verbatim, and `getTranscriptionRoutingReport()` returns any
persisted non-empty `sourceInputHost` string. A future caller or malformed
legacy artifact can therefore persist and render a full URL, credentials, query
string, or source object path under the host field.

## Problem Statement

This is a privacy/security bug in the transcription routing artifact boundary.
The canonical field name says `sourceInputHost`, but the code currently treats
it as an arbitrary display string. The user-facing browser smoke proved the
leak: a fixture with
`sourceInputHost: "https://host-user:host-secret@host.example.com/private/host-video.mp4?hostToken=456#host-note"`
rendered that raw value in the manager job page.

## Research Findings

Local patterns:

- `apps/manager/src/lib/transcription-routing-report.ts` already normalizes
  legacy `sourceInputUrl` into host-only provenance. Reuse that boundary, but
  apply it to both `sourceInputUrl` and `sourceInputHost`.
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
  says manager job pages should project persisted artifact truth through a
  shared read boundary.
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
  reinforces careful handling of persisted external-service state and operator
  UI surfaces.

External references:

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html):
  sanitize event data and avoid exposing sensitive data in operational records.
- [AWS presigned URL best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html):
  presigned URLs are signed requests and can carry sensitive query parameters.
- [Amazon S3 presigned URL query auth](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html):
  presigned access data is transmitted through query parameters such as
  credential and security-token parameters.

## Proposed Solution

Add a strict source-host normalizer and use it on both read and write:

- Accept bare hostnames such as `cdn.example.com`.
- Accept full URLs only as legacy/transport input, parse them, and return
  `url.host`.
- Reject values containing paths, query strings, fragments, whitespace, or
  credential-like text when they are not parseable as a URL.
- Prefer deriving `sourceInputHost` from `sourceInputUrl` when both are present
  and the host field is invalid.
- Keep the UI simple: it should render only the normalized
  `report.sourceInputHost`, never sanitize raw strings itself.

## Implementation Plan

### Unit 1: Red Tests

- Add a test in
  `apps/manager/src/lib/transcription-routing-report.test.ts` where
  `setTranscriptionRoutingReport()` receives a raw full URL through
  `sourceInputHost`.
- Assert persisted `artifacts.transcriptionRouting.data.sourceInputHost` is
  `host.example.com`, not the raw URL.
- Add a legacy read test where a persisted artifact has raw
  `data.sourceInputHost`; assert `getTranscriptionRoutingReport()` returns only
  the host.
- Add a malformed-host test that drops values such as
  `internal/path?token=123` rather than rendering them.

### Unit 2: Green Implementation

- Replace `readSourceInputHost()` with a helper that normalizes both URL and
  host-like inputs.
- In `getTranscriptionRoutingReport()`, read `sourceInputHost` through the
  strict normalizer before falling back to legacy `sourceInputUrl`.
- In `setTranscriptionRoutingReport()`, normalize `sourceInputHost` and
  `sourceInputUrl` before writing.
- Keep `TranscriptionRoutingReport` public output host-only.

### Unit 3: User-Facing Smoke

- Use a temporary fixture route rendering `LiveJobStepsTable` with a malicious
  raw `sourceInputHost`.
- Expand Transcription and assert:
  - visible text includes `Source host: host.example.com`
  - visible text excludes `host-secret`, `hostToken=456`,
    `/private/host-video.mp4`, and the raw URL
- Re-check collapsible alignment for Transcription, Translation, and Mux Upload.
- Save a screenshot under `output/playwright/`, then remove the temporary route.

## Acceptance Criteria

- [x] `sourceInputHost` cannot persist a full URL, credentials, query string, or
      source path
- [x] Legacy artifacts with raw `sourceInputHost` are normalized or ignored
- [x] UI renders only host-only provenance
- [x] Existing `sourceInputUrl` legacy behavior remains safe
- [x] Red/green tests cover write and read behavior
- [x] Browser smoke passes with malicious `sourceInputHost`
- [x] `pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts`
- [x] `pnpm --filter @forge/manager lint`
- [x] `pnpm --filter @forge/manager typecheck`
- [x] `git diff --check`

## Risks

- Overly strict host validation could drop benign hostnames with ports. Include
  tests for `cdn.example.com:443` if port-bearing host provenance is allowed.
- Keeping `sourceInputUrl` in the writer parameter as a migration/transport
  convenience can invite future misuse. Consider splitting transport
  normalization from the persisted writer in a follow-up if the helper is used
  by workflow code.

## Smoke Evidence

Resolved browser smoke:

- Screenshot:
  `output/playwright/collapsible-step-row-smoke.png`
- Passed assertions:
  `Source host: host.example.com` was visible after expanding Transcription,
  while `host-secret`, `hostToken=456`, and `/private/host-video.mp4` were not
  visible. The same smoke also expanded Translation, Mux Upload, and Embeddings
  and checked the padded detail content alignment against the step title and
  chevron column.

Prior failing smoke:

- Screenshot:
  `output/playwright/workflows-review-source-host-smoke.png`
