import {
  CatalogRunStatus as PrismaCatalogRunStatus,
  MediaSourceType as PrismaMediaSourceType,
  Prisma,
  type CatalogSyncRun,
  type PrismaClient,
} from "../generated/prisma/index.js"
import {
  AdminGraphqlClientError,
  type AdminCatalogItem,
  type AdminCatalogPage,
  type AdminCatalogPageInput,
  type AdminCatalogMediaSourceType,
} from "./admin-graphql-client.js"

export const MISSING_FROM_ADMIN_REASON = "missing_from_admin"

export type CatalogSyncStatus = "running" | "completed" | "failed"

export type CatalogSyncRunRecord = {
  id: string
  status: CatalogSyncStatus
  cursor: string | null
  videosSeen: number
  variantsSeen: number
  variantsIndexable: number
  failureSummary: CatalogSyncFailureSummary | null
  startedAt: Date
  completedAt: Date | null
}

export type CatalogSyncFailureSummary = {
  code: string
  message: string
  cursor: string | null
  page: number
  details?: unknown
  malformedRows?: CatalogSyncMalformedRowSummary[]
}

export type CatalogSyncMalformedRowSummary = {
  index: number
  reason: string
  coreId?: string
  videoVariantId?: string
  adminDubId?: string
}

export type CatalogSyncResult = CatalogSyncRunRecord & {
  missingVariantsMarked: number
}

export type AdminCatalogClient = {
  fetchCatalogPage(input: AdminCatalogPageInput): Promise<AdminCatalogPage>
}

export type CatalogRepository = {
  createSyncRun(input: { startedAt: Date }): Promise<CatalogSyncRunRecord>
  updateSyncRun(
    id: string,
    patch: Partial<
      Pick<
        CatalogSyncRunRecord,
        | "status"
        | "cursor"
        | "videosSeen"
        | "variantsSeen"
        | "variantsIndexable"
        | "failureSummary"
        | "completedAt"
      >
    >,
  ): Promise<CatalogSyncRunRecord>
  upsertCatalogVideo(input: CatalogVideoSyncInput): Promise<void>
  upsertCatalogVariant(input: CatalogVariantSyncInput): Promise<void>
  markVariantsMissingFromSync(input: {
    syncedAt: Date
    reason: string
  }): Promise<number>
}

export type CatalogVideoSyncInput = {
  coreId: string
  title: string
  titleLocale: string | null
  included: boolean
  lastSyncedAt: Date
}

export type CatalogVariantSyncInput = {
  coreId: string
  videoVariantId: string
  adminVideoId: string
  adminDubId: string
  editionCoreId: string | null
  editionName: string | null
  languageId: string | null
  languageSlug: string | null
  locale: string | null
  durationSeconds: number | null
  lengthInMilliseconds: bigint | null
  hlsUrl: string | null
  dashUrl: string | null
  downloadUrl: string | null
  downloadQuality: string | null
  downloadWidth: number | null
  downloadHeight: number | null
  mediaSourceType: AdminCatalogMediaSourceType
  mediaSourceUrl: string | null
  indexable: boolean
  nonIndexableReason: string | null
  published: boolean
  videoPublished: boolean
  dubPublished: boolean
  videoNoIndex: boolean
  videoDeleted: boolean
  dubDeleted: boolean
  deletedAt: Date | null
  lastSyncedAt: Date
}

export class CatalogSyncService {
  constructor(
    private readonly options: {
      client: AdminCatalogClient
      repository: CatalogRepository
      pageSize?: number
      now?: () => Date
    },
  ) {}

