import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "./errors"

export type ManagerJobStatus = "pending" | "running" | "completed" | "failed"
export type ManagerStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export type ManagerJobStep = {
  name: string
  status: ManagerStepStatus
  retries: number
  startedAt?: string
  finishedAt?: string
  error?: string
  details?: unknown
}

export type ManagerJobRecord = {
  id: string
  muxAssetId: string
  muxPlaybackId: string
  videoDocumentId?: string
  languages: string[]
  sourceLanguageId?: string
  sourceLanguageCode?: string
  sourceSelectionReason?: string
  primaryRequestedTargetLanguageCode?: string
  resolvedTargetLanguageCodes?: string[]
  sourceCollectionTitle?: string
  sourceMediaTitle?: string
  requestedLanguageAbbreviations?: string[]
  options: unknown
  status: ManagerJobStatus
  currentStep?: string
  retries: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  artifacts: unknown
  steps: ManagerJobStep[]
  errors: unknown[]
}

type CreateInput = {
  muxAssetId: string
  muxPlaybackId?: string
  videoDocumentId?: string
  languages?: string[]
  sourceLanguageId?: string
  sourceLanguageCode?: string
  sourceSelectionReason?: string
  primaryRequestedTargetLanguageCode?: string
  resolvedTargetLanguageCodes?: string[]
  sourceCollectionTitle?: string
  sourceMediaTitle?: string
  requestedLanguageAbbreviations?: string[]
  options?: unknown
  status?: ManagerJobStatus
  currentStep?: string
  retries?: number
  artifacts?: unknown
  steps?: ManagerJobStep[]
  errors?: unknown[]
  startedAt?: Date | null
  completedAt?: Date | null
}

type UpdateInput = Partial<CreateInput>

type ManagerJobRow = {
  id: string
  muxAssetId: string
  muxPlaybackId: string | null
  videoDocumentId: string | null
  languages: string[]
  sourceLanguageId: string | null
  sourceLanguageCode: string | null
  sourceSelectionReason: string | null
  primaryRequestedTargetLanguageCode: string | null
  resolvedTargetLanguageCodes: string[]
  sourceCollectionTitle: string | null
  sourceMediaTitle: string | null
  requestedLanguageAbbreviations: string[]
  options: unknown
  status: string
  currentStep: string | null
  retries: number
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  completedAt: Date | null
  artifacts: unknown
  steps: unknown
  errors: unknown
}

type SourceTitleFallback = {
  sourceCollectionTitle?: string
  sourceMediaTitle?: string
}

type VideoTitleLocale = {
  locale: string | null
  title: string | null
}

type VideoTitleFallbackRow = {
  id: string
  locales: VideoTitleLocale[]
  parents: Array<{
    parent: {
      locales: VideoTitleLocale[]
    } | null
  }>
}

function assertManagerJobAccess(user: Principal | null) {
  if (!hasPermission(user, "write:manager-jobs")) {
    throw new ForbiddenError()
  }
}

function asDateString(value: Date | null): string | undefined {
  return value?.toISOString()
}

function toJobSteps(value: unknown): ManagerJobStep[] {
  return Array.isArray(value) ? (value as ManagerJobStep[]) : []
}

function trimNonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function titleFromLocales(locales: VideoTitleLocale[]): string | undefined {
  const titledLocales = locales
    .map((locale) => ({
      locale: locale.locale,
      title: trimNonBlank(locale.title),
    }))
    .filter(
      (locale): locale is { locale: string | null; title: string } =>
        locale.title != null,
    )

  return (
    titledLocales.find((locale) => locale.locale === "en")?.title ??
    titledLocales[0]?.title
  )
}

function sourceTitleFallbackFromVideo(
  video: VideoTitleFallbackRow,
): SourceTitleFallback {
  const parentTitles = Array.from(
    new Set(
      video.parents
        .map((relation) =>
          relation.parent
            ? titleFromLocales(relation.parent.locales)
            : undefined,
        )
        .filter((title): title is string => title != null),
    ),
  )

  return {
    sourceMediaTitle: titleFromLocales(video.locales),
    sourceCollectionTitle:
      parentTitles.length > 0 ? parentTitles.join(", ") : undefined,
  }
}

