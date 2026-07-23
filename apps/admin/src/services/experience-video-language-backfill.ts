import type { PrismaClient } from "@prisma/client"

export type VideoLanguageBackfillDb = {
  language: Pick<PrismaClient["language"], "findFirst">
  videoDub: Pick<PrismaClient["videoDub"], "findMany">
}

type BlockRecord = Record<string, unknown>

export type BackfillExperienceVideoLanguageIdsResult = {
  blocks: unknown
  changed: boolean
  updatedRecords: number
  targetLanguageId: string | null
  fallbackLanguageId: string | null
}

function asRecord(value: unknown): BlockRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function collectMissingLanguageVideoIds(value: unknown, ids: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMissingLanguageVideoIds(item, ids))
    return
  }

  const record = asRecord(value)
  if (!record) return

  const videoId = asString(record.videoId)
  if (videoId && !asString(record.languageId)) {
    ids.add(videoId)
  }

  Object.values(record).forEach((item) =>
    collectMissingLanguageVideoIds(item, ids),
  )
}

function hasStaticStreamUrl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasStaticStreamUrl)

  const record = asRecord(value)
  if (!record) return false

  if (Object.hasOwn(record, "streamingUrl")) return true

  return Object.values(record).some(hasStaticStreamUrl)
}

function reconcileVideoLanguageIdentity(
  value: unknown,
  languageIdForVideoId: ReadonlyMap<string, string>,
): { value: unknown; changed: boolean; updatedRecords: number } {
  if (Array.isArray(value)) {
    let changed = false
    let updatedRecords = 0
    const items = value.map((item) => {
      const result = reconcileVideoLanguageIdentity(item, languageIdForVideoId)
      changed ||= result.changed
      updatedRecords += result.updatedRecords
      return result.value
    })
    return { value: changed ? items : value, changed, updatedRecords }
  }

  const record = asRecord(value)
  if (!record) return { value, changed: false, updatedRecords: 0 }

  let changed = false
  let updatedRecords = 0
  const next: BlockRecord = {}

  for (const [key, item] of Object.entries(record)) {
    const result = reconcileVideoLanguageIdentity(item, languageIdForVideoId)
    next[key] = result.value
    changed ||= result.changed
    updatedRecords += result.updatedRecords
  }

  const videoId = asString(record.videoId)
  const existingLanguageId = asString(record.languageId)
  const languageId =
    existingLanguageId || (videoId ? languageIdForVideoId.get(videoId) : null)
  let recordChanged = false

  if (languageId && !existingLanguageId) {
    next.languageId = languageId
    changed = true
    recordChanged = true
  }

  if (Object.hasOwn(record, "streamingUrl")) {
    delete next.streamingUrl
    changed = true
    recordChanged = true
  }

  if (recordChanged) updatedRecords += 1

  return { value: changed ? next : value, changed, updatedRecords }
}

async function languageIdForLocale(
  prisma: VideoLanguageBackfillDb,
  locale: string,
): Promise<string | null> {
  const language = await prisma.language.findFirst({
    where: {
      deletedAt: null,
      OR: [{ bcp47: locale }, { slug: locale }, { iso3: locale }],
    },
    select: { id: true },
  })
  return language?.id ?? null
}

export async function backfillExperienceVideoLanguageIds({
  prisma,
  blocks,
  locale,
  fallbackLocale = "en",
}: {
  prisma: VideoLanguageBackfillDb
  blocks: unknown
  locale: string
  fallbackLocale?: string
}): Promise<BackfillExperienceVideoLanguageIdsResult> {
  const videoIds = new Set<string>()
  collectMissingLanguageVideoIds(blocks, videoIds)
  const hasStreamCleanup = hasStaticStreamUrl(blocks)

  if (videoIds.size === 0 && !hasStreamCleanup) {
    return {
      blocks,
      changed: false,
      updatedRecords: 0,
      targetLanguageId: null,
      fallbackLanguageId: null,
    }
  }

  if (videoIds.size === 0) {
    const result = reconcileVideoLanguageIdentity(cloneJson(blocks), new Map())
    return {
      blocks: result.value,
      changed: result.changed,
      updatedRecords: result.updatedRecords,
      targetLanguageId: null,
      fallbackLanguageId: null,
    }
  }

  const [targetLanguageId, fallbackLanguageId] = await Promise.all([
    languageIdForLocale(prisma, locale),
    languageIdForLocale(prisma, fallbackLocale),
  ])
  const fallback = fallbackLanguageId ?? targetLanguageId

  if (!fallback) {
    return {
      blocks,
      changed: false,
      updatedRecords: 0,
      targetLanguageId,
      fallbackLanguageId,
    }
  }

  const targetAvailableVideoIds = new Set<string>()
  if (targetLanguageId) {
    const rows = await prisma.videoDub.findMany({
      where: {
        videoId: { in: [...videoIds] },
        languageId: targetLanguageId,
        deletedAt: null,
        published: true,
        OR: [
          { hls: { not: null } },
          { dash: { not: null } },
          { share: { not: null } },
        ],
        video: { deletedAt: null },
      },
      select: { videoId: true },
      distinct: ["videoId"],
    })
    rows.forEach((row) => targetAvailableVideoIds.add(row.videoId))
  }

  const languageIdForVideoId = new Map<string, string>()
  videoIds.forEach((videoId) => {
    languageIdForVideoId.set(
      videoId,
      targetAvailableVideoIds.has(videoId) && targetLanguageId
        ? targetLanguageId
        : fallback,
    )
  })

  const result = reconcileVideoLanguageIdentity(
    cloneJson(blocks),
    languageIdForVideoId,
  )
  return {
    blocks: result.value,
    changed: result.changed,
    updatedRecords: result.updatedRecords,
    targetLanguageId,
    fallbackLanguageId,
  }
}
