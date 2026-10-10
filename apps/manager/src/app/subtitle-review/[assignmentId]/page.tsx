import { SubtitleReviewWorkspace } from "@/features/subtitle-lab/subtitle-review-workspace"
import { requireReviewerAuth } from "@/lib/require-auth"

export default async function SubtitleReviewAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const [reviewer, { assignmentId }] = await Promise.all([
    requireReviewerAuth(),
    params,
  ])
  return (
    <SubtitleReviewWorkspace
      assignmentId={assignmentId}
      reviewerLanguages={reviewer.reviewerLanguageGrants.map((grant) => ({
        languageId: grant.languageId,
        languageSlug: grant.languageSlug,
        ...(grant.languageBcp47 ? { languageBcp47: grant.languageBcp47 } : {}),
        specialistAllowed:
          grant.permittedRubricDimensions.includes("SCRIPTURE_THEOLOGY") &&
          (grant.specialistCapabilities.scripture ||
            grant.specialistCapabilities.theology),
      }))}
    />
  )
}
