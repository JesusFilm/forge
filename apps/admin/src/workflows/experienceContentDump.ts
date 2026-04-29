// R3 experience-content-dump workflow.
//
// Reads cms experience rows from cms's Postgres, transforms them to
// admin's BlockSchema shape, merge-upserts ExperienceLocale rows in
// admin, and dispatches `runExperienceEmbedding` for locales whose
// hashable content changed.
//
// Mirrors R1 (sceneEmbeddingBackfill) / R2 (transcriptEmbeddingBackfill):
//   - top-level `"use workflow"` directive
//   - inner step functions tagged `"use step"`
//   - sequential `for…of` per-target (NOT Promise.all)
//   - per-target try/catch with typed-error branching
//   - exhaustive stepReport with `_exhaustive: never` guard
//   - `_internals` export at file bottom for test visibility
//
// Cross-cutting reminders applied:
//   - data-derived locale enumeration (no hardcoded list, no `en` fallback)
//   - dispatch test required at the resolver layer (see
//     experience-content-dump.test.ts in graphql/mutations); this
//     workflow file is exercised body-only here
//   - `start(runExperienceEmbedding, [...])` is dispatched from the
//     same `workflow/api` import the resolver uses; the directive
//     ensures both paths route through the runtime in production

import { start } from "workflow/api"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { prisma } from "@/db/client"
import { getCmsPgPool } from "@/db/cms-pg"
import { createCmsExperienceSourceRepository } from "@/services/cms-experience-source.repository"
import type { CmsExperienceSourceRepository } from "@/services/cms-experience-source.types"
import { createCmsVideoIdResolver } from "@/services/cms-video-id-resolver"
import type { CmsVideoIdResolver } from "@/services/cms-video-id-resolver"
import {
  ExperienceContentDumpError,
  dumpExperienceLocale,
  persistContentHash,
  type DumpExperienceLocaleResult,
} from "@/services/experience-content-dump.service"
import {
  runExperienceEmbedding,
  type ExperienceEmbeddingInput,
} from "@/workflows/experienceEmbedding"

export type ExperienceContentDumpInput = {
  /** Restrict to these cms documentIds. Omitted = every document. */
  documentIds?: readonly string[]
  /** Restrict to these BCP-47 locales. Omitted = every locale cms has. */
  locales?: readonly string[]
}

export type ExperienceContentDumpTarget = {
  documentId: string
  locale: string
  hasPublished: boolean
  hasDraft: boolean
  publishedAt: Date | null
  draftUpdatedAt: Date | null
}

export type ExperienceContentDumpOutcome =
  | {
      status: "succeeded"
      target: ExperienceContentDumpTarget
      action: "created" | "updated" | "skipped_unchanged"
      experienceLocaleId: string
      experienceId: string
      embedDispatched: boolean
      previousHash: string | null
      newHash: string
      draftPendingNewer: boolean
      videoResolutionMisses: number[]
      durationMs: number
    }
  | {
      status: "failed"
      target: ExperienceContentDumpTarget
      reason:
        | "forbidden"
        | "null_locale"
        | "slug_collision"
        | "failed_validation"
        | "embed_dispatch_failed"
        | "hash_persist_failed"
        | "cms_read"
        | "db_write"
        | "unknown"
      message: string
      durationMs: number
    }

export type ExperienceContentDumpReport = {
  totalTargets: number
  documentIdFilter: readonly string[] | null
  localeFilter: readonly string[] | null
  outcomes: ExperienceContentDumpOutcome[]
  succeeded: number
  skipped: number
  failed: number
  embedsDispatched: number
}

