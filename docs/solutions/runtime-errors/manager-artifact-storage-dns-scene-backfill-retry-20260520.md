---
title: "Manager artifact storage DNS outage: recover scene embedding backfills with exact retries"
tags:
  - admin
  - embeddings
  - manager-artifacts
  - production-recovery
  - s3
---

# Manager artifact storage DNS outage: recover scene embedding backfills with exact retries

## Symptom

A production scene embedding backfill can finish with a huge `failed`
count even though the embedding/indexing code is mostly healthy. In
the May 2026 prod run, the final report showed `202504` total targets,
`40568` succeeded, `4139` skipped, and `157797` failed. The scary
number came from per-locale outcome fan-out: one transient manager
artifact storage read outage affected many `(videoEdition, locale)`
targets.

## Root Cause

Admin does not own the upstream scene-analysis artifact. The R1 scene
embed workflow reads manager's `{assetId}/scene-analysis.json`, then
admin regenerates text embeddings and writes them to admin Postgres.

When manager artifact storage DNS/transport fails, the workflow cannot
read the shared artifact for a `(video, edition)` group. That single
group-level read failure cascades to every locale in the group as a
failed outcome. This is different from `artifact_missing`, which means
manager has not produced the artifact yet and should remain a skipped
upstream enrichment gap.

## Fix Pattern

Add three operator-safety layers:

1. Run a preflight before scene-including `run-embeds` work:
   admin object storage reachability, manager artifact storage
   reachability, core-id mapping load, and optionally one sample
   scene-analysis artifact read from a retry report.
2. Retry from the previous report with exact
   `(coreId, videoEditionId, locale)` selectors using
   `--pipeline=scene --from-report=<path>`.
3. Keep grouped failure projections in the report so operators can see
   asset/edition/category counts instead of reading every per-locale
   failure.

## Recovery Command

```bash
DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
pnpm --filter @forge/admin run-embeds \
  --pipeline=scene \
  --from-report=.tmp/prod-embeds/prod-scene-report.json \
  --report-out=.tmp/prod-embeds/prod-scene-retry-$(date +%Y%m%d%H%M%S).json
```

Use the production DB URL only when the intent is a production retry.
Do not print DB URLs, Railway tokens, S3 credentials, workflow keys, or
provider keys in logs or reports.

## Read The Result

- `retrySelection.requested`: deduped failed selectors parsed from the
  prior report.
- `retrySelection.matched`: selectors still present in current admin
  enumeration.
- `retrySelection.unmatched`: stale selectors. Default behavior is to
  fail closed so an old report cannot silently under-run.
- `groupedFailures[].category`: the operator action bucket, such as
  `dns_failed`, `timeout`, `access_denied`, `bucket_not_found`,
  `prisma_transaction`, `provider_validation`, `artifact_invalid`, or
  `other`.
- `missingArtifacts`: only upstream artifacts manager has not produced
  yet. These are enrichment-trigger work, not embed retry failures.

## Operational Rule

Do not blindly rerun the full scene corpus after a transient storage
outage. First verify preflight passes, then retry exact failed targets
from the final report. If grouped failures still show storage
transport categories, pause and check Railway/storage health before
starting another long run.
