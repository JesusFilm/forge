import type { Metadata } from "next"
import { CoverageReportClient } from "@/features/coverage/coverage-report-client"
import { listJobs } from "@/lib/state"
import type { JobRecord } from "@/types/job"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Coverage -- Forge Manager",
}

type CoveragePageSearchParams = {
  languageId?: string
  languageIds?: string
  refresh?: string
}

function parseRequestedLanguageIds(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }

  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams?: Promise<CoveragePageSearchParams | undefined>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  let initialErrorMessage: string | null = null
  let initialJobs: JobRecord[] = []

  try {
    initialJobs = await listJobs()
  } catch (error) {
    initialErrorMessage =
      error instanceof Error ? error.message : "Unable to load job data."
  }

  // Extract unique languages from all jobs
  const allLanguages = new Set<string>()
  for (const job of initialJobs) {
    for (const lang of job.languages) {
      allLanguages.add(lang)
    }
  }

  const initialLanguages = Array.from(allLanguages).map((lang) => ({
    id: lang,
    englishLabel: lang,
    nativeLabel: lang,
  }))

  const requestedLanguageIds = parseRequestedLanguageIds(
    resolvedSearchParams?.languageIds ?? resolvedSearchParams?.languageId,
  )

  let initialSelectedLanguageIds = requestedLanguageIds.filter((id) =>
    allLanguages.has(id),
  )

  if (initialSelectedLanguageIds.length === 0 && initialLanguages.length > 0) {
    initialSelectedLanguageIds = [initialLanguages[0].id]
  }

  // Filter jobs by selected languages if any are selected
  const filteredJobs =
    initialSelectedLanguageIds.length > 0
      ? initialJobs.filter((job) =>
          job.languages.some((lang) =>
            initialSelectedLanguageIds.includes(lang),
          ),
        )
      : initialJobs

  return (
    <main className="coverage-main">
      <CoverageReportClient
        gatewayConfigured={true}
        initialLanguages={initialLanguages}
        initialJobs={filteredJobs}
        initialSelectedLanguageIds={initialSelectedLanguageIds}
        initialErrorMessage={initialErrorMessage}
      />
    </main>
  )
}
