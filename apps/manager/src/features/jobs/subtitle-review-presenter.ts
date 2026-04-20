import {
  getLatestSubtitleReviewRevision,
  isReviewedSubtitleArtifactKey,
} from "@/lib/subtitle-review"
import type { JobRecord } from "@/types/job"

export type PresentedSubtitleReview = {
  sourceArtifactKey: string
  targetLanguage: string
  latestRevision?: number
  latestReviewArtifactKey?: string
  latestReviewedAt?: string
}

function getTargetLanguage(sourceArtifactKey: string): string | null {
  if (
    !sourceArtifactKey.startsWith("subtitles-") ||
    isReviewedSubtitleArtifactKey(sourceArtifactKey)
  ) {
    return null
  }

  const targetLanguage = sourceArtifactKey.slice("subtitles-".length)
  return targetLanguage.length > 0 ? targetLanguage : null
}

export function getPresentedSubtitleReviews(
  job: JobRecord,
): PresentedSubtitleReview[] {
  return Object.entries(job.artifacts)
    .flatMap(([sourceArtifactKey, entry]) => {
      if (entry.kind !== "downloadable") {
        return []
      }

      const targetLanguage = getTargetLanguage(sourceArtifactKey)
      if (!targetLanguage) {
        return []
      }

      const latestRevision = getLatestSubtitleReviewRevision(
        job.artifacts,
        sourceArtifactKey,
      )

      return [
        {
          sourceArtifactKey,
          targetLanguage,
          latestRevision: latestRevision?.revision,
          latestReviewArtifactKey: latestRevision?.artifactKey,
          latestReviewedAt: latestRevision?.createdAt,
        },
      ]
    })
    .sort((left, right) =>
      left.targetLanguage === right.targetLanguage
        ? left.sourceArtifactKey.localeCompare(right.sourceArtifactKey)
        : left.targetLanguage.localeCompare(right.targetLanguage),
    )
}