  async syncCatalog(): Promise<CatalogSyncResult> {
    const now = this.options.now ?? (() => new Date())
    const syncedAt = now()
    const run = await this.options.repository.createSyncRun({
      startedAt: syncedAt,
    })
    const seenVideoCoreIds = new Set<string>()
    let cursor: string | null = null
    let variantsSeen = 0
    let variantsIndexable = 0
    let page = 0
    let currentRun = run

    try {
      while (true) {
        const adminPage = await this.options.client.fetchCatalogPage({
          first: this.options.pageSize ?? 100,
          after: cursor,
        })
        if (adminPage.pageInfo.hasNextPage && !adminPage.pageInfo.endCursor) {
          throw new CatalogSyncMalformedRowsError([
            {
              index: -1,
              reason: "pageInfo.endCursor is required when hasNextPage=true",
            },
          ])
        }
        const validatedRows = validateCatalogRows(adminPage.nodes)
        const pageVideoInputs = new Map<string, CatalogVideoSyncInput>()
        const pageVariantInputs: CatalogVariantSyncInput[] = []

        for (const row of validatedRows) {
          pageVideoInputs.set(row.coreId, {
            coreId: row.coreId,
            title: row.sourceTitle,
            titleLocale: row.sourceTitleLocale,
            included: true,
            lastSyncedAt: syncedAt,
          })
          pageVariantInputs.push({
            ...toCatalogVariantSyncInput(row),
            lastSyncedAt: syncedAt,
          })
        }

        await Promise.all(
          [...pageVideoInputs.values()].map((input) =>
            this.options.repository.upsertCatalogVideo(input),
          ),
        )
        await Promise.all(
          pageVariantInputs.map((input) =>
            this.options.repository.upsertCatalogVariant(input),
          ),
        )

        for (const row of validatedRows) {
          seenVideoCoreIds.add(row.coreId)
          if (row.indexable) variantsIndexable += 1
        }
        variantsSeen += validatedRows.length

        cursor = adminPage.pageInfo.endCursor
        currentRun = await this.options.repository.updateSyncRun(run.id, {
          cursor,
          videosSeen: seenVideoCoreIds.size,
          variantsSeen,
          variantsIndexable,
        })

        page += 1
        if (!adminPage.pageInfo.hasNextPage) break
      }

      const missingVariantsMarked =
        await this.options.repository.markVariantsMissingFromSync({
          syncedAt,
          reason: MISSING_FROM_ADMIN_REASON,
        })
      currentRun = await this.options.repository.updateSyncRun(run.id, {
        status: "completed",
        completedAt: now(),
      })

      return {
        ...currentRun,
        missingVariantsMarked,
      }
    } catch (error) {
      currentRun = await this.options.repository.updateSyncRun(run.id, {
        status: "failed",
        cursor,
        videosSeen: seenVideoCoreIds.size,
        variantsSeen,
        variantsIndexable,
        completedAt: now(),
        failureSummary: toFailureSummary(error, {
          cursor,
          page,
        }),
      })

      return {
        ...currentRun,
        missingVariantsMarked: 0,
      }
    }
  }
}

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly db: PrismaClient) {}

  async createSyncRun({
    startedAt,
  }: {
    startedAt: Date
  }): Promise<CatalogSyncRunRecord> {
    const run = await this.db.catalogSyncRun.create({
      data: {
        status: PrismaCatalogRunStatus.RUNNING,
        startedAt,
      },
    })

    return fromPrismaSyncRun(run)
  }

  async updateSyncRun(
    id: string,
    patch: Parameters<CatalogRepository["updateSyncRun"]>[1],
  ): Promise<CatalogSyncRunRecord> {
    const run = await this.db.catalogSyncRun.update({
      where: { id },
      data: {
        status: patch.status ? toPrismaRunStatus(patch.status) : undefined,
        cursor: patch.cursor,
        videosSeen: patch.videosSeen,
        variantsSeen: patch.variantsSeen,
        variantsIndexable: patch.variantsIndexable,
        failureSummary: patch.failureSummary
          ? (patch.failureSummary as Prisma.InputJsonValue)
          : undefined,
        completedAt: patch.completedAt,
      },
    })

    return fromPrismaSyncRun(run)
  }

  async upsertCatalogVideo(input: CatalogVideoSyncInput): Promise<void> {
    await this.db.catalogVideo.upsert({
      where: { coreId: input.coreId },
      create: input,
      update: {
        title: input.title,
        titleLocale: input.titleLocale,
        included: input.included,
        lastSyncedAt: input.lastSyncedAt,
      },
    })
  }

  async upsertCatalogVariant(input: CatalogVariantSyncInput): Promise<void> {
    const data = {
      ...input,
      mediaSourceType: toPrismaMediaSourceType(input.mediaSourceType),
    }
    await this.db.catalogVariant.upsert({
      where: {
        coreId_videoVariantId: {
          coreId: input.coreId,
          videoVariantId: input.videoVariantId,
        },
      },
      create: data,
      update: data,
    })
  }

  async markVariantsMissingFromSync({
    syncedAt,
    reason,
  }: {
    syncedAt: Date
    reason: string
  }): Promise<number> {
    const updated = await this.db.catalogVariant.updateMany({
      where: {
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: syncedAt } }],
      },
      data: {
        indexable: false,
        nonIndexableReason: reason,
        published: false,
        dubPublished: false,
        lastSyncedAt: syncedAt,
      },
    })

    return updated.count
  }
}

