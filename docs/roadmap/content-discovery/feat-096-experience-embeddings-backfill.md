---
id: "feat-096"
title: "Experience Embeddings Backfill"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-04-21"
duration: 2
depends_on:
  - "feat-095"
blocks:
  - "feat-086"
tags:
  - "cms"
  - "pgvector"
  - "backfill"
  - "experiences"
---

## Problem

Once the experience embedding pipeline (feat-095) ships, only newly-published or updated experiences get embeddings. Every existing published experience in the CMS is still invisible to semantic search until we backfill. Without this backfill, feat-086 (search integration) would launch with zero experiences indexed — the feature would appear broken.

This ticket is the one-shot bulk-embedding operation for existing content, analogous to feat-042 (Scene Embeddings Backfill Worker) but for experiences. Experiences are a much smaller catalog than videos (tens of experiences vs thousands of scenes), so a simple synchronous script is sufficient — no queue, no worker service.

## Entry Points — Read These First

1. `apps/cms/src/api/experience/services/experience-embedder.ts` — the `indexExperience()` function from feat-095. The backfill just calls this in a loop.
2. `apps/cms/src/scripts/` — existing one-shot script patterns (e.g., `data-import-utils.ts`). The backfill script lives here.
3. `apps/cms/src/api/scene-embedding/services/indexer.ts` — the scene-embedding analog. Study the error-handling and progress-logging pattern.
4. `docs/roadmap/content-discovery/feat-042-backfill-worker.md` — the scene backfill ticket. Many of the same principles apply (idempotency, resumability) but at much smaller scale.
5. `apps/cms/src/api/experience/content-types/experience/schema.json` — to understand what "all published experiences across all locales" means.

## Grep These

- `data-import-utils` in `apps/cms/src/scripts/` — existing one-shot script patterns.
- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL patterns.
- `published_at IS NOT NULL` in `apps/cms/src/` — Strapi v5 published-content filter.

## What To Build

### 1. Backfill script

`apps/cms/src/scripts/backfill-experience-embeddings.ts`:

```ts
import { indexExperience } from "../api/experience/services/experience-embedder"

async function main() {
  const strapi = await bootStrapi()
  const knex = strapi.db.connection

  const rows = await knex.raw(`
    SELECT id, locale, slug
    FROM experiences
    WHERE published_at IS NOT NULL
    ORDER BY id, locale
  `)
  const experiences = rows.rows

  strapi.log.info(
    `[backfill-experience] starting: ${experiences.length} experiences to embed`,
  )

  let success = 0
  let failure = 0
  for (const { id, locale, slug } of experiences) {
    try {
      await indexExperience(strapi, id, locale)
      success += 1
      if (success % 10 === 0) {
        strapi.log.info(
          `[backfill-experience] progress: ${success}/${experiences.length}`,
        )
      }
    } catch (err) {
      failure += 1
      strapi.log.error(
        `[backfill-experience] failed id=${id} locale=${locale} slug=${slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  strapi.log.info(
    `[backfill-experience] done: ${success} succeeded, ${failure} failed`,
  )
  process.exit(failure > 0 ? 1 : 0)
}
```

### 2. Package.json script

Add to `apps/cms/package.json`:

```json
{
  "scripts": {
    "backfill:experience-embeddings": "tsx src/scripts/backfill-experience-embeddings.ts"
  }
}
```

### 3. Idempotency + resumability

- **Idempotent:** safe to re-run. Each call to `indexExperience()` is an UPSERT (feat-095 guarantees this), so repeats just update `updated_at` with the same content.
- **Resumable:** if the script crashes halfway, rerun it. Already-embedded experiences get their rows updated with the same content (no harm); missing ones get created.
- **No progress checkpoint file.** The catalog is small enough that a restart re-runs everything in under a minute. No need for the complexity of `feat-042`-style checkpointing.

### 4. Cost + runtime guardrails

Before running, log an estimate:

```ts
const estimatedTokens = experiences.length * 1500 // rough average per experience
const estimatedCost = (estimatedTokens * 0.00002) / 1000 // text-embedding-3-small rate
strapi.log.info(
  `[backfill-experience] estimated ${estimatedTokens} tokens, ~$${estimatedCost.toFixed(4)}`,
)
```

Abort early if:

- `experiences.length > 10_000` (sanity check — unexpected catalog size)
- `estimatedCost > 5.00` (runaway guardrail)

Override with `--force` flag if the operator genuinely wants to proceed.

### 5. Dry-run mode

`--dry-run` flag: logs every experience it would embed (id + locale + slug + text length) but skips the actual OpenRouter call and DB write. Operator can review which experiences will be processed before spending money.

### 6. Tests

- `backfill-experience-embeddings.test.ts`:
  - Builds the expected query against a test DB
  - Handles `indexExperience()` failures gracefully (continues, counts failures)
  - Returns exit code 0 on all success, 1 on any failure
  - `--dry-run` doesn't call `indexExperience()`

## Constraints

- **No queue, no worker service.** Experiences are a small catalog (<100 items expected for Phase 1). A simple `for await` loop in a script is sufficient. Resist the urge to over-engineer.
- **Reuse `indexExperience()`.** This script is a thin driver; all the embedding logic lives in feat-095. If the pipeline changes, the backfill picks up the change automatically.
- **OpenRouter rate limit** is not a concern at this scale (maybe 100 experiences × 3 locales = 300 calls). If it ever becomes one, add a `pLimit(5)` concurrency cap.
- **Does NOT run automatically.** This is an operator-triggered script, not a cron job or deploy hook. Ongoing embedding maintenance is handled by the feat-095 lifecycle hooks.

## Verification

- `pnpm --filter @forge/cms backfill:experience-embeddings --dry-run` logs every experience that would be embedded, no DB writes, no OpenRouter calls. Exit 0.
- `pnpm --filter @forge/cms backfill:experience-embeddings` runs end-to-end:
  - Log estimated cost before starting
  - Progress every 10 experiences
  - Final summary: N succeeded, 0 failed
  - `SELECT count(*) FROM experience_embeddings` equals the number of published experiences × locales
- Re-run the same script → log shows every experience processed again (successfully), `updated_at` advances, `created_at` unchanged. Idempotent.
- Simulate a failure (break one experience's content temporarily) → script continues past it, final summary shows 1 failure with logged details, exit code 1.
- After backfill completes: `curl "localhost:1337/api/search?q=Easter&locale=en"` (once feat-086 lands) returns the `easter` experience in results.

## Out of Scope

- **Incremental re-embedding** on model version changes. This is a one-shot script, but if the embedding model changes, we simply re-run it. No partial-update logic needed because upserts are cheap.
- **Scheduling.** This script is run manually after deploys, or when the operator chooses. No cron needed given the catalog size.
- **Progress UI or dashboard.** Logs in Railway are sufficient.
- **Model comparison or A/B.** Single model (`text-embedding-3-small`) matching scene_embeddings.
