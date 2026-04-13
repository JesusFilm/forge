import { randomUUID } from "node:crypto"
import type { Core } from "@strapi/strapi"

type ManualDryRunClaimBody = {
  leaseToken?: unknown
}

type StrapiContext = {
  status: number
  body: unknown
  params: {
    documentId?: unknown
  }
  request: {
    body?: ManualDryRunClaimBody
  }
}

type ClaimRow = {
  document_id?: string | null
}

function readRows(result: unknown): ClaimRow[] {
  if (
    typeof result === "object" &&
    result != null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: ClaimRow[] }).rows
  }
  return []
}

function readDocumentId(ctx: StrapiContext): string | null {
  const documentId = ctx.params.documentId
  return typeof documentId === "string" && documentId.trim().length > 0
    ? documentId
    : null
}

async function claimManualDryRun(strapi: Core.Strapi, documentId: string) {
  const now = new Date()
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000)
  const result = await strapi.db.connection.raw(
    `
      WITH candidate AS (
        SELECT id, document_id
        FROM enrichment_automations
        WHERE document_id = ?
          AND status = 'active'
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?::timestamptz)
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE enrichment_automations automation
      SET lease_token = ?,
          lease_expires_at = ?::timestamptz,
          updated_at = ?::timestamptz
      FROM candidate
      WHERE automation.id = candidate.id
      RETURNING automation.document_id
    `,
    [
      documentId,
      now.toISOString(),
      leaseToken,
      leaseExpiresAt.toISOString(),
      now.toISOString(),
    ],
  )

  const claimedDocumentId = readRows(result)[0]?.document_id
  if (!claimedDocumentId) return null

  return {
    documentId: claimedDocumentId,
    leaseToken,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  }
}

async function releaseManualDryRunClaim(
  strapi: Core.Strapi,
  documentId: string,
  leaseToken: string,
): Promise<boolean> {
  const result = await strapi.db.connection.raw(
    `
      UPDATE enrichment_automations
      SET lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = ?::timestamptz
      WHERE document_id = ?
        AND lease_token = ?
      RETURNING document_id
    `,
    [new Date().toISOString(), documentId, leaseToken],
  )

  return readRows(result).length > 0
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async manualDryRunClaim(ctx: StrapiContext) {
    const documentId = readDocumentId(ctx)
    if (!documentId) {
      ctx.status = 400
      ctx.body = { error: "Automation documentId is required" }
      return
    }

    try {
      const claim = await claimManualDryRun(strapi, documentId)
      if (!claim) {
        ctx.status = 409
        ctx.body = { error: "Automation already has an active lease." }
        return
      }

      ctx.status = 200
      ctx.body = claim
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(
        `[enrichment-automation] Manual dry-run claim failed: ${message}`,
      )
      ctx.status = 500
      ctx.body = { error: "Failed to claim automation dry run" }
    }
  },

  async manualDryRunRelease(ctx: StrapiContext) {
    const documentId = readDocumentId(ctx)
    const leaseToken = ctx.request.body?.leaseToken
    if (
      !documentId ||
      typeof leaseToken !== "string" ||
      leaseToken.trim().length === 0
    ) {
      ctx.status = 400
      ctx.body = { error: "Automation documentId and leaseToken are required" }
      return
    }

    try {
      const released = await releaseManualDryRunClaim(
        strapi,
        documentId,
        leaseToken,
      )
      ctx.status = 200
      ctx.body = { released }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(
        `[enrichment-automation] Manual dry-run release failed: ${message}`,
      )
      ctx.status = 500
      ctx.body = { error: "Failed to release automation dry-run claim" }
    }
  },
})
