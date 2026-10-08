"use client"

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { WatchChromeShell } from "@/components/WatchChromeShell"

type WatchLoadingRouteParams = {
  locale?: string | string[]
}

export function WatchRouteLoadingShell() {
  const params = useParams<WatchLoadingRouteParams>()
  const t = useTranslations("ExperienceSkeleton")
  const locale = typeof params.locale === "string" ? params.locale : "en"

  return (
    <WatchChromeShell locale={locale} loadingOnly>
      <div
        role="status"
        aria-busy="true"
        aria-label={t("loadingContent")}
        className="mx-auto min-h-screen max-w-7xl px-6 pt-28 md:px-12"
      >
        <div aria-hidden="true" className="flex flex-col gap-8 py-12">
          <div className="h-10 w-1/2 animate-pulse rounded bg-stone-800" />
          <div className="h-56 w-full animate-pulse rounded-lg bg-stone-800" />
          <div className="h-48 w-full animate-pulse rounded-lg bg-stone-800" />
        </div>
      </div>
    </WatchChromeShell>
  )
}
