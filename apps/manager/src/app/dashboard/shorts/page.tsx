import { ShortsScreen } from "@/features/shorts/shorts-screen"
import { listJobs } from "@/lib/state"

export const dynamic = "force-dynamic"

export default async function ShortsPage() {
  const jobs = await listJobs({ limit: 100 })
  const shortsJobs = jobs.filter((job) => job.options.shorts != null)

  return (
    <div className="studio-page studio-page--shorts">
      <ShortsScreen initialJobs={shortsJobs} />
    </div>
  )
}