export class InMemoryCatalogRepository implements CatalogRepository {
  readonly videos = new Map<string, CatalogVideoSyncInput>()
  readonly variants = new Map<string, CatalogVariantSyncInput>()
  readonly runs = new Map<string, CatalogSyncRunRecord>()
  private nextRunNumber = 1

  async createSyncRun({
    startedAt,
  }: {
    startedAt: Date
  }): Promise<CatalogSyncRunRecord> {
    const run: CatalogSyncRunRecord = {
      id: `catalog-sync-run-${this.nextRunNumber++}`,
      status: "running",
      cursor: null,
      videosSeen: 0,
      variantsSeen: 0,
      variantsIndexable: 0,
      failureSummary: null,
      startedAt,
      completedAt: null,
    }
    this.runs.set(run.id, cloneRun(run))
    return cloneRun(run)
  }

  async updateSyncRun(
    id: string,
    patch: Parameters<CatalogRepository["updateSyncRun"]>[1],
  ): Promise<CatalogSyncRunRecord> {
    const run = this.runs.get(id)
    if (!run) throw new Error(`CatalogSyncRun not found: ${id}`)

    const updated = {
      ...run,
      ...patch,
    }
    this.runs.set(id, cloneRun(updated))
    return cloneRun(updated)
  }

  async upsertCatalogVideo(input: CatalogVideoSyncInput): Promise<void> {
    this.videos.set(input.coreId, { ...input })
  }

  async upsertCatalogVariant(input: CatalogVariantSyncInput): Promise<void> {
    this.variants.set(variantKey(input), { ...input })
  }

  async markVariantsMissingFromSync({
    syncedAt,
    reason,
  }: {
    syncedAt: Date
    reason: string
  }): Promise<number> {
    let count = 0
    for (const [key, variant] of this.variants.entries()) {
      if (variant.lastSyncedAt >= syncedAt) continue
      this.variants.set(key, {
        ...variant,
        indexable: false,
        nonIndexableReason: reason,
        published: false,
        dubPublished: false,
        lastSyncedAt: syncedAt,
      })
      count += 1
    }
    return count
  }
}

function validateCatalogRows(rows: AdminCatalogItem[]): AdminCatalogItem[] {
  const malformedRows = rows.flatMap((row, index) => {
    const reason = validateCatalogRow(row)
    return reason == null ? [] : [summarizeMalformedRow(row, index, reason)]
  })

  if (malformedRows.length > 0) {
    throw new CatalogSyncMalformedRowsError(malformedRows)
  }

  return rows
}

function validateCatalogRow(row: AdminCatalogItem): string | null {
  if (!row.coreId) return "coreId is required"
  if (!row.sourceTitle) return "sourceTitle is required"
  if (!row.videoVariantId) return "videoVariantId is required"
  if (!row.adminVideoId) return "adminVideoId is required"
  if (!row.adminDubId) return "adminDubId is required"
  if (row.durationSeconds !== null && !Number.isInteger(row.durationSeconds)) {
    return "durationSeconds must be an integer or null"
  }
  if (
    row.lengthInMilliseconds !== null &&
    !/^\d+$/.test(row.lengthInMilliseconds)
  ) {
    return "lengthInMilliseconds must be a positive integer string or null"
  }
  if (row.indexable && row.mediaSourceUrl == null) {
    return "indexable variants must include mediaSourceUrl"
  }
  if (!row.indexable && !row.nonIndexableReason) {
    return "non-indexable variants must include nonIndexableReason"
  }
  if (
    row.deletedAt !== null &&
    Number.isNaN(new Date(row.deletedAt).getTime())
  ) {
    return "deletedAt must be an ISO timestamp or null"
  }
  return null
}

function toCatalogVariantSyncInput(
  row: AdminCatalogItem,
): Omit<CatalogVariantSyncInput, "lastSyncedAt"> {
  return {
    coreId: row.coreId,
    videoVariantId: row.videoVariantId,
    adminVideoId: row.adminVideoId,
    adminDubId: row.adminDubId,
    editionCoreId: row.editionCoreId,
    editionName: row.editionName,
    languageId: row.languageId,
    languageSlug: row.languageSlug,
    locale: row.locale,
    durationSeconds: row.durationSeconds,
    lengthInMilliseconds:
      row.lengthInMilliseconds == null
        ? null
        : BigInt(row.lengthInMilliseconds),
    hlsUrl: row.hlsUrl,
    dashUrl: row.dashUrl,
    downloadUrl: row.downloadUrl,
    downloadQuality: row.downloadQuality,
    downloadWidth: row.downloadWidth,
    downloadHeight: row.downloadHeight,
    mediaSourceType: row.mediaSourceType,
    mediaSourceUrl: row.mediaSourceUrl,
    indexable: row.indexable,
    nonIndexableReason: row.nonIndexableReason,
    published: row.dubPublished,
    videoPublished: row.videoPublished,
    dubPublished: row.dubPublished,
    videoNoIndex: row.videoNoIndex,
    videoDeleted: row.videoDeleted,
    dubDeleted: row.dubDeleted,
    deletedAt: row.deletedAt == null ? null : new Date(row.deletedAt),
  }
}

