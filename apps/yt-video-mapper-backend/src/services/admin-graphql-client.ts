import { adminGraphql } from "@forge/admin-graphql"
import { print } from "graphql"

export const ADMIN_VIDEO_MAPPER_CATALOG_QUERY = adminGraphql(`
  query VideoMapperCatalog($first: Int, $after: String) {
    videoMapperCatalog(first: $first, after: $after) {
      nodes {
        coreId
        sourceTitle
        sourceTitleLocale
        videoVariantId
        adminVideoId
        adminDubId
        languageId
        languageSlug
        locale
        editionCoreId
        editionName
        durationSeconds
        lengthInMilliseconds
        hlsUrl
        dashUrl
        shareUrl
        downloadUrl
        downloadQuality
        downloadWidth
        downloadHeight
        mediaSourceType
        mediaSourceUrl
        videoPublished
        dubPublished
        videoNoIndex
        videoDeleted
        dubDeleted
        deletedAt
        indexable
        nonIndexableReason
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
      }
    }
  }
`)

export type AdminCatalogMediaSourceType = "DOWNLOAD" | "HLS" | "DASH" | "NONE"

export type AdminCatalogItem = {
  coreId: string
  sourceTitle: string
  sourceTitleLocale: string | null
  videoVariantId: string
  adminVideoId: string
  adminDubId: string
  languageId: string | null
  languageSlug: string | null
  locale: string | null
  editionCoreId: string | null
  editionName: string | null
  durationSeconds: number | null
  lengthInMilliseconds: string | null
  hlsUrl: string | null
  dashUrl: string | null
  shareUrl: string | null
  downloadUrl: string | null
  downloadQuality: string | null
  downloadWidth: number | null
  downloadHeight: number | null
  mediaSourceType: AdminCatalogMediaSourceType
  mediaSourceUrl: string | null
  videoPublished: boolean
  dubPublished: boolean
  videoNoIndex: boolean
  videoDeleted: boolean
  dubDeleted: boolean
  deletedAt: string | null
  indexable: boolean
  nonIndexableReason: string | null
}

export type AdminCatalogPageInfo = {
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
}

export type AdminCatalogPage = {
  nodes: AdminCatalogItem[]
  pageInfo: AdminCatalogPageInfo
}

export type AdminCatalogPageInput = {
  first: number
  after?: string | null
}

