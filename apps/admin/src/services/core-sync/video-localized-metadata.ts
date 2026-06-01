import type { Prisma, PrismaClient } from "@prisma/client"

import { toStudyQuestions, toVideoLocales } from "./transforms"

type CoreLocalizedValue = {
  value: string
  primary?: boolean | null
  order?: number | null
  language?: {
    id?: string | null
    bcp47?: string | null
  } | null
}

export type CoreVideoLocalizedMetadata = {
  id: string
  publishedAt?: string | null
  title: CoreLocalizedValue[]
  description: CoreLocalizedValue[]
  snippet: CoreLocalizedValue[]
  imageAlt: CoreLocalizedValue[]
  studyQuestions: Array<CoreLocalizedValue & { id: string }>
}

export type AdminVideoLocalizedMetadataTarget = {
  id: string
  coreId: string
  source?: "CORE" | "MANAGER"
  publishedAt?: Date | string | null
}

export type VideoLocalizedMetadataStats = {
  videosProcessed: number
  videoLocalesUpserted: number
  videoLocalesStaled: number
  studyQuestionsUpserted: number
  studyQuestionsStaled: number
  skippedLanguages: number
  errors: number
}

export type VideoLocalizedMetadataDiagnostic = {
  event: string
  videoCoreId: string
  languageCoreId?: string | null
  locale?: string | null
  reason: string
}

export type VideoLocalizedMetadataResult = VideoLocalizedMetadataStats & {
  diagnostics: VideoLocalizedMetadataDiagnostic[]
}

type WritablePrisma = PrismaClient | Prisma.TransactionClient

export type SyncVideoLocalizedMetadataOptions = {
  prisma: WritablePrisma
  adminVideos: readonly AdminVideoLocalizedMetadataTarget[]
  coreVideos: readonly CoreVideoLocalizedMetadata[]
  languageIdByCoreId: ReadonlyMap<string, string>
  bcp47ByCoreId: ReadonlyMap<string, string | null | undefined>
  complete?: boolean
  now?: Date
}

const emptyResult = (): VideoLocalizedMetadataResult => ({
  videosProcessed: 0,
  videoLocalesUpserted: 0,
  videoLocalesStaled: 0,
  studyQuestionsUpserted: 0,
  studyQuestionsStaled: 0,
  skippedLanguages: 0,
  errors: 0,
  diagnostics: [],
})

