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

export function docs(strapi: Core.Strapi, uid: string): DocumentService {
  return strapi.documents(uid as never) as unknown as DocumentService
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

export async function softDeleteUnseen(
  strapi: Core.Strapi,
  uid: string,
  seenIds: Set<string>,
  locale?: string,
): Promise<number> {
  let count = 0
  try {
    const params: Record<string, unknown> = {
      filters: { source: { $eq: "gateway" } },
      status: "published",
      limit: 10000,
    }
    if (locale) params.locale = locale

    const allLocal = await docs(strapi, uid).findMany(params)

    for (const local of allLocal) {
      const gid = local.gatewayId as string | undefined
      if (gid && !seenIds.has(gid)) {
        await docs(strapi, uid).unpublish({
          documentId: local.documentId,
          ...(locale && { locale: "*" }),
        })
        count++
      }
    }
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Soft-delete pass for ${uid} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return count
}
