---
title: "Manager transcription routing: artifact-backed detail panels and host-only provenance"
category: integration-issues
module: Manager
date: 2026-04-12
problem_type: integration_issue
component: workflow_artifact
symptoms:
  - "The manager job detail page added a transcription provider detail panel before the active workflow persisted a matching transcriptionRouting artifact"
  - "Routing metadata could persist or render raw source URL data through sourceInputUrl or sourceInputHost"
  - "Secondary job-step details were split across bespoke rows instead of sharing the Embeddings disclosure pattern"
root_cause: contract_drift
resolution_type: code_fix
severity: medium
tags:
  - manager
  - transcription
  - job-artifacts
  - redaction
  - operator-ui
  - accessibility
affected_components:
  - apps/manager/src/lib/transcription-routing-report.ts
  - apps/manager/src/features/jobs/live-job-steps-table.tsx
  - apps/manager/src/features/jobs/collapsible-step-row.tsx
  - apps/manager/src/workflows/videoEnrichment.ts
  - apps/manager/src/services/transcription.ts
related_docs:
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# Manager transcription routing: artifact-backed detail panels and host-only provenance

## Problem

The manager job page gained a transcription provider detail block while the
active workflow did not yet guarantee a matching `artifacts.transcriptionRouting`
producer. That made the UI contract easy to drift from persisted job truth.

The same path also carried source media provenance. Keeping raw URLs in job
artifacts is unsafe because signed URLs and internal object paths can include
credentials, query tokens, storage layout, or source naming details. A field
called `sourceInputHost` still has to be treated as untrusted because callers
and legacy artifacts can put full URLs there.

## Root Cause

The UI and artifact boundary evolved separately:

- the job table rendered provider details directly from a new artifact shape
- the workflow initially persisted only transcript and subtitle downloadables
- the report writer accepted transport-oriented URL fields as durable metadata
- the detail rows for Transcription, Translation, Mux Upload, and Embeddings
  used separate disclosure mechanics

This created both contract drift and a privacy boundary issue.

## Solution

Keep transcription routing as workflow-owned artifact state, then make the
reader/writer boundary the only place that normalizes sensitive provenance.

The routing helper should:

1. accept full URLs only as transport or legacy input
2. derive and persist at most `sourceInputHost`
3. normalize both `sourceInputUrl` and `sourceInputHost` before read or write
4. reject malformed host strings with paths, queries, fragments, credentials,
   or whitespace
5. return a display-safe report so the UI does not need its own redaction logic

The job table should consume that parsed report and render only host-level
provenance, for example `Source host: host.example.com`.

For secondary step detail UI, extract shared disclosure chrome into a
presentation component. Keep job-artifact parsing in the table layer, but let a
single row component own:

- artifact link click propagation
- the status glyph, retry pill, and chevron button
- native disclosure button semantics with `aria-expanded` and `aria-controls`
- detail-row padding/alignment

## Verification

Use both contract tests and a user-facing browser smoke:

- report tests prove raw URLs do not persist through either `sourceInputUrl` or
  `sourceInputHost`
- workflow/service tests prove routing metadata is produced with the
  transcription result
- browser smoke expands Transcription, Translation, Mux Upload, and Embeddings
  and checks that only the sanitized host is visible
- alignment checks compare the first inner detail element to the step title and
  chevron column, not the outer padded wrapper

Commands used on the resolved branch:

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
git diff --check
```

## Prevention

1. Do not add operator-facing job-detail panels unless the same branch owns the
   durable producer or intentionally gates the panel behind existing state.
2. Treat every artifact field that came from a URL or external storage locator
   as untrusted at both read and write time.
3. Persist only the minimum provenance operators need; prefer host-only values
   over paths and signed URLs.
4. Keep redaction at the artifact helper boundary so future UI components cannot
   accidentally re-render raw legacy data.
5. Reuse shared disclosure components for new job-step detail blocks so
   accessibility semantics and alignment do not drift.

## Related References

- [Manager job read model source-language metadata](./manager-job-read-model-source-language-metadata-20260409.md)
- [Manager Mux subtitle override recovery](./manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md)
- [Manager embeddings additive artifact contract](./manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md)
- [Roadmap: AI Video Enrichment Pipeline](../../roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
