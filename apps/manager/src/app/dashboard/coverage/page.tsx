import type { Metadata } from "next"
import { CoverageReportClient } from "@/features/coverage/coverage-report-client"
import {
  resolveRequestedLanguageIds,
  type CoverageLanguageSearchParams,
} from "@/features/coverage/language-selection"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Coverage -- Studio",
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams?: Promise<CoverageLanguageSearchParams | undefined>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const requestedLanguageIds = resolveRequestedLanguageIds(resolvedSearchParams)

  return (
    <div className="studio-page studio-page--coverage">
      <CoverageReportClient
        gatewayConfigured={true}
        initialLanguages={[]}
        initialSelectedLanguageIds={requestedLanguageIds}
        initialErrorMessage={null}
      />
    </div>
  )
}
