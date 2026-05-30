// Experience embedding backfill — durable useworkflow job that
// enumerates eligible ExperienceLocale rows and embeds them.
//
// Admin-native replacement for the embed-dispatch role the now-deleted
// R3 experience-content-dump workflow played. Mirrors the R1/R2
// backfill shape so operators and future readers find the same pattern
// in the same place. Differences from R1/R2:
//
//   - No S3 mapping snapshot. The data source is admin's own Postgres.
//   - No per-(video, edition) grouping. Each ExperienceLocale row is its
//     own target — there's no shared artifact to memoize.
//   - No bounded parallelism for v1. Admin's experience corpus is small
//     enough that sequential `for…of` per-target is fast enough. If
//     parallelism is added later, it lands as a follow-up using the
//     `pLimit + Promise.allSettled` pattern documented in
//     docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md.
//   - No `missingArtifacts` projection. The per-locale embed step sends
//     Admin-owned source data to Mastra; an artifact-missing concept doesn't
//     apply.
//
// Cross-cutting reminders applied:
//   - top-level `"use workflow"` directive
//   - inner step functions tagged `"use step"`
//   - sequential `for…of` per-target (NOT Promise.all)
//   - per-target try/catch with typed-outcome reporting
//   - exhaustive stepReport with `_exhaustive: never` guard
//   - data-derived enumeration — `status='published'` rows in admin's
//     own table; no hardcoded locale list, no `en` fallback
//   - `_internals` export at file bottom for test visibility
//   - dispatch test required at the resolver layer (see
//     experience-embedding-backfill.test.ts in graphql/mutations);
//     this workflow file is exercised body-only here
//   - the per-target step calls Mastra's service route with source
//     data resolved from Admin. Admin keeps target enumeration and
//     storage authority; Mastra owns the provider call and Studio
//     diagnostics.

import { Prisma } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  launchMastraExperienceEmbeddingForLocale,
  type MastraExperienceEmbeddingMode,
} from "@/services/mastra-experience-embedding-client"

export type ExperienceEmbeddingBackfillInput = {
  /**
   * Restrict to ExperienceLocale rows whose parent Experience.id is in
   * this set. Omitted = every published Experience. Filter applies as
   * a pure inclusion predicate.
   */
  experienceIds?: readonly string[]
  /**
   * Restrict to ExperienceLocale rows whose `locale` (BCP-47) is in
   * this set. Omitted = every locale that exists in the corpus —
   * data-derived at enumeration time. No hardcoded list, no `en`
   * fallback.
   */
  bcp47Locales?: readonly string[]
  /**
   * When true, include rows that already have a non-NULL embedding
   * (re-embed them). Default false — only rows with `embedding IS NULL`
   * are enumerated. Use `force: true` for model upgrades or drift fixes.
   */
  force?: boolean
  /**
   * Explicit Admin ingest mode. Omitted mode maps from `force` for backward
   * compatibility: `force: true` => `force`, otherwise `idempotent`.
   */
  mode?: MastraExperienceEmbeddingMode
}

export type ExperienceEmbeddingBackfillTarget = {
  experienceLocaleId: string
  experienceId: string
  locale: string
}

export type ExperienceEmbeddingBackfillOutcome =
  | {
      status: "succeeded"
      target: ExperienceEmbeddingBackfillTarget
      durationMs: number
    }
  | {
      status: "failed"
      target: ExperienceEmbeddingBackfillTarget
      reason: string
      durationMs: number
    }

export type ExperienceEmbeddingBackfillReport = {
  totalTargets: number
  /**
   * The caller's experienceIds filter (when provided) or `null` when
   * the enumeration spanned every published Experience.
   */
  experienceIdFilter: readonly string[] | null
  /**
   * The caller's locale filter (when provided) or `null` when the
   * enumeration spanned every locale.
   */
  localeFilter: readonly string[] | null
  /** Resolved enumeration force after applying explicit mode precedence. */
  force: boolean
  mode: MastraExperienceEmbeddingMode
  outcomes: ExperienceEmbeddingBackfillOutcome[]
  succeeded: number
  failed: number
}

export async function runExperienceEmbeddingBackfill(
  input: ExperienceEmbeddingBackfillInput,
): Promise<ExperienceEmbeddingBackfillReport> {
  "use workflow"

  // Treat length-0 arrays as "omitted" so a GraphQL caller who
  // accidentally passes `experienceIds: []` / `bcp47Locales: []`
  // doesn't silently run zero work with a success-shaped report.
  // Matches the R1/R2 mutation contracts.
  const experienceIdFilter =
    input.experienceIds && input.experienceIds.length > 0
      ? input.experienceIds
      : null
  const localeFilter =
    input.bcp47Locales && input.bcp47Locales.length > 0
      ? input.bcp47Locales
      : null
  const requestedForce = input.force === true
  const mode = input.mode ?? (requestedForce ? "force" : "idempotent")
  const force =
    input.mode == null
      ? requestedForce
      : mode === "force" || mode === "model-upgrade"

  const targets = await stepEnumerateTargets({
    experienceIdFilter,
    localeFilter,
    force,
  })

  console.log(
    JSON.stringify({
      workflow: "experience-embedding-backfill",
      event: "start",
      totalTargets: targets.length,
      experienceIdFilter,
      localeFilter,
      force,
      mode,
    }),
  )

  const outcomes: ExperienceEmbeddingBackfillOutcome[] = []
  for (const target of targets) {
    const outcome = await stepEmbedTarget(target, mode)
    logOutcome(outcome)
    outcomes.push(outcome)
  }

  return stepReport({
    totalTargets: targets.length,
    experienceIdFilter,
    localeFilter,
    force,
    mode,
    outcomes,
  })
}

