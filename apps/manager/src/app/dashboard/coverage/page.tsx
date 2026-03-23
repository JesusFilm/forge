import type { Metadata } from "next"
import { CoverageReportClient } from "@/features/coverage/coverage-report-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Coverage -- Forge Manager",
}

type CoveragePageSearchParams = {
  languageId?: string
  languageIds?: string
}

function parseRequestedLanguageIds(raw: string | undefined): string[] {
  if (!raw) return []
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
  const requestedLanguageIds = parseRequestedLanguageIds(
    resolvedSearchParams?.languageIds ?? resolvedSearchParams?.languageId,
  )

  return (
    <CoverageReportClient
      gatewayConfigured={true}
      initialLanguages={[]}
      initialSelectedLanguageIds={requestedLanguageIds}
      initialErrorMessage={null}
    />
  )
}