export type FetchLike = (
  url: string,
  init: {
    method: "POST"
    headers: Record<string, string>
    body: string
  },
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export class AdminGraphqlClientError extends Error {
  constructor(
    message: string,
    readonly code: "http_error" | "graphql_error" | "malformed_response",
    readonly summary: Record<string, unknown>,
  ) {
    super(message)
    this.name = "AdminGraphqlClientError"
  }
}

export class AdminGraphqlClient {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly config: {
      url: string
      bearerToken: string
      fetchImpl?: FetchLike
    },
  ) {
    const globalFetch = globalThis.fetch as unknown as FetchLike | undefined
    const fetchImpl = config.fetchImpl ?? globalFetch
    if (!fetchImpl) {
      throw new AdminGraphqlClientError(
        "Fetch is not available for Admin GraphQL requests",
        "malformed_response",
        { reason: "fetch_unavailable" },
      )
    }
    this.fetchImpl = fetchImpl
  }

  async fetchCatalogPage({
    first,
    after,
  }: AdminCatalogPageInput): Promise<AdminCatalogPage> {
    const variables = {
      first,
      ...(after ? { after } : {}),
    }
    const response = await this.fetchImpl(this.config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.bearerToken}`,
      },
      body: JSON.stringify({
        query: print(ADMIN_VIDEO_MAPPER_CATALOG_QUERY),
        variables,
      }),
    })

    const body = await readJsonResponse(response, this.config.bearerToken)
    if (!response.ok) {
      throw new AdminGraphqlClientError(
        `Admin GraphQL request failed with status ${response.status}`,
        "http_error",
        {
          status: response.status,
          body: summarizeValue(body, this.config.bearerToken),
        },
      )
    }

    if (hasGraphqlErrors(body)) {
      throw new AdminGraphqlClientError(
        "Admin GraphQL returned errors for videoMapperCatalog",
        "graphql_error",
        {
          errors: body.errors.map((error) =>
            summarizeValue(error, this.config.bearerToken),
          ),
        },
      )
    }

    return parseCatalogPage(body)
  }
}

async function readJsonResponse(
  response: Awaited<ReturnType<FetchLike>>,
  bearerToken: string,
): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AdminGraphqlClientError(
      "Admin GraphQL returned a non-JSON response",
      "malformed_response",
      {
        status: response.status,
        body: truncate(redact(text, bearerToken)),
      },
    )
  }
}

function hasGraphqlErrors(
  body: unknown,
): body is { errors: Array<Record<string, unknown>> } {
  if (!isRecord(body)) return false
  return Array.isArray(body.errors) && body.errors.length > 0
}

function parseCatalogPage(body: unknown): AdminCatalogPage {
  if (!isRecord(body) || !isRecord(body.data)) {
    throw malformedResponse("missing data.videoMapperCatalog")
  }
  const connection = body.data.videoMapperCatalog
  if (!isRecord(connection)) {
    throw malformedResponse("missing data.videoMapperCatalog")
  }

  if (!Array.isArray(connection.nodes)) {
    throw malformedResponse("videoMapperCatalog.nodes must be an array")
  }
  const pageInfo = parsePageInfo(connection.pageInfo)

  return {
    nodes: connection.nodes.map((node, index) => parseCatalogItem(node, index)),
    pageInfo,
  }
}

function parsePageInfo(value: unknown): AdminCatalogPageInfo {
  if (!isRecord(value)) {
    throw malformedResponse("videoMapperCatalog.pageInfo is missing")
  }
  return {
    startCursor: nullableString(value.startCursor, "pageInfo.startCursor"),
    endCursor: nullableString(value.endCursor, "pageInfo.endCursor"),
    hasNextPage: booleanValue(value.hasNextPage, "pageInfo.hasNextPage"),
  }
}

function parseCatalogItem(value: unknown, index: number): AdminCatalogItem {
  if (!isRecord(value)) {
    throw malformedResponse(`videoMapperCatalog.nodes[${index}] is invalid`)
  }

  return {
    coreId: requiredString(value.coreId, index, "coreId"),
    sourceTitle: requiredString(value.sourceTitle, index, "sourceTitle"),
    sourceTitleLocale: nullableString(
      value.sourceTitleLocale,
      `nodes[${index}].sourceTitleLocale`,
    ),
    videoVariantId: requiredString(
      value.videoVariantId,
      index,
      "videoVariantId",
    ),
    adminVideoId: requiredString(value.adminVideoId, index, "adminVideoId"),
    adminDubId: requiredString(value.adminDubId, index, "adminDubId"),
    languageId: nullableString(value.languageId, `nodes[${index}].languageId`),
    languageSlug: nullableString(
      value.languageSlug,
      `nodes[${index}].languageSlug`,
    ),
    locale: nullableString(value.locale, `nodes[${index}].locale`),
    editionCoreId: nullableString(
      value.editionCoreId,
      `nodes[${index}].editionCoreId`,
    ),
    editionName: nullableString(
      value.editionName,
      `nodes[${index}].editionName`,
    ),
    durationSeconds: nullableNumber(
      value.durationSeconds,
      `nodes[${index}].durationSeconds`,
    ),
    lengthInMilliseconds: nullableString(
      value.lengthInMilliseconds,
      `nodes[${index}].lengthInMilliseconds`,
    ),
    hlsUrl: nullableString(value.hlsUrl, `nodes[${index}].hlsUrl`),
    dashUrl: nullableString(value.dashUrl, `nodes[${index}].dashUrl`),
    shareUrl: nullableString(value.shareUrl, `nodes[${index}].shareUrl`),
    downloadUrl: nullableString(
      value.downloadUrl,
      `nodes[${index}].downloadUrl`,
    ),
    downloadQuality: nullableString(
      value.downloadQuality,
      `nodes[${index}].downloadQuality`,
    ),
    downloadWidth: nullableNumber(
      value.downloadWidth,
      `nodes[${index}].downloadWidth`,
    ),
    downloadHeight: nullableNumber(
      value.downloadHeight,
      `nodes[${index}].downloadHeight`,
    ),
    mediaSourceType: mediaSourceType(value.mediaSourceType, index),
    mediaSourceUrl: nullableString(
      value.mediaSourceUrl,
      `nodes[${index}].mediaSourceUrl`,
    ),
    videoPublished: booleanValue(
      value.videoPublished,
      `nodes[${index}].videoPublished`,
    ),
    dubPublished: booleanValue(
      value.dubPublished,
      `nodes[${index}].dubPublished`,
    ),
    videoNoIndex: booleanValue(
      value.videoNoIndex,
      `nodes[${index}].videoNoIndex`,
    ),
    videoDeleted: booleanValue(
      value.videoDeleted,
      `nodes[${index}].videoDeleted`,
    ),
    dubDeleted: booleanValue(value.dubDeleted, `nodes[${index}].dubDeleted`),
    deletedAt: nullableString(value.deletedAt, `nodes[${index}].deletedAt`),
    indexable: booleanValue(value.indexable, `nodes[${index}].indexable`),
    nonIndexableReason: nullableString(
      value.nonIndexableReason,
      `nodes[${index}].nonIndexableReason`,
    ),
  }
}

function requiredString(value: unknown, index: number, field: string): string {
  if (typeof value === "string" && value.length > 0) return value
  throw malformedResponse(`nodes[${index}].${field} must be a non-empty string`)
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  throw malformedResponse(`${field} must be a string or null`)
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw malformedResponse(`${field} must be a number or null`)
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value
  throw malformedResponse(`${field} must be a boolean`)
}

function mediaSourceType(
  value: unknown,
  index: number,
): AdminCatalogMediaSourceType {
  if (
    value === "DOWNLOAD" ||
    value === "HLS" ||
    value === "DASH" ||
    value === "NONE"
  ) {
    return value
  }
  throw malformedResponse(`nodes[${index}].mediaSourceType is invalid`)
}

function malformedResponse(reason: string): AdminGraphqlClientError {
  return new AdminGraphqlClientError(
    "Admin GraphQL response did not match videoMapperCatalog shape",
    "malformed_response",
    { reason },
  )
}

function summarizeValue(value: unknown, bearerToken: string): unknown {
  if (typeof value === "string") return truncate(redact(value, bearerToken))
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => summarizeValue(item, bearerToken))
  }
  if (!isRecord(value)) return String(value)

  const summary: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 10)) {
    if (key.toLowerCase().includes("authorization")) continue
    summary[key] = summarizeValue(item, bearerToken)
  }
  return summary
}

function redact(value: string, bearerToken: string): string {
  return bearerToken ? value.replaceAll(bearerToken, "[redacted]") : value
}

function truncate(value: string): string {
  return value.length > 300 ? `${value.slice(0, 300)}...` : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
