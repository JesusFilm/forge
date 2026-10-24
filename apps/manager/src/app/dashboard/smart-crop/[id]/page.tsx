import { notFound } from "next/navigation"
import { SmartCropJobDetail } from "@/features/smart-crop/smart-crop-job-detail"
import { getJob } from "@/lib/state"

export const dynamic = "force-dynamic"

export default async function SmartCropJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    notFound()
  }

  return (
    <div className="studio-page studio-page--smart-crop-detail">
      <SmartCropJobDetail initialJob={job} />
    </div>
  )
}
