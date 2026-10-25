import type { Metadata } from "next"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import { SubtitleLabDashboard } from "@/features/subtitle-lab/subtitle-lab-dashboard"
import { requireAuth } from "@/lib/require-auth"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Subtitle Quality Lab — Studio",
}

export default async function SubtitleLabPage({
  searchParams,
}: {
  searchParams?: Promise<{
    corpusId?: string | string[]
  }>
}) {
  await requireAuth()
  const query = await searchParams
  const requestedCorpusId =
    typeof query?.corpusId === "string" ? query.corpusId : undefined
  const corpusId = BOUNDED_ID.safeParse(requestedCorpusId)
  const client = await SubtitleLabAdminClient.configured()
  const [runs, issues, corpus] = await Promise.all([
    client.listRuns(25),
    client.listReferenceIssues("OPEN", 25),
    corpusId.success ? client.getCorpusVersion(corpusId.data) : null,
  ])

  return (
    <div className="studio-page studio-page--subtitle-lab">
      <SubtitleLabDashboard
        initialCorpus={corpus}
        initialReferenceIssues={issues.nodes}
        initialRuns={runs.nodes}
      />
    </div>
  )
}
