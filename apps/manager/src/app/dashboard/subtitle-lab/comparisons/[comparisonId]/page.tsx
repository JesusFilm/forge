import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import { SubtitleRunComparison } from "@/features/subtitle-lab/subtitle-run-comparison"
import { requireAuth } from "@/lib/require-auth"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Subtitle experiment comparison — Studio",
}

export default async function SubtitleLabComparisonPage({
  params,
}: {
  params: Promise<{ comparisonId: string }>
}) {
  await requireAuth()
  const { comparisonId } = await params
  if (!BOUNDED_ID.safeParse(comparisonId).success) notFound()
  const comparison = await (
    await SubtitleLabAdminClient.configured()
  ).getComparison(comparisonId)
  if (!comparison) notFound()

  return (
    <div className="studio-page studio-page--subtitle-lab">
      <SubtitleRunComparison comparison={comparison} />
    </div>
  )
}
