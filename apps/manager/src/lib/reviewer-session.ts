export const REVIEWER_RUBRIC_DIMENSIONS = [
  "MEANING_ACCURACY",
  "NATURALNESS",
  "TIMING_READABILITY",
  "SCRIPTURE_THEOLOGY",
] as const

export type ReviewerRubricDimension =
  (typeof REVIEWER_RUBRIC_DIMENSIONS)[number]

export type ReviewerLanguageGrant = {
  id: string
  languageId: string
  languageSlug: string
  languageBcp47?: string
  permittedRubricDimensions: ReviewerRubricDimension[]
  specialistCapabilities: {
    scripture: boolean
    theology: boolean
  }
}

const dimensions = new Set<string>(REVIEWER_RUBRIC_DIMENSIONS)

export function parseReviewerLanguageGrants(
  value: unknown,
): ReviewerLanguageGrant[] | null {
  if (!Array.isArray(value)) return null

  const grants: ReviewerLanguageGrant[] = []
  const identities = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null
    const grant = raw as Record<string, unknown>
    const specialist = grant.specialistCapabilities
    if (
      typeof grant.id !== "string" ||
      !grant.id ||
      typeof grant.languageId !== "string" ||
      !grant.languageId ||
      typeof grant.languageSlug !== "string" ||
      !grant.languageSlug ||
      (grant.languageBcp47 !== undefined &&
        typeof grant.languageBcp47 !== "string") ||
      !Array.isArray(grant.permittedRubricDimensions) ||
      !grant.permittedRubricDimensions.every(
        (dimension) =>
          typeof dimension === "string" && dimensions.has(dimension),
      ) ||
      !specialist ||
      typeof specialist !== "object" ||
      typeof (specialist as Record<string, unknown>).scripture !== "boolean" ||
      typeof (specialist as Record<string, unknown>).theology !== "boolean"
    ) {
      return null
    }

    const identity = `${grant.languageId}\u0000${grant.languageSlug}`
    if (identities.has(identity)) return null
    identities.add(identity)

    grants.push({
      id: grant.id,
      languageId: grant.languageId,
      languageSlug: grant.languageSlug,
      ...(grant.languageBcp47
        ? { languageBcp47: grant.languageBcp47 as string }
        : {}),
      permittedRubricDimensions:
        grant.permittedRubricDimensions as ReviewerRubricDimension[],
      specialistCapabilities: {
        scripture: (specialist as Record<string, boolean>).scripture,
        theology: (specialist as Record<string, boolean>).theology,
      },
    })
  }

  return grants
}

/** Exact Admin language identity check. BCP-47 is intentionally absent. */
export function hasReviewerLanguageGrant(
  grants: readonly ReviewerLanguageGrant[],
  languageId: string,
  languageSlug: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.languageId === languageId && grant.languageSlug === languageSlug,
  )
}