function toFailureSummary(
  error: unknown,
  context: {
    cursor: string | null
    page: number
  },
): CatalogSyncFailureSummary {
  if (error instanceof CatalogSyncMalformedRowsError) {
    return {
      code: "malformed_catalog_rows",
      message: "Admin catalog page contained malformed rows",
      cursor: context.cursor,
      page: context.page,
      malformedRows: error.rows,
    }
  }

  if (error instanceof AdminGraphqlClientError) {
    return {
      code: error.code,
      message: error.message,
      cursor: context.cursor,
      page: context.page,
      details: error.summary,
    }
  }

  return {
    code: "catalog_sync_failed",
    message: safeErrorMessage(error),
    cursor: context.cursor,
    page: context.page,
  }
}

function summarizeMalformedRow(
  row: AdminCatalogItem,
  index: number,
  reason: string,
): CatalogSyncMalformedRowSummary {
  return {
    index,
    reason,
    ...safeIdentifier("coreId", row.coreId),
    ...safeIdentifier("videoVariantId", row.videoVariantId),
    ...safeIdentifier("adminDubId", row.adminDubId),
  }
}

function safeIdentifier(key: string, value: unknown): Record<string, string> {
  if (typeof value !== "string" || value.length === 0) return {}
  return { [key]: value.slice(0, 120) }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300)
  return String(error).slice(0, 300)
}

class CatalogSyncMalformedRowsError extends Error {
  constructor(readonly rows: CatalogSyncMalformedRowSummary[]) {
    super("Admin catalog page contained malformed rows")
    this.name = "CatalogSyncMalformedRowsError"
  }
}

function fromPrismaSyncRun(run: CatalogSyncRun): CatalogSyncRunRecord {
  return {
    id: run.id,
    status: fromPrismaRunStatus(run.status),
    cursor: run.cursor,
    videosSeen: run.videosSeen,
    variantsSeen: run.variantsSeen,
    variantsIndexable: run.variantsIndexable,
    failureSummary: run.failureSummary as CatalogSyncFailureSummary | null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  }
}

function toPrismaRunStatus(status: CatalogSyncStatus): PrismaCatalogRunStatus {
  const map = {
    running: PrismaCatalogRunStatus.RUNNING,
    completed: PrismaCatalogRunStatus.COMPLETED,
    failed: PrismaCatalogRunStatus.FAILED,
  } satisfies Record<CatalogSyncStatus, PrismaCatalogRunStatus>

  return map[status]
}

function fromPrismaRunStatus(
  status: PrismaCatalogRunStatus,
): CatalogSyncStatus {
  const map = {
    [PrismaCatalogRunStatus.RUNNING]: "running",
    [PrismaCatalogRunStatus.COMPLETED]: "completed",
    [PrismaCatalogRunStatus.FAILED]: "failed",
  } satisfies Record<PrismaCatalogRunStatus, CatalogSyncStatus>

  return map[status]
}

function toPrismaMediaSourceType(
  sourceType: AdminCatalogMediaSourceType,
): PrismaMediaSourceType {
  const map = {
    DOWNLOAD: PrismaMediaSourceType.DOWNLOAD,
    HLS: PrismaMediaSourceType.HLS,
    DASH: PrismaMediaSourceType.DASH,
    NONE: PrismaMediaSourceType.NONE,
  } satisfies Record<AdminCatalogMediaSourceType, PrismaMediaSourceType>

  return map[sourceType]
}

function variantKey(input: { coreId: string; videoVariantId: string }) {
  return `${input.coreId}:${input.videoVariantId}`
}

function cloneRun(run: CatalogSyncRunRecord): CatalogSyncRunRecord {
  return {
    ...run,
    failureSummary: run.failureSummary
      ? JSON.parse(JSON.stringify(run.failureSummary))
      : null,
  }
}
