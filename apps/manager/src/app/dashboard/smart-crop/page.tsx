import { SmartCropScreen } from "@/features/smart-crop/smart-crop-screen"
import { listJobs } from "@/lib/state"

export const dynamic = "force-dynamic"

export default async function SmartCropPage() {
  const jobs = await listJobs({ limit: 100 })
  const smartCropJobs = jobs.filter((job) => job.options.smartCrop != null)

  return (
    <div className="studio-page studio-page--smart-crop">
      <SmartCropScreen initialJobs={smartCropJobs} />
    </div>
  )
}
