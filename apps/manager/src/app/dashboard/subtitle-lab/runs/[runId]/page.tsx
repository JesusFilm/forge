import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import { SubtitleRunReport } from "@/features/subtitle-lab/subtitle-run-report"
import { requireAuth } from "@/lib/require-auth"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Subtitle evaluation report — Studio",
}

export default async function SubtitleLabRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  await requireAuth()
  const { runId } = await params
  if (!BOUNDED_ID.safeParse(runId).success) notFound()

  const client = await SubtitleLabAdminClient.configured()
  const run = await client.getRun(runId)
  if (!run) notFound()

  const exactLanguages = Array.from(
    new Map(
      run.cells.map((cell) => [
        `${cell.targetLanguageId}\u0000${cell.targetLanguageSlug}`,
        {
          id: cell.targetLanguageId,
          slug: cell.targetLanguageSlug,
        },
      ]),
    ).values(),
  )
  const [assignmentPage, candidatePages] = await Promise.all([
    client.listOperatorAssignments(run.id, undefined, 50),
    Promise.all(
      exactLanguages.map((language) =>
        client.listOperatorReviewerCandidates(
          language.id,
          language.slug,
          undefined,
          50,
        ),
      ),
    ),
  ])
  const reviewerCandidates = Array.from(
    new Map(
      candidatePages
        .flatMap((page) => page.nodes)
        .map((candidate) => [
          `${candidate.membershipId}\u0000${candidate.targetLanguageId}\u0000${candidate.targetLanguageSlug}`,
          candidate,
        ]),
    ).values(),
  )

  return (
    <div className="studio-page studio-page--subtitle-lab">
      <SubtitleRunReport
        assignments={assignmentPage.nodes}
        reviewerCandidates={reviewerCandidates}
        run={run}
      />
    </div>
  )
}
