import type { Metadata } from "next"
import { CoverageReportClient } from "@/features/coverage/coverage-report-client"
import {
  resolveRequestedLanguageIds,
  type CoverageLanguageSearchParams,
} from "@/features/coverage/language-selection"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Coverage -- Forge Manager",
}

export default async function CoveragePage({
  searchParams,
}: {
  searchParams?: Promise<CoverageLanguageSearchParams | undefined>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const requestedLanguageIds = resolveRequestedLanguageIds(resolvedSearchParams)

  return (
    <CoverageReportClient
      gatewayConfigured={true}
      initialLanguages={[]}
      initialSelectedLanguageIds={requestedLanguageIds}
      initialErrorMessage={null}
    />
  )
}
