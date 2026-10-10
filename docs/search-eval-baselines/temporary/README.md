# Temporary Search Eval Baselines

This directory is temporary. Delete it when production Admin query embeddings
are healthy and the official production Mastra export/import path is working.

See `DELETE_WHEN_PROD_EMBEDDINGS_WORK.md` for the cleanup trigger.

For now, this directory stores sanitized search-eval baseline export artifacts
while production Admin query embeddings are blocked by the current OpenRouter
key limit.

These files are intended for local development and eval comparison work. They
contain the committed seed queries and saved search results, not raw user trace
data, API keys, bearer tokens, or production database dumps.

## Artifacts

- `prod-seed-baseline-2026-06-02-export.json`
  - Source: production Mastra baseline capture.
  - Baseline: `prod-seed-baseline-2026-06-02`.
  - Report: `f323a47d-0fa9-4936-b936-88a06e906cd5-offline-search-eval-baseline`.
  - Seed cases: `10`.
  - Result counts by seed order: `6, 20, 20, 0, 0, 1, 0, 0, 0, 0`.

- `local-seed-baseline-2026-06-02-export.json`
  - Source: local replay fixture generated from the sanitized production seed
    results, without calling production again.
  - Baseline: `local-seed-baseline-2026-06-02`.
  - Report: `local-seed-baseline-2026-06-02-run-baseline`.
  - Seed cases: `10`.
  - Result counts by seed order: `6, 20, 20, 0, 0, 1, 0, 0, 0, 0`.

## Local Seeding

Run the default local seed command from the repo root:

```bash
pnpm seed:search-eval:prod
```

That imports the production export from this directory and syncs it into local
Mastra-native Evaluation storage. Local Postgres must be running for the native
Dataset, Scorer, and Experiment sync.

For artifact import only, for example when local Postgres is down:

```bash
pnpm seed:search-eval:prod -- --no-native-sync
```

## Cleanup

Delete this whole directory once production Admin query embeddings are healthy
again and a fresh production baseline can be captured through the official
export/import path.

After deleting it, update any local seed shortcut that still points at
`docs/search-eval-baselines/temporary/`.
