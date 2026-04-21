import type { Core } from "@strapi/strapi"

type MarkFailedBody = {
  error?: unknown
  finishedAt?: unknown
}

type StrapiContext = {
  status: number
  body: unknown
  params: {
    documentId?: unknown
  }
  request: {
    body?: MarkFailedBody
  }
}

type UpdatedRow = {
  document_id?: string | null
}

function readRows(result: unknown): UpdatedRow[] {
  if (
    typeof result === "object" &&
    result != null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: UpdatedRow[] }).rows
  }
  return []
}

function readDocumentId(ctx: StrapiContext): string | null {
  const documentId = ctx.params.documentId
  return typeof documentId === "string" && documentId.trim().length > 0
    ? documentId
    : null
}

function readErrorMessage(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : "Automation dry run failed."
}

async function markFailedIfInFlight(
  strapi: Core.Strapi,
  input: { documentId: string; error: string; finishedAt: string },
): Promise<boolean> {
  const result = await strapi.db.connection.raw(
    `
      UPDATE enrichment_automation_runs
      SET status = 'failed',
          run_mode = 'dry_run',
          finished_at = ?::timestamptz,
          eligible_count = 0,
          enqueued_count = 0,
          skipped_duplicate_count = 0,
          error_count = 1,
          job_document_ids = ?::jsonb,
          errors = ?::jsonb,
          summary = ?,
          updated_at = ?::timestamptz
      WHERE document_id = ?
        AND status IN ('claimed', 'running')
      RETURNING document_id
    `,
    [
      input.finishedAt,
      JSON.stringify([]),
      JSON.stringify([input.error]),
      "Automation dry run failed.",
      new Date().toISOString(),
      input.documentId,
    ],
  )

  return readRows(result).length > 0
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async markFailedIfInFlight(ctx: StrapiContext) {
    const documentId = readDocumentId(ctx)
    const finishedAt = ctx.request.body?.finishedAt
    if (!documentId || typeof finishedAt !== "string") {
      ctx.status = 400
      ctx.body = { error: "Run documentId and finishedAt are required" }
      return
    }

    try {
      const updated = await markFailedIfInFlight(strapi, {
        documentId,
        finishedAt,
        error: readErrorMessage(ctx.request.body?.error),
      })
      ctx.status = 200
      ctx.body = { updated }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(
        `[enrichment-automation-run] Conditional failed mark failed: ${message}`,
      )
      ctx.status = 500
      ctx.body = { error: "Failed to conditionally mark automation run failed" }
    }
  },
})
