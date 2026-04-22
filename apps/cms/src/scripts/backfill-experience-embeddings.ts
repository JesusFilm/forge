/**
 * Backfill Experience Embeddings (feat-096)
 *
 * One-shot script that generates embeddings for all published experiences
 * across all locales. Calls the existing indexExperience() pipeline from
 * feat-095 in a simple for-loop.
 *
 * Usage:
 *   pnpm --filter @forge/cms backfill:experience-embeddings [--dry-run] [--force]
 *
 * Flags:
 *   --dry-run  Log what would be embedded, skip OpenRouter + DB writes
 *   --force    Override cost/count guardrails
 */

import type { Core } from "@strapi/strapi"
import { indexExperience } from "../api/experience/services/experience-embedder"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExperienceRow = { id: number; locale: string; slug: string }

export type BackfillOptions = {
  dryRun: boolean
  force: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EXPERIENCES = 10_000
const PROGRESS_INTERVAL = 10

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

export async function runBackfill(
  strapi: Core.Strapi,
  options: BackfillOptions,
): Promise<{ success: number; failure: number }> {
  const { dryRun, force } = options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = strapi.db.connection as any

  // 1. Query all published experiences across all locales
  const result: { rows: ExperienceRow[] } = await knex.raw(`
    SELECT id, locale, slug
    FROM experiences
    WHERE published_at IS NOT NULL
    ORDER BY id, locale
  `)
  const experiences = result.rows

  strapi.log.info(
    `[backfill-experience] Found ${experiences.length} published experience rows`,
  )

  if (experiences.length === 0) {
    strapi.log.info("[backfill-experience] Nothing to backfill")
    return { success: 0, failure: 0 }
  }

  // 2. Guardrails
  if (!force && experiences.length > MAX_EXPERIENCES) {
    strapi.log.error(
      `[backfill-experience] Aborting: ${experiences.length} experiences exceeds limit of ${MAX_EXPERIENCES}. Use --force to override.`,
    )
    return { success: 0, failure: experiences.length }
  }

  // 3. Dry-run: log each experience and exit
  if (dryRun) {
    for (const { id, locale, slug } of experiences) {
      strapi.log.info(
        `[backfill-experience] [dry-run] Would embed id=${id} locale=${locale} slug=${slug}`,
      )
    }
    strapi.log.info(
      `[backfill-experience] [dry-run] ${experiences.length} experiences would be processed`,
    )
    return { success: experiences.length, failure: 0 }
  }

  // 4. Embed each experience
  let success = 0
  let failure = 0

  for (const { id, locale, slug } of experiences) {
    try {
      await indexExperience(strapi, id, locale)
      success += 1
    } catch (err) {
      failure += 1
      strapi.log.error(
        `[backfill-experience] Failed id=${id} locale=${locale} slug=${slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    const processed = success + failure
    if (processed % PROGRESS_INTERVAL === 0) {
      strapi.log.info(
        `[backfill-experience] Progress: ${processed}/${experiences.length} (${success} ok, ${failure} failed)`,
      )
    }
  }

  strapi.log.info(
    `[backfill-experience] Done: ${success} succeeded, ${failure} failed`,
  )

  return { success, failure }
}

// CLI entry point is in backfill-experience-embeddings-cli.js (plain CJS)
// to avoid tsx's ESM resolution breaking Strapi's lodash/fp dependency.
