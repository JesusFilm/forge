import type { Core } from "@strapi/strapi"

type InternalCreateBody = {
  muxAssetId?: unknown
  muxPlaybackId?: unknown
  languages?: unknown
  status?: unknown
  retries?: unknown
  artifacts?: unknown
  errors?: unknown
  steps?: unknown
  videoDocumentId?: unknown
}

type StrapiContext = {
  status: number
  body: unknown
  request: {
    body?: InternalCreateBody
  }
}

type EnrichmentJobDocumentService = {
  create: (params: Record<string, unknown>) => Promise<{ documentId: string }>
}

type VideoRow = {
  id: number
  document_id?: string | null
  published_at?: string | null
}

type AutomationKeyRow = {
  automation_key?: string | null
}

function getDocuments(strapi: Core.Strapi): EnrichmentJobDocumentService {
  return strapi.documents(
    "api::enrichment-job.enrichment-job" as never,
  ) as unknown as EnrichmentJobDocumentService
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}

async function readVideoRowsByDocumentId(
  strapi: Core.Strapi,
  videoDocumentId: string,
): Promise<VideoRow[]> {
  const result: { rows?: VideoRow[] } = await strapi.db.connection.raw(
    `
      SELECT id, document_id, published_at
      FROM videos
      WHERE document_id = ?
      ORDER BY CASE WHEN published_at IS NOT NULL THEN 0 ELSE 1 END, id DESC
    `,
    [videoDocumentId],
  )

  return result.rows ?? []
}

async function readRunningAutomationKeys(
  strapi: Core.Strapi,
): Promise<string[]> {
  const result: { rows?: AutomationKeyRow[] } = await strapi.db.connection.raw(`
    SELECT DISTINCT artifacts #>> '{automation,data,automationKey}' AS automation_key
    FROM enrichment_jobs
    WHERE status IN ('pending', 'running')
      AND artifacts #>> '{automation,kind}' = 'metadata'
      AND artifacts #>> '{automation,data,automationKey}' IS NOT NULL
    ORDER BY automation_key
  `)

  return (result.rows ?? [])
    .map((row) => row.automation_key)
    .filter((key): key is string => typeof key === "string" && key.length > 0)
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async runningAutomationKeys(ctx: StrapiContext) {
    try {
      ctx.status = 200
      ctx.body = { automationKeys: await readRunningAutomationKeys(strapi) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(
        `[enrichment-job] Running automation key lookup failed: ${message}`,
      )
      ctx.status = 500
      ctx.body = { error: "Failed to list running automation keys" }
    }
  },

  async internalCreate(ctx: StrapiContext) {
    const body = ctx.request.body ?? {}

    if (
      typeof body.muxAssetId !== "string" ||
      body.muxAssetId.trim().length === 0 ||
      typeof body.videoDocumentId !== "string" ||
      body.videoDocumentId.trim().length === 0
    ) {
      ctx.status = 400
      ctx.body = {
        error: "muxAssetId and videoDocumentId are required",
      }
      return
    }

    if (
      typeof body.muxPlaybackId !== "string" ||
      !isStringArray(body.languages) ||
      typeof body.status !== "string" ||
      typeof body.retries !== "number" ||
      !Array.isArray(body.errors) ||
      !Array.isArray(body.steps)
    ) {
      ctx.status = 400
      ctx.body = {
        error:
          "muxPlaybackId, languages, status, retries, errors, and steps are required",
      }
      return
    }

    try {
      const videoRows = await readVideoRowsByDocumentId(
        strapi,
        body.videoDocumentId,
      )
      const publishedVideoRow =
        videoRows.find((row) => row.published_at != null) ??
        videoRows[0] ??
        null

      if (!publishedVideoRow) {
        ctx.status = 404
        ctx.body = { error: "Video not found" }
        return
      }

      const created = await getDocuments(strapi).create({
        data: {
          muxAssetId: body.muxAssetId,
          muxPlaybackId: body.muxPlaybackId,
          languages: body.languages,
          status: body.status,
          retries: body.retries,
          artifacts:
            body.artifacts && typeof body.artifacts === "object"
              ? body.artifacts
              : {},
          errors: body.errors,
          steps: body.steps,
          video: publishedVideoRow.id,
        },
      })

      ctx.status = 200
      ctx.body = { documentId: created.documentId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(`[enrichment-job] Internal create failed: ${message}`)
      ctx.status = 500
      ctx.body = { error: "Failed to create enrichment job" }
    }
  },
})
