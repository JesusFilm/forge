import { notFound } from "next/navigation"
import { ShortsJobDetail } from "@/features/shorts/shorts-job-detail"
import { getJob } from "@/lib/state"

export const dynamic = "force-dynamic"

export default async function ShortsJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJob(id)

  if (!job || !job.options.shorts) {
    notFound()
  }

  return (
    <div className="studio-page studio-page--shorts-detail">
      <ShortsJobDetail initialJob={job} />
    </div>
  )
}
