import { VideoDbBackupError } from "./errors"

export const VIDEO_DB_BACKUP_MAX_AGE_HOURS = 36
export const VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS =
  VIDEO_DB_BACKUP_MAX_AGE_HOURS * 60 * 60 * 1000

export type VideoDbBackupObjectMetadata = {
  key?: string
  size?: number
  lastModified?: Date
}

export type VideoDbBackupObjectPage = {
  objects: readonly VideoDbBackupObjectMetadata[]
  isTruncated?: boolean
  nextContinuationToken?: string
}

type VideoDbBackupFreshnessBase = {
  evaluatedAt: string
  thresholdHours: number
  thresholdMilliseconds: number
}

export type VideoDbBackupFreshnessAvailable = VideoDbBackupFreshnessBase & {
  status: "fresh" | "stale"
  key: string
  size?: number
  lastModified: string
  ageMilliseconds: number
}

export type VideoDbBackupFreshness =
  | VideoDbBackupFreshnessAvailable
  | (VideoDbBackupFreshnessBase & {
      status: "not-found"
    })
  | (VideoDbBackupFreshnessBase & {
      status: "unavailable-metadata"
      key: string
      size?: number
      reason: "missing-or-invalid-last-modified"
    })

export function classifyVideoDbBackupFreshness(
  objects: readonly VideoDbBackupObjectMetadata[],
  evaluatedAt = new Date(Date.now()),
): VideoDbBackupFreshness {
  const evaluation = {
    evaluatedAt: evaluatedAt.toISOString(),
    thresholdHours: VIDEO_DB_BACKUP_MAX_AGE_HOURS,
    thresholdMilliseconds: VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS,
  }
  let sawDump = false
  let unavailable: (VideoDbBackupObjectMetadata & { key: string }) | undefined
  let latest:
    | (VideoDbBackupObjectMetadata & { key: string; lastModified: Date })
    | undefined

  for (const object of objects) {
    const key = object.key
    if (typeof key !== "string" || !key.endsWith(".dump")) continue

    sawDump = true
    const lastModified = object.lastModified
    if (
      !(lastModified instanceof Date) ||
      !Number.isFinite(lastModified.getTime())
    ) {
      unavailable ??= { ...object, key }
      continue
    }
    if (!latest || lastModified.getTime() > latest.lastModified.getTime()) {
      latest = { ...object, key, lastModified }
    }
  }

  if (!sawDump) return { status: "not-found", ...evaluation }
  if (unavailable) {
    return {
      status: "unavailable-metadata",
      key: unavailable.key,
      size: unavailable.size,
      reason: "missing-or-invalid-last-modified",
      ...evaluation,
    }
  }

  if (!latest) {
    throw new VideoDbBackupError(
      "Video DB backup freshness classification reached an invalid state",
    )
  }

  const ageMilliseconds = evaluatedAt.getTime() - latest.lastModified.getTime()
  return {
    status:
      ageMilliseconds <= VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS
        ? "fresh"
        : "stale",
    key: latest.key,
    size: latest.size,
    lastModified: latest.lastModified.toISOString(),
    ageMilliseconds,
    ...evaluation,
  }
}

export async function discoverVideoDbBackupFreshnessFromPages(
  loadPage: (continuationToken?: string) => Promise<VideoDbBackupObjectPage>,
): Promise<VideoDbBackupFreshness> {
  const objects: VideoDbBackupObjectMetadata[] = []
  let continuationToken: string | undefined

  while (true) {
    const page = await loadPage(continuationToken)
    objects.push(...page.objects)
    if (!page.isTruncated) break
    if (!page.nextContinuationToken) {
      throw new VideoDbBackupError(
        "Backup object listing was truncated without a continuation token",
      )
    }
    continuationToken = page.nextContinuationToken
  }

  return classifyVideoDbBackupFreshness(objects)
}
