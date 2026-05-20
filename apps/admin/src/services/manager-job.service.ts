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

function toJobRecord(row: ManagerJobRow): ManagerJobRecord {
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
    ...(row.sourceCollectionTitle
      ? { sourceCollectionTitle: row.sourceCollectionTitle }
      : {}),
    ...(row.sourceMediaTitle ? { sourceMediaTitle: row.sourceMediaTitle } : {}),
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

  async list({ user, limit = 50 }: { user: Principal | null; limit?: number }) {
    assertManagerJobAccess(user)
    const rows = await this.prisma.managerEnrichmentJob.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    })
    return rows.map((row) => toJobRecord(row))
  }

  async get({ user, id }: { user: Principal | null; id: string }) {
    assertManagerJobAccess(user)
    const row = await this.prisma.managerEnrichmentJob.findUnique({
      where: { id },
    })
    if (!row) {
      throw new NotFoundError("Manager enrichment job", id)
    }
    return toJobRecord(row)
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
