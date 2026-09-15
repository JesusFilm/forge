"use client"

import { useEffect, useState } from "react"
import type { AdminFragmentOf } from "@forge/admin-graphql"
import { useLocale } from "next-intl"
import type { adminHomepageRecommendationsFragment } from "@forge/admin-graphql/fragments"
import { WatchForYouRecommendations } from "@/components/recommendations/WatchForYouRecommendations"
import { recommendationJsonWithRetry } from "@/lib/recommendation-browser"
import { watchPath } from "@/lib/watch-paths"

export function HomepageRecommendations({
  data,
  locale,
  languageSlug,
}: {
  data: AdminFragmentOf<typeof adminHomepageRecommendationsFragment>
  locale?: string | null
  languageSlug: string
}) {
  const messageLocale = useLocale()
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void recommendationJsonWithRetry<{ enabled?: boolean }>(
      watchPath("/api/recommendations/for-you/availability"),
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
      3000,
    )
      .then((value) => {
        if (!controller.signal.aborted) setEnabled(value.enabled === true)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  if (!enabled) return null
  return (
    <WatchForYouRecommendations
      locale={locale ?? messageLocale}
      audioLanguageSlug={languageSlug}
      title={data.title}
      sectionKey={data.sectionKey}
    />
  )
}