async function stepEnumerateTargets(args: {
  experienceIdFilter: readonly string[] | null
  localeFilter: readonly string[] | null
  force: boolean
}): Promise<ExperienceEmbeddingBackfillTarget[]> {
  "use step"

  // Raw SQL because `embedding` is `Unsupported("vector(1536)")?` —
  // Prisma's typed `where` can't filter on it. Same shape `fingerprint.ts`
  // uses for the search-eval content fingerprint, so the eligibility
  // predicate matches what hybrid-search actually retrieves over
  // (status='published' + archived_at IS NULL + indexed embedding).
  //
  // status='published' is the lowercase DB enum value (admin's
  // `LocaleStatus` Prisma enum maps to lowercase DB values per the
  // 0001_init migration). Hybrid search reads only published locales,
  // so unpublished rows wouldn't earn the embedding cost.
  const experienceIdClause =
    args.experienceIdFilter && args.experienceIdFilter.length > 0
      ? Prisma.sql`AND el.experience_id IN (${Prisma.join(args.experienceIdFilter)})`
      : Prisma.empty
  const localeClause =
    args.localeFilter && args.localeFilter.length > 0
      ? Prisma.sql`AND el.locale IN (${Prisma.join(args.localeFilter)})`
      : Prisma.empty
  const embeddingClause = args.force
    ? Prisma.empty
    : Prisma.sql`AND el.embedding IS NULL`

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      experience_id: string
      locale: string
    }>
  >`
    SELECT el.id, el.experience_id, el.locale
    FROM experience_locale el
    JOIN experience e ON e.id = el.experience_id
    WHERE el.status = 'published'
    AND e.archived_at IS NULL
    ${embeddingClause}
    ${experienceIdClause}
    ${localeClause}
    ORDER BY el.experience_id, el.locale
  `

  return rows.map((row) => ({
    experienceLocaleId: row.id,
    experienceId: row.experience_id,
    locale: row.locale,
  }))
}

async function stepEmbedTarget(
  target: ExperienceEmbeddingBackfillTarget,
  mode: MastraExperienceEmbeddingMode,
): Promise<ExperienceEmbeddingBackfillOutcome> {
  "use step"

  const startedAt = Date.now()
  try {
    const result = await launchMastraExperienceEmbeddingForLocale(
      target.experienceLocaleId,
      { mode },
    )
    if (!result.ok) {
      throw new Error(
        `Mastra experience embedding failed: ${result.reason}` +
          (result.adminReason ? ` (${result.adminReason})` : ""),
      )
    }
    return {
      status: "succeeded",
      target,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      status: "failed",
      target,
      reason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    }
  }
}

function stepReport(args: {
  totalTargets: number
  experienceIdFilter: readonly string[] | null
  localeFilter: readonly string[] | null
  force: boolean
  mode: MastraExperienceEmbeddingMode
  outcomes: ExperienceEmbeddingBackfillOutcome[]
}): ExperienceEmbeddingBackfillReport {
  let succeeded = 0
  let failed = 0
  for (const outcome of args.outcomes) {
    switch (outcome.status) {
      case "succeeded":
        succeeded += 1
        break
      case "failed":
        failed += 1
        break
      default: {
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled ExperienceEmbeddingBackfillOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  }
  return {
    totalTargets: args.totalTargets,
    experienceIdFilter: args.experienceIdFilter,
    localeFilter: args.localeFilter,
    force: args.force,
    mode: args.mode,
    outcomes: args.outcomes,
    succeeded,
    failed,
  }
}

function logOutcome(outcome: ExperienceEmbeddingBackfillOutcome): void {
  // Defensive wrap — a JSON.stringify throw on outcome.reason must NEVER
  // abort the per-target isolation contract. Same shape R1/R2 adopt.
  try {
    switch (outcome.status) {
      case "succeeded":
        console.log(
          JSON.stringify({
            workflow: "experience-embedding-backfill",
            event: "experience_embed_complete",
            experienceId: outcome.target.experienceId,
            experienceLocaleId: outcome.target.experienceLocaleId,
            locale: outcome.target.locale,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "failed":
        console.error(
          JSON.stringify({
            workflow: "experience-embedding-backfill",
            event: "experience_embed_failed",
            experienceId: outcome.target.experienceId,
            experienceLocaleId: outcome.target.experienceLocaleId,
            locale: outcome.target.locale,
            reason: outcome.reason,
            durationMs: outcome.durationMs,
          }),
        )
        return
      default: {
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled ExperienceEmbeddingBackfillOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  } catch (logErr) {
    console.error(
      `[experience-embedding-backfill] logOutcome failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
  }
}

// Exported for tests — these are the pure functions inside the steps,
// safe to exercise without the useworkflow runtime.
export const _internals = {
  stepEnumerateTargets,
  stepEmbedTarget,
  stepReport,
  logOutcome,
}
