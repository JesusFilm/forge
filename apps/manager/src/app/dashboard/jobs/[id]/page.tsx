import React from "react"
import { notFound } from "next/navigation"
import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import { LiveJobDetailScreen } from "@/features/jobs/live-job-detail-screen"
import { getJob } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

function buildLanguageLabelsById(
  languages: Array<{ coreId: string; name: string }>,
): Record<string, string> {
  return Object.fromEntries(
    languages.map((language) => [language.coreId, language.name]),
  )
}

async function loadMockJobDetailPageData(
  gateway: ReturnType<typeof getCmsGateway>,
  id: string,
): Promise<{
  job: JobRecord | null
  languageLabelsById: Record<string, string>
}> {
  const mockState = await readMockCmsState(gateway)
  if (!mockState) {
    return { job: null, languageLabelsById: {} }
  }

  return {
    job:
      mockState.readModels.jobs.find((candidate) => candidate.id === id) ??
      null,
    languageLabelsById: buildLanguageLabelsById(
      mockState.readModels.languageGeo.languages.map((language) => ({
        coreId: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

async function loadAdminJobDetailPageData(
  gateway: ReturnType<typeof getCmsGateway>,
  id: string,
): Promise<{
  job: JobRecord | null
  languageLabelsById: Record<string, string>
}> {
  const [job, languageGeo] = await Promise.all([
    getJob(id),
    gateway.getLanguageGeo(),
  ])
  return {
    job,
    languageLabelsById: buildLanguageLabelsById(
      languageGeo.languages.map((language) => ({
        coreId: language.id,
        name: language.englishLabel,
      })),
    ),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const gateway = getCmsGateway()
  const { job, languageLabelsById } =
    gateway.mode === "mock"
      ? await loadMockJobDetailPageData(gateway, id)
      : await loadAdminJobDetailPageData(gateway, id)

  if (!job) {
    notFound()
  }

  return (
    <div className="studio-page studio-page--job-detail">
      <LiveJobDetailScreen
        initialJob={job}
        languageLabelsById={languageLabelsById}
      />
    </div>
  )
}
