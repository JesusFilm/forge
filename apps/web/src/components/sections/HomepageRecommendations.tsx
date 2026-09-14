import type { AdminFragmentOf } from "@forge/admin-graphql"
import { useLocale } from "next-intl"
import type { adminHomepageRecommendationsFragment } from "@forge/admin-graphql/fragments"
import { WatchForYouRecommendations } from "@/components/recommendations/WatchForYouRecommendations"
import { env } from "@/env"

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
  if (env.WATCH_FOR_YOU_ENABLED !== "true") return null
  return (
    <WatchForYouRecommendations
      locale={locale ?? messageLocale}
      audioLanguageSlug={languageSlug}
      title={data.title}
      sectionKey={data.sectionKey}
    />
  )
}