export async function runExperienceContentDump(
  input: ExperienceContentDumpInput,
): Promise<ExperienceContentDumpReport> {
  "use workflow"

  // Treat length-0 arrays as "omitted" so a GraphQL caller who
  // accidentally passes `documentIds: []` / `locales: []` doesn't
  // silently run zero work with a success-shaped report. Matches
  // R1/R2 mutation contracts.
  const documentIdFilter =
    input.documentIds && input.documentIds.length > 0 ? input.documentIds : null
  const localeFilter =
    input.locales && input.locales.length > 0 ? input.locales : null

  // Repo + videoResolver construction is INTENTIONALLY deferred to
  // step bodies (`buildDeps()` below) — useworkflow's bundler
  // rejects any reference to `pg`-backed / `@prisma/client`-backed
  // modules at the workflow function body, even guarded by a
  // call. Only step bodies may touch them. Same constraint R1/R2
  // satisfy by passing `prisma` directly inside their step
  // functions; R3 has more deps (cms pool + repo + resolver) so we
  // factor them through a shared step-local helper.
  //
  // getCmsPgPool() throws CmsDatabaseUrlMissingError synchronously
  // when CMS_DATABASE_URL is unset. The first step that touches it
  // (stepEnumerateTargets) propagates that throw as a top-level
  // workflow error — the dispatch never charges any target.
  const targets = await stepEnumerateTargets({
    documentIds: documentIdFilter ?? undefined,
    locales: localeFilter ?? undefined,
  })

  const outcomes: ExperienceContentDumpOutcome[] = []
  let embedsDispatched = 0

  for (const target of targets) {
    const outcome = await stepDumpTarget(target)
    outcomes.push(outcome)
    logOutcome(outcome)

    if (
      outcome.status === "succeeded" &&
      outcome.action !== "skipped_unchanged"
    ) {
      const embedOutcome = await stepDispatchEmbedding(outcome)
      if (embedOutcome.status === "succeeded") {
        outcomes[outcomes.length - 1] = {
          ...outcome,
          embedDispatched: true,
        }
        embedsDispatched += 1
      } else {
        // Replace the prior succeeded outcome with the failed
        // dispatch so the run summary reflects reality. The reason
        // distinguishes "embed never ran" (next rerun retries the
        // full dispatch) from "embed ran but hash didn't persist"
        // (next rerun re-dispatches because the hash is stale; the
        // embedding overwrite is idempotent). Operators can branch
        // their remediation accordingly.
        outcomes[outcomes.length - 1] = {
          status: "failed",
          target: outcome.target,
          reason: embedOutcome.reason,
          message: embedOutcome.message,
          durationMs: outcome.durationMs,
        }
      }
    }
  }

  return stepReport({
    targets: targets.length,
    documentIdFilter,
    localeFilter,
    outcomes,
    embedsDispatched,
  })
}

/**
 * Step-local construction of the cms pool + repo + resolver. The
 * pool is a process-wide singleton (cached via globalThis in
 * cms-pg.ts), so calling getCmsPgPool() inside multiple steps
 * reuses the same connection pool — no per-step pool instances.
 * The repo + resolver are cheap pure constructors over the pool
 * + prisma client.
 *
 * Lives at module scope but is only INVOKED from inside step
 * bodies, so useworkflow's bundler analysis stays clean.
 */
function buildDeps(): {
  repo: CmsExperienceSourceRepository
  videoResolver: CmsVideoIdResolver
} {
  const cmsPool = getCmsPgPool()
  const repo = createCmsExperienceSourceRepository(cmsPool)
  const videoResolver = createCmsVideoIdResolver(cmsPool, prisma)
  return { repo, videoResolver }
}

async function stepEnumerateTargets(filter: {
  documentIds?: readonly string[]
  locales?: readonly string[]
}): Promise<ExperienceContentDumpTarget[]> {
  "use step"

  const { repo } = buildDeps()
  const rows = await repo.enumerateDocumentLocales(filter)
  return rows
    .filter((r) => r.locale.length > 0)
    .map((r) => ({
      documentId: r.document_id,
      locale: r.locale,
      hasPublished: r.has_published,
      hasDraft: r.has_draft,
      publishedAt: r.published_at,
      draftUpdatedAt: r.draft_updated_at,
    }))
}

async function stepDumpTarget(
  target: ExperienceContentDumpTarget,
): Promise<ExperienceContentDumpOutcome> {
  "use step"

  const { repo, videoResolver } = buildDeps()
  const startedAt = Date.now()
  try {
    const result = await dumpExperienceLocale(prisma, {
      documentId: target.documentId,
      locale: target.locale,
      hasPublished: target.hasPublished,
      hasDraft: target.hasDraft,
      publishedAt: target.publishedAt,
      draftUpdatedAt: target.draftUpdatedAt,
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver,
    })
    return toSucceeded(target, result, Date.now() - startedAt)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    if (err instanceof ExperienceContentDumpError) {
      return {
        status: "failed",
        target,
        reason: err.code,
        message: err.message,
        durationMs,
      }
    }
    return {
      status: "failed",
      target,
      reason: "unknown",
      message: err instanceof Error ? err.message : String(err),
      durationMs,
    }
  }
}

type EmbedDispatchOutcome =
  | { status: "succeeded" }
  // The dispatch never ran (or failed before the embedding could
  // start). The next rerun must retry the entire dispatch.
  | { status: "failed"; reason: "embed_dispatch_failed"; message: string }
  // The dispatch + inner workflow succeeded, but persistContentHash
  // throws afterward. The embedding IS in admin's DB; only the hash
  // bookkeeping failed. The next rerun will see the unchanged
  // previous hash, mark the row as changed, and re-dispatch the
  // embedding (which is idempotent — overwrites the same vector).
  // Operationally distinct from embed_dispatch_failed: an operator
  // shouldn't escalate this as 'embedding pipeline broken' because
  // the embedding actually ran.
  | { status: "failed"; reason: "hash_persist_failed"; message: string }

