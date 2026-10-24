export const SUBTITLE_REVIEW_RUBRIC_DIMENSIONS = [
  "MEANING_ACCURACY",
  "NATURALNESS",
  "TIMING_READABILITY",
  "SCRIPTURE_THEOLOGY",
] as const

export type SubtitleReviewRubricDimension =
  (typeof SUBTITLE_REVIEW_RUBRIC_DIMENSIONS)[number]

export type ManagerReviewerLanguageGrantProjection = {
  id: string
  languageId: string
  languageSlug: string
  languageBcp47?: string
  permittedRubricDimensions: SubtitleReviewRubricDimension[]
  specialistCapabilities: {
    scripture: boolean
    theology: boolean
  }
}

type ReviewerLanguageGrantSource = {
  id: string
  languageId: string
  permittedRubricDimensions: readonly string[]
  scriptureSpecialist: boolean
  theologySpecialist: boolean
  revokedAt: Date | null
  language: {
    id: string
    slug: string | null
    bcp47: string | null
    deletedAt: Date | null
  }
}

const rubricDimensions = new Set<string>(SUBTITLE_REVIEW_RUBRIC_DIMENSIONS)

/**
 * Project only currently-active grants that are still bound to the exact
 * canonical Admin language row. BCP-47 is deliberately copied only as display
 * metadata and is never consulted while admitting a grant.
 */
export function projectActiveReviewerLanguageGrants(
  grants: readonly ReviewerLanguageGrantSource[],
): ManagerReviewerLanguageGrantProjection[] {
  return grants.flatMap((grant) => {
    if (
      grant.revokedAt ||
      grant.language.deletedAt ||
      grant.language.id !== grant.languageId ||
      !grant.language.slug?.trim()
    ) {
      return []
    }

    const specialist = grant.scriptureSpecialist || grant.theologySpecialist
    const permittedRubricDimensions = Array.from(
      new Set(
        grant.permittedRubricDimensions.filter(
          (dimension): dimension is SubtitleReviewRubricDimension =>
            rubricDimensions.has(dimension) &&
            (dimension !== "SCRIPTURE_THEOLOGY" || specialist),
        ),
      ),
    )

    return [
      {
        id: grant.id,
        languageId: grant.languageId,
        languageSlug: grant.language.slug,
        ...(grant.language.bcp47
          ? { languageBcp47: grant.language.bcp47 }
          : {}),
        permittedRubricDimensions,
        specialistCapabilities: {
          scripture: grant.scriptureSpecialist,
          theology: grant.theologySpecialist,
        },
      },
    ]
  })
}
