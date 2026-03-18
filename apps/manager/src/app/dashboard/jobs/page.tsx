import React from "react"
import { listJobs } from "@/lib/state"
import { LiveJobsTable } from "@/features/jobs/live-jobs-table"
import { NewJobForm } from "./new-job-form"

export const dynamic = "force-dynamic"

export default async function JobsPage() {
  const jobs = await listJobs()

  return (
    <>
      <NewJobForm />
      <LiveJobsTable initialJobs={jobs} />
    </>
  )
}
