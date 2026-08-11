import type { Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { DashboardPageHeader, PageSection } from "@/components/admin-ui"
import { env } from "@/config/env"
import { loadWatchSearchLanguageOptions } from "@/services/watch-search-language-options.service"

import { requireCurrentAdminEvaluator } from "./comparison-actions"
import { WatchSearchComparison } from "./watch-search-comparison"

async function loadLanguageOptions() {
  try {
    return await loadWatchSearchLanguageOptions()
  } catch (error) {
    const errorClass =
      error instanceof Error ? error.constructor.name : "UnknownError"
    console.warn(
      `[watch-search] event=language_options_load_failed error_class=${errorClass}`,
    )
    return []
  }
}

export default async function CompareWatchSearchPage() {
  await requireCurrentAdminEvaluator()
  if (!env.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED) {
    notFound()
  }
  const languageOptions = await loadLanguageOptions()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Private evaluation"
        title="Compare Watch search"
        description="Run the same request through Current and candidate search without changing public Watch traffic."
        action={
          <Link
            href={"/dashboard/search" as Route}
            className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 font-mono text-[11px] uppercase text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Search analytics
          </Link>
        }
      />
      <PageSection
        title="Current and candidate"
        meta="ADMIN_ONLY / SAME_QUERY / PUBLIC_TRAFFIC_UNCHANGED"
      >
        <WatchSearchComparison languageOptions={languageOptions} />
      </PageSection>
    </div>
  )
}