async function loadSourceTitleFallbacks(
  prisma: PrismaClient,
  rows: ManagerJobRow[],
): Promise<Map<string, SourceTitleFallback>> {
  const videoIds = Array.from(
    new Set(
      rows
        .filter((row) => !row.sourceMediaTitle || !row.sourceCollectionTitle)
        .map((row) => trimNonBlank(row.videoDocumentId))
        .filter((id): id is string => id != null),
    ),
  )

  if (videoIds.length === 0) {
    return new Map()
  }

  const videos = await prisma.video.findMany({
    where: { id: { in: videoIds }, deletedAt: null },
    include: {
      locales: {
        where: { deletedAt: null, title: { not: null } },
        select: { locale: true, title: true },
        orderBy: [{ locale: "asc" }, { updatedAt: "desc" }],
      },
      parents: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: {
          parent: {
            include: {
              locales: {
                where: { deletedAt: null, title: { not: null } },
                select: { locale: true, title: true },
                orderBy: [{ locale: "asc" }, { updatedAt: "desc" }],
              },
            },
          },
        },
      },
    },
  })

  return new Map(
    videos.map((video) => [
      video.id,
      sourceTitleFallbackFromVideo(video as VideoTitleFallbackRow),
    ]),
  )
}

function toJobRecord(
  row: ManagerJobRow,
  sourceTitleFallback: SourceTitleFallback = {},
): ManagerJobRecord {
  const sourceCollectionTitle =
    trimNonBlank(row.sourceCollectionTitle) ??
    sourceTitleFallback.sourceCollectionTitle
  const sourceMediaTitle =
    trimNonBlank(row.sourceMediaTitle) ?? sourceTitleFallback.sourceMediaTitle

  return {
    id: row.id,
    muxAssetId: row.muxAssetId,
    muxPlaybackId: row.muxPlaybackId ?? "",
    ...(row.videoDocumentId ? { videoDocumentId: row.videoDocumentId } : {}),
    languages: row.languages,
    ...(row.sourceLanguageId ? { sourceLanguageId: row.sourceLanguageId } : {}),
    ...(row.sourceLanguageCode
      ? { sourceLanguageCode: row.sourceLanguageCode }
      : {}),
    ...(row.sourceSelectionReason
      ? { sourceSelectionReason: row.sourceSelectionReason }
      : {}),
    ...(row.primaryRequestedTargetLanguageCode
      ? {
          primaryRequestedTargetLanguageCode:
            row.primaryRequestedTargetLanguageCode,
        }
      : {}),
    resolvedTargetLanguageCodes: row.resolvedTargetLanguageCodes,
    ...(sourceCollectionTitle ? { sourceCollectionTitle } : {}),
    ...(sourceMediaTitle ? { sourceMediaTitle } : {}),
    requestedLanguageAbbreviations: row.requestedLanguageAbbreviations,
    options: row.options,
    status: row.status as ManagerJobStatus,
    ...(row.currentStep ? { currentStep: row.currentStep } : {}),
    retries: row.retries,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(asDateString(row.startedAt)
      ? { startedAt: asDateString(row.startedAt) }
      : {}),
    ...(asDateString(row.completedAt)
      ? { completedAt: asDateString(row.completedAt) }
      : {}),
    artifacts: row.artifacts,
    steps: toJobSteps(row.steps),
    errors: Array.isArray(row.errors) ? row.errors : [],
  }
}

function toPrismaJson(
  value: unknown,
  fallback: unknown,
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? fallback)) as Prisma.InputJsonValue
}

export class ManagerJobService {
  constructor(private prisma: PrismaClient) {}