async function stepDispatchEmbedding(
  outcome: Extract<ExperienceContentDumpOutcome, { status: "succeeded" }>,
): Promise<EmbedDispatchOutcome> {
  "use step"

  try {
    const run = await start(runExperienceEmbedding, [
      {
        localeId: outcome.experienceLocaleId,
      } satisfies ExperienceEmbeddingInput,
    ])
    // Await the dispatched run's return value so a synchronous
    // failure inside `runExperienceEmbedding` surfaces here rather
    // than as a silent in-flight failure.
    await run.returnValue
  } catch (err) {
    return {
      status: "failed",
      reason: "embed_dispatch_failed",
      message: err instanceof Error ? err.message : String(err),
    }
  }
  // Persist the new hash ONLY after dispatch succeeds — so a failed
  // dispatch leaves the previous hash in place and the next rerun's
  // "differs?" check retries (plan Key Decision §12).
  try {
    await persistContentHash(
      prisma,
      outcome.experienceLocaleId,
      outcome.newHash,
    )
  } catch (err) {
    return {
      status: "failed",
      reason: "hash_persist_failed",
      message: `embed dispatched but hash persist failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return { status: "succeeded" }
}

function stepReport(args: {
  targets: number
  documentIdFilter: readonly string[] | null
  localeFilter: readonly string[] | null
  outcomes: ExperienceContentDumpOutcome[]
  embedsDispatched: number
}): ExperienceContentDumpReport {
  let succeeded = 0
  let skipped = 0
  let failed = 0
  for (const outcome of args.outcomes) {
    switch (outcome.status) {
      case "succeeded":
        if (outcome.action === "skipped_unchanged") skipped += 1
        else succeeded += 1
        break
      case "failed":
        failed += 1
        break
      default: {
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled ExperienceContentDumpOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  }
  return {
    totalTargets: args.targets,
    documentIdFilter: args.documentIdFilter,
    localeFilter: args.localeFilter,
    outcomes: args.outcomes,
    succeeded,
    skipped,
    failed,
    embedsDispatched: args.embedsDispatched,
  }
}

function toSucceeded(
  target: ExperienceContentDumpTarget,
  result: DumpExperienceLocaleResult,
  durationMs: number,
): ExperienceContentDumpOutcome {
  return {
    status: "succeeded",
    target,
    action: result.action,
    experienceLocaleId: result.experienceLocaleId,
    experienceId: result.experienceId,
    embedDispatched: false,
    previousHash: result.previousHash,
    newHash: result.newHash,
    draftPendingNewer: result.draftPendingNewer,
    videoResolutionMisses: result.videoResolutionMisses,
    durationMs,
  }
}

function logOutcome(outcome: ExperienceContentDumpOutcome): void {
  // logOutcome runs OUTSIDE the per-target try/catch in the for-of
  // loop, so a JSON.stringify throw (circular structure, BigInt,
  // unstringifiable error in outcome.message) would halt the run.
  // Outcome shapes today are stringify-safe but the defensive wrap
  // keeps the contract narrow: log failures must never escape.
  try {
    switch (outcome.status) {
      case "succeeded":
        console.log(
          JSON.stringify({
            workflow: "experience-content-dump",
            event: "dump_complete",
            documentId: outcome.target.documentId,
            locale: outcome.target.locale,
            action: outcome.action,
            experienceLocaleId: outcome.experienceLocaleId,
            draftPendingNewer: outcome.draftPendingNewer,
            videoResolutionMisses: outcome.videoResolutionMisses.length,
            durationMs: outcome.durationMs,
          }),
        )
        return
      case "failed":
        console.error(
          JSON.stringify({
            workflow: "experience-content-dump",
            event: "dump_failed",
            documentId: outcome.target.documentId,
            locale: outcome.target.locale,
            reason: outcome.reason,
            message: outcome.message,
            durationMs: outcome.durationMs,
          }),
        )
        return
      default: {
        const _exhaustive: never = outcome
        throw new Error(
          `Unhandled ExperienceContentDumpOutcome variant: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  } catch (logErr) {
    console.error(
      `[experience-content-dump] logOutcome failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    )
  }
}

// Exported for tests — pure helpers safe to exercise without the
// useworkflow runtime. Tests using the step bodies import them
// directly.
export const _internals = {
  stepEnumerateTargets,
  stepDumpTarget,
  stepDispatchEmbedding,
  stepReport,
  toSucceeded,
  logOutcome,
}