export async function syncVideoLocalizedMetadata({
  prisma,
  adminVideos,
  coreVideos,
  languageIdByCoreId,
  bcp47ByCoreId,
  complete = true,
  now = new Date(),
}: SyncVideoLocalizedMetadataOptions): Promise<VideoLocalizedMetadataResult> {
  const result = emptyResult()
  const adminByCoreId = new Map(
    adminVideos.map((video) => [video.coreId, video]),
  )

  for (const coreVideo of coreVideos) {
    const adminVideo = adminByCoreId.get(coreVideo.id)
    if (!adminVideo) {
      result.errors++
      result.diagnostics.push({
        event: "core-sync.video-localized-metadata.missing-admin-video",
        videoCoreId: coreVideo.id,
        reason: "admin_video_missing",
      })
      continue
    }
    if (adminVideo.source === "MANAGER") continue

    result.videosProcessed++
    const touchedLocaleIds: string[] = []
    const touchedStudyQuestionIds: string[] = []
    const skippedLanguagesBeforeVideo = result.skippedLanguages
    const publishedAt =
      adminVideo.publishedAt == null
        ? null
        : adminVideo.publishedAt instanceof Date
          ? adminVideo.publishedAt
          : new Date(adminVideo.publishedAt)

    for (const localeRow of toVideoLocales(
      {
        title: coreVideo.title,
        description: coreVideo.description,
        snippet: coreVideo.snippet,
        imageAlt: coreVideo.imageAlt,
      },
      { bcp47ByCoreId: new Map(bcp47ByCoreId) },
    )) {
      const languageId = resolveLanguageId({
        videoCoreId: coreVideo.id,
        languageCoreId: localeRow.languageCoreId,
        locale: localeRow.locale,
        languageIdByCoreId,
        result,
      })
      if (languageId === undefined) continue

      const existing =
        languageId != null
          ? await prisma.videoLocale.findFirst({
              where: { videoId: adminVideo.id, languageId },
              select: { id: true, source: true },
            })
          : null
      const localeExisting =
        existing == null && localeRow.locale != null
          ? await prisma.videoLocale.findFirst({
              where: { videoId: adminVideo.id, locale: localeRow.locale },
              select: { id: true, source: true },
            })
          : existing
      const existingLocale = existing ?? localeExisting
      if (existingLocale?.source === "MANAGER") continue

      const data = {
        locale: localeRow.locale,
        languageId,
        title: localeRow.title,
        description: localeRow.description,
        snippet: localeRow.snippet,
        imageAlt: localeRow.imageAlt,
        status: "PUBLISHED" as const,
        publishedAt,
        source: "CORE" as const,
        syncedAt: now,
        deletedAt: null,
      }

      const saved = existingLocale
        ? await prisma.videoLocale.update({
            where: { id: existingLocale.id },
            data,
            select: { id: true },
          })
        : await prisma.videoLocale.create({
            data: {
              videoId: adminVideo.id,
              ...data,
            },
            select: { id: true },
          })
      touchedLocaleIds.push(saved.id)
      result.videoLocalesUpserted++
    }

    for (const question of toStudyQuestions(coreVideo.studyQuestions, {
      bcp47ByCoreId: new Map(bcp47ByCoreId),
    })) {
      const languageId = resolveLanguageId({
        videoCoreId: coreVideo.id,
        languageCoreId: question.languageCoreId,
        locale: question.locale,
        languageIdByCoreId,
        result,
      })
      if (languageId === undefined) continue

      const existing =
        languageId != null
          ? await prisma.videoStudyQuestion.findFirst({
              where: { coreId: question.coreId, languageId },
              select: { id: true, source: true },
            })
          : null
      const localeExisting =
        existing == null
          ? await prisma.videoStudyQuestion.findFirst({
              where: { coreId: question.coreId, locale: question.locale },
              select: { id: true, source: true },
            })
          : existing
      const existingQuestion = existing ?? localeExisting
      if (existingQuestion?.source === "MANAGER") continue

      const data = {
        videoId: adminVideo.id,
        locale: question.locale,
        languageId,
        text: question.text,
        primary: question.primary,
        order: question.order,
        source: "CORE" as const,
        syncedAt: now,
        deletedAt: null,
      }

      const saved = existingQuestion
        ? await prisma.videoStudyQuestion.update({
            where: { id: existingQuestion.id },
            data,
            select: { id: true },
          })
        : await prisma.videoStudyQuestion.create({
            data: {
              coreId: question.coreId,
              ...data,
            },
            select: { id: true },
          })
      touchedStudyQuestionIds.push(saved.id)
      result.studyQuestionsUpserted++
    }

    const skippedLanguagesForVideo =
      result.skippedLanguages - skippedLanguagesBeforeVideo
    if (complete && skippedLanguagesForVideo === 0) {
      const staleLocales = await prisma.videoLocale.updateMany({
        where: {
          videoId: adminVideo.id,
          source: "CORE",
          id: { notIn: touchedLocaleIds },
          deletedAt: null,
        },
        data: { deletedAt: now },
      })
      result.videoLocalesStaled += staleLocales.count

      const staleQuestions = await prisma.videoStudyQuestion.updateMany({
        where: {
          videoId: adminVideo.id,
          source: "CORE",
          id: { notIn: touchedStudyQuestionIds },
          deletedAt: null,
        },
        data: { deletedAt: now },
      })
      result.studyQuestionsStaled += staleQuestions.count
    }
  }

  return result
}

function resolveLanguageId({
  videoCoreId,
  languageCoreId,
  locale,
  languageIdByCoreId,
  result,
}: {
  videoCoreId: string
  languageCoreId: string | null
  locale: string | null
  languageIdByCoreId: ReadonlyMap<string, string>
  result: VideoLocalizedMetadataResult
}): string | null | undefined {
  if (!languageCoreId) return null
  const languageId = languageIdByCoreId.get(languageCoreId)
  if (languageId) return languageId

  result.skippedLanguages++
  result.diagnostics.push({
    event: "core-sync.video-localized-metadata.skipped-language",
    videoCoreId,
    languageCoreId,
    locale,
    reason: "missing_local_language",
  })
  return undefined
}
