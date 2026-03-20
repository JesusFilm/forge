import type { Core } from "@strapi/strapi"

/**
 * Strapi v5 generates content-type types at boot time.
 * Our new content types (language, country, etc.) aren't in the generated
 * type registry yet, so we use a loosely-typed document service wrapper.
 *
 * This mirrors the pattern in src/bootstrap/seed-easter.ts which uses
 * `as unknown as DocumentService<...>` casts for the same reason.
 */

type AnyDocument = Record<string, unknown> & {
  documentId: string
  id?: unknown
}

type DocumentService = {
  findFirst: (params: Record<string, unknown>) => Promise<AnyDocument | null>
  findMany: (params: Record<string, unknown>) => Promise<AnyDocument[]>
  create: (params: Record<string, unknown>) => Promise<AnyDocument>
  update: (params: Record<string, unknown>) => Promise<AnyDocument>
  delete: (params: Record<string, unknown>) => Promise<unknown>
  publish: (params: Record<string, unknown>) => Promise<unknown>
  unpublish: (params: Record<string, unknown>) => Promise<unknown>
}

export type GatewayTranslation = {
  id?: string
  value: string
  primary: boolean
  language: { id: string }
}

export type SyncStats = {
  created: number
  updated: number
  softDeleted: number
  errors: number
}

export function docs(strapi: Core.Strapi, uid: string): DocumentService {
  return strapi.documents(uid as never) as unknown as DocumentService
}

export function getPrimaryValue(translations: GatewayTranslation[]): string {
  const primary = translations.find((t) => t.primary)
  return primary?.value ?? translations[0]?.value ?? ""
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function findByGatewayId(
  strapi: Core.Strapi,
  uid: string,
  gatewayId: string,
  locale?: string,
): Promise<AnyDocument | null> {
  const params: Record<string, unknown> = {
    filters: { gatewayId: { $eq: gatewayId } },
  }
  if (locale) params.locale = locale
  return docs(strapi, uid).findFirst(params)
}

export async function upsertByGatewayId(
  strapi: Core.Strapi,
  uid: string,
  gatewayId: string,
  data: Record<string, unknown>,
  options?: { locale?: string },
): Promise<{ documentId: string; action: "created" | "updated" | "skipped" }> {
  const existing = await findByGatewayId(
    strapi,
    uid,
    gatewayId,
    options?.locale,
  )

  if (existing) {
    if (existing.source === "manager") {
      return { documentId: existing.documentId, action: "skipped" }
    }
    await docs(strapi, uid).update({
      documentId: existing.documentId,
      data: { ...data, gatewayId, source: "gateway" },
      ...(options?.locale && { locale: options.locale }),
      status: "published",
    })
    return { documentId: existing.documentId, action: "updated" }
  }

  const created = await docs(strapi, uid).create({
    data: { ...data, gatewayId, source: "gateway" },
    ...(options?.locale && { locale: options.locale }),
    status: "published",
  })
  return { documentId: created.documentId, action: "created" }
}

/**
 * Pre-load all records of a given type into a Map<gatewayId, documentId>.
 * Used to avoid N+1 findByGatewayId calls in sync loops.
 */
export async function buildGatewayIdMap(
  strapi: Core.Strapi,
  uid: string,
  locale?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const PAGE_SIZE = 1000
  let start = 0

  while (true) {
    const params: Record<string, unknown> = {
      fields: ["documentId", "gatewayId"],
      limit: PAGE_SIZE,
      start,
    }
    if (locale) params.locale = locale

    const batch = await docs(strapi, uid).findMany(params)
    for (const record of batch) {
      const gid = record.gatewayId as string | undefined
      if (gid) map.set(gid, record.documentId)
    }

    if (batch.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return map
}

export async function softDeleteUnseen(
  strapi: Core.Strapi,
  uid: string,
  seenIds: Set<string>,
  locale?: string,
): Promise<number> {
  let count = 0
  const PAGE_SIZE = 500

  try {
    let start = 0

    while (true) {
      const params: Record<string, unknown> = {
        filters: { source: { $eq: "gateway" } },
        fields: ["documentId", "gatewayId"],
        status: "published",
        limit: PAGE_SIZE,
        start,
      }
      if (locale) params.locale = locale

      const batch = await docs(strapi, uid).findMany(params)
      if (batch.length === 0) break

      for (const local of batch) {
        const gid = local.gatewayId as string | undefined
        if (gid && !seenIds.has(gid)) {
          await docs(strapi, uid).unpublish({
            documentId: local.documentId,
            ...(locale && { locale: "*" }),
          })
          count++
        }
      }

      if (batch.length < PAGE_SIZE) break
      start += PAGE_SIZE
    }
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Soft-delete pass for ${uid} failed: ${formatError(error)}`,
    )
  }
  return count
}
