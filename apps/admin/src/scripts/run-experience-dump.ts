#!/usr/bin/env tsx
/**
 * Run the R3 experience-content-dump from a workstation against any
 * DATABASE_URL + CMS_DATABASE_URL pair.
 *
 * Bypasses the GraphQL `triggerExperienceContentDump` mutation
 * (ADMIN-gated and dispatches via the useworkflow runtime) and the
 * embedding dispatch (which also requires the workflow runtime).
 * Calls `dumpExperienceLocale` directly per target — same pattern
 * `run-embeds.ts` uses for the embedding workflows.
 *
 * The dump itself writes the `experience_locale` row including
 * snapshot columns (`cms_document_id`, `cms_dumped_at`,
 * `cms_content_hash`); the embedding workflow can be triggered
 * separately once the workflow runtime is reachable.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   CMS_DATABASE_URL='postgresql://forge:forge@localhost:5432/forge' \
 *   pnpm --filter @forge/admin tsx src/scripts/run-experience-dump.ts \
 *     --document-id=nnwhoba6m8gd5pua1sovtii2
 *
 *   # Filters (all optional, repeatable):
 *   --document-id=<cms documentId>
 *   --locale=<bcp47>
 */

function parseRepeated(name: string): string[] {
  const flag = `--${name}=`
  return process.argv
    .filter((a) => a.startsWith(flag))
    .map((a) => a.slice(flag.length))
    .filter((v) => v.length > 0)
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("[run-experience-dump] DATABASE_URL is required\n")
    process.exit(2)
  }
  if (!process.env.CMS_DATABASE_URL) {
    process.stderr.write("[run-experience-dump] CMS_DATABASE_URL is required\n")
    process.exit(2)
  }

  const documentIds = parseRepeated("document-id")
  const locales = parseRepeated("locale")

  // Lazy-import after env guards so a missing var produces a clean
  // stderr line rather than zod's validation crash.
  const { prisma } = await import("@/db/client")
  const { getCmsPgPool } = await import("@/db/cms-pg")
  const { createCmsExperienceSourceRepository } =
    await import("@/services/cms-experience-source.repository")
  const { createCmsVideoIdResolver } =
    await import("@/services/cms-video-id-resolver")
  const { dumpExperienceLocale, ExperienceContentDumpError } =
    await import("@/services/experience-content-dump.service")
  const { SYSTEM_PRINCIPAL } = await import("@/auth/principal")

  const cmsPool = getCmsPgPool()
  const repo = createCmsExperienceSourceRepository(cmsPool)
  const videoResolver = createCmsVideoIdResolver(cmsPool, prisma)

  const targets = await repo.enumerateDocumentLocales({
    documentIds: documentIds.length > 0 ? documentIds : undefined,
    locales: locales.length > 0 ? locales : undefined,
  })

  const startedAt = Date.now()
  process.stdout.write(
    JSON.stringify({
      event: "run-experience-dump.start",
      documentIds: documentIds.length > 0 ? documentIds : null,
      locales: locales.length > 0 ? locales : null,
      totalTargets: targets.length,
    }) + "\n",
  )

  let succeeded = 0
  let skipped = 0
  let failed = 0

  try {
    for (const row of targets) {
      if (row.locale.length === 0) continue
      const target = {
        documentId: row.document_id,
        locale: row.locale,
        hasPublished: row.has_published,
        hasDraft: row.has_draft,
        publishedAt: row.published_at,
        draftUpdatedAt: row.draft_updated_at,
      }
      const t0 = Date.now()
      try {
        const result = await dumpExperienceLocale(prisma, {
          ...target,
          user: SYSTEM_PRINCIPAL,
          repo,
          videoResolver,
        })
        const action = result.action
        if (action === "skipped_unchanged") skipped += 1
        else succeeded += 1
        process.stdout.write(
          JSON.stringify({
            event: "dump.success",
            documentId: target.documentId,
            locale: target.locale,
            action,
            experienceLocaleId: result.experienceLocaleId,
            experienceId: result.experienceId,
            videoResolutionMisses: result.videoResolutionMisses.length,
            durationMs: Date.now() - t0,
          }) + "\n",
        )
      } catch (err) {
        failed += 1
        const reason =
          err instanceof ExperienceContentDumpError ? err.code : "unknown"
        const message = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "dump.failure",
            documentId: target.documentId,
            locale: target.locale,
            reason,
            message,
            durationMs: Date.now() - t0,
          }) + "\n",
        )
      }
    }
  } finally {
    await prisma.$disconnect()
    await cmsPool.end()
  }

  process.stdout.write(
    JSON.stringify({
      event: "run-experience-dump.complete",
      totalTargets: targets.length,
      succeeded,
      skipped,
      failed,
      totalDurationMs: Date.now() - startedAt,
    }) + "\n",
  )

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  process.stderr.write(
    `[run-experience-dump] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exit(1)
})
