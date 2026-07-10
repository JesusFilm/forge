import { getMuxSyncReport } from "@/lib/mux-sync-report"
import type { JobRecord } from "@/types/job"
import type {
  JobReviewContext,
  JobReviewContextResult,
  ReviewChapterTrack,
  ReviewChaptersDomain,
  ReviewLanguageOption,
  ReviewMode,
  ReviewPlayerState,
  ReviewSubtitleDomain,
  ReviewTextTrack,
} from "./review-player-types"

export type { JobReviewContextResult } from "./review-player-types"

type BuildReviewPlayerStateInput = {
  job: JobRecord
  reviewContext: JobReviewContextResult
  selection?: {
    mode?: ReviewMode
    language?: string
  }
}

function getTracks(domain: ReviewSubtitleDomain): ReviewTextTrack[] {
  return domain.status === "available" ? domain.tracks : []
}

function getChapterTrack(
  domain: ReviewChaptersDomain,
): ReviewChapterTrack | null {
  return domain.status === "available" ? (domain.value.track ?? null) : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const ordered = new Set<string>()

  for (const value of values) {
    if (!value) {
      continue
    }

    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      continue
    }

    ordered.add(normalized)
  }

  return [...ordered]
}

function hasSnapshotData(snapshot: JobReviewContext["after"]): boolean {
  return (
    getTracks(snapshot.subtitles).length > 0 ||
    snapshot.metadata.status === "available" ||
    snapshot.chapters.status === "available"
  )
}

function buildLanguageOptions(
  beforeTracks: ReviewTextTrack[],
  afterTracks: ReviewTextTrack[],
  codes: string[],
): ReviewLanguageOption[] {
  return codes.map((code) => {
    const afterTrack = afterTracks.find((track) => track.languageCode === code)
    const beforeTrack = beforeTracks.find(
      (track) => track.languageCode === code,
    )

    return {
      code,
      label: afterTrack?.label ?? beforeTrack?.label ?? code.toUpperCase(),
      beforeAvailable: beforeTrack != null,
      afterAvailable: afterTrack != null,
    }
  })
}

function chooseDefaultLanguage(
  job: JobRecord,
  beforeTracks: ReviewTextTrack[],
  afterTracks: ReviewTextTrack[],
  explicitLanguage?: string,
): string | null {
  if (explicitLanguage) {
    return explicitLanguage.toLowerCase()
  }

  const afterLanguages = new Set(afterTracks.map((track) => track.languageCode))

  if (
    job.primaryRequestedTargetLanguageCode &&
    afterLanguages.has(job.primaryRequestedTargetLanguageCode.toLowerCase())
  ) {
    return job.primaryRequestedTargetLanguageCode.toLowerCase()
  }

  for (const language of job.resolvedTargetLanguageCodes ?? []) {
    const normalized = language.toLowerCase()
    if (afterLanguages.has(normalized)) {
      return normalized
    }
  }

  const sortedAfter = [...afterLanguages].sort()
  if (sortedAfter.length > 0) {
    return sortedAfter[0] ?? null
  }

  if (job.sourceLanguageCode) {
    return job.sourceLanguageCode.toLowerCase()
  }

  const sortedBefore = [
    ...new Set(beforeTracks.map((track) => track.languageCode)),
  ].sort()

  return sortedBefore[0] ?? null
}

export function buildReviewPlayerState({
  job,
  reviewContext,
  selection,
}: BuildReviewPlayerStateInput): ReviewPlayerState {
  if (reviewContext.status === "failed") {
    return {
      status: "failed",
      message: reviewContext.message,
    }
  }

  if (reviewContext.status === "unsupported") {
    return {
      status: "unsupported",
      message: reviewContext.message,
    }
  }

  const mode = selection?.mode ?? "after"
  const context = reviewContext.context
  const beforeTracks = getTracks(context.before.subtitles)
  const afterTracks = getTracks(context.after.subtitles)
  const language = chooseDefaultLanguage(
    job,
    beforeTracks,
    afterTracks,
    selection?.language,
  )

  const languages = buildLanguageOptions(
    beforeTracks,
    afterTracks,
    uniqueStrings([
      ...afterTracks.map((track) => track.languageCode),
      ...beforeTracks.map((track) => track.languageCode),
      job.primaryRequestedTargetLanguageCode,
      ...(job.resolvedTargetLanguageCodes ?? []),
      job.sourceLanguageCode,
      language,
    ]),
  )

  const snapshot = mode === "after" ? context.after : context.before
  const track =
    language != null
      ? (getTracks(snapshot.subtitles).find(
          (candidate) => candidate.languageCode === language,
        ) ?? null)
      : null

  const hasData = hasSnapshotData(snapshot)

  return {
    status: hasData ? "ready" : "loaded_empty",
    mode,
    language,
    languages,
    player: {
      src: context.playbackUrl,
      track,
      chapterTrack: getChapterTrack(snapshot.chapters),
      ...(track == null ? { emptyMessage: "No subtitle track available" } : {}),
    },
    metadata: snapshot.metadata,
    chapters: snapshot.chapters,
    compare: {
      muxSyncComparison:
        language != null
          ? getMuxSyncReport(job.artifacts)?.comparisons.find(
              (comparison) => comparison.targetLanguage === language,
            )
          : undefined,
    },
  }
}