  async list({
    user,
    limit = 50,
    offset = 0,
  }: {
    user: Principal | null
    limit?: number
    offset?: number
  }) {
    assertManagerJobAccess(user)
    const rows = await this.prisma.managerEnrichmentJob.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, limit),
      skip: Math.max(0, offset),
    })
    const titleFallbacksByVideoId = await loadSourceTitleFallbacks(
      this.prisma,
      rows,
    )
    return rows.map((row) =>
      toJobRecord(
        row,
        row.videoDocumentId
          ? (titleFallbacksByVideoId.get(row.videoDocumentId) ?? {})
          : {},
      ),
    )
  }

  async count({ user }: { user: Principal | null }) {
    assertManagerJobAccess(user)
    return this.prisma.managerEnrichmentJob.count()
  }

  async get({ user, id }: { user: Principal | null; id: string }) {
    assertManagerJobAccess(user)
    const row = await this.prisma.managerEnrichmentJob.findUnique({
      where: { id },
    })
    if (!row) {
      throw new NotFoundError("Manager enrichment job", id)
    }
    const titleFallbacksByVideoId = await loadSourceTitleFallbacks(
      this.prisma,
      [row],
    )
    return toJobRecord(
      row,
      row.videoDocumentId
        ? (titleFallbacksByVideoId.get(row.videoDocumentId) ?? {})
        : {},
    )
  }

  async create({
    user,
    input,
  }: {
    user: Principal | null
    input: CreateInput
  }) {
    assertManagerJobAccess(user)
    const row = await this.prisma.managerEnrichmentJob.create({
      data: {
        muxAssetId: input.muxAssetId,
        muxPlaybackId: input.muxPlaybackId ?? "",
        videoDocumentId: input.videoDocumentId,
        languages: input.languages ?? [],
        sourceLanguageId: input.sourceLanguageId,
        sourceLanguageCode: input.sourceLanguageCode,
        sourceSelectionReason: input.sourceSelectionReason,
        primaryRequestedTargetLanguageCode:
          input.primaryRequestedTargetLanguageCode,
        resolvedTargetLanguageCodes: input.resolvedTargetLanguageCodes ?? [],
        sourceCollectionTitle: input.sourceCollectionTitle,
        sourceMediaTitle: input.sourceMediaTitle,
        requestedLanguageAbbreviations:
          input.requestedLanguageAbbreviations ?? [],
        options: toPrismaJson(input.options, {}),
        status: input.status ?? "pending",
        currentStep: input.currentStep ?? input.steps?.[0]?.name,
        retries: input.retries ?? 0,
        artifacts: toPrismaJson(input.artifacts, {}),
        steps: toPrismaJson(input.steps, []),
        errors: toPrismaJson(input.errors, []),
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    })
    return toJobRecord(row)
  }

  async update({
    user,
    id,
    input,
  }: {
    user: Principal | null
    id: string
    input: UpdateInput
  }) {
    assertManagerJobAccess(user)
    const data: Prisma.ManagerEnrichmentJobUpdateInput = {}
    if (input.muxAssetId !== undefined) data.muxAssetId = input.muxAssetId
    if (input.muxPlaybackId !== undefined) {
      data.muxPlaybackId = input.muxPlaybackId
    }
    if (input.videoDocumentId !== undefined) {
      data.videoDocumentId = input.videoDocumentId
    }
    if (input.languages !== undefined) data.languages = input.languages
    if (input.sourceLanguageId !== undefined) {
      data.sourceLanguageId = input.sourceLanguageId
    }
    if (input.sourceLanguageCode !== undefined) {
      data.sourceLanguageCode = input.sourceLanguageCode
    }
    if (input.sourceSelectionReason !== undefined) {
      data.sourceSelectionReason = input.sourceSelectionReason
    }
    if (input.primaryRequestedTargetLanguageCode !== undefined) {
      data.primaryRequestedTargetLanguageCode =
        input.primaryRequestedTargetLanguageCode
    }
    if (input.resolvedTargetLanguageCodes !== undefined) {
      data.resolvedTargetLanguageCodes = input.resolvedTargetLanguageCodes
    }
    if (input.sourceCollectionTitle !== undefined) {
      data.sourceCollectionTitle = input.sourceCollectionTitle
    }
    if (input.sourceMediaTitle !== undefined) {
      data.sourceMediaTitle = input.sourceMediaTitle
    }
    if (input.requestedLanguageAbbreviations !== undefined) {
      data.requestedLanguageAbbreviations = input.requestedLanguageAbbreviations
    }
    if (input.status !== undefined) data.status = input.status
    if (input.currentStep !== undefined) data.currentStep = input.currentStep
    if (input.retries !== undefined) data.retries = input.retries
    if (input.artifacts !== undefined) {
      data.artifacts = toPrismaJson(input.artifacts, {})
    }
    if (input.steps !== undefined) {
      data.steps = toPrismaJson(input.steps, [])
    }
    if (input.errors !== undefined) {
      data.errors = toPrismaJson(input.errors, [])
    }
    if (input.options !== undefined) {
      data.options = toPrismaJson(input.options, {})
    }
    if (input.startedAt !== undefined) data.startedAt = input.startedAt
    if (input.completedAt !== undefined) data.completedAt = input.completedAt

    const row = await this.prisma.managerEnrichmentJob.update({
      where: { id },
      data,
    })
    return toJobRecord(row)
  }
}
