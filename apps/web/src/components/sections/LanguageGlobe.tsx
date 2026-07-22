import type { AdminFragmentOf } from "@forge/admin-graphql"
import { adminLanguageGlobeFragment } from "@forge/admin-graphql/fragments"

import { getWatchLanguageIndex } from "@/lib/language-index"
import { LanguageGlobeClient } from "./LanguageGlobeClient"
import { selectLanguageGlobeEntries } from "./language-globe-model"

export async function LanguageGlobe({
  data,
}: {
  data: AdminFragmentOf<typeof adminLanguageGlobeFragment>
}) {
  let languages: ReturnType<typeof selectLanguageGlobeEntries> = []
  let metadataUnavailable = false

  try {
    const index = await getWatchLanguageIndex()
    languages = selectLanguageGlobeEntries(
      index.languages,
      data.languageLimit ?? 12,
      index.globeLocationsByPublicSlug,
    )
  } catch (error) {
    metadataUnavailable = true
    console.error(
      "[language-globe] Language metadata was unavailable; rendering the contained fallback.",
      error instanceof Error ? error.message : "Unknown error",
    )
  }

  return (
    <LanguageGlobeClient
      sectionKey={data.sectionKey}
      heading={data.heading ?? "Explore stories in your language"}
      description={
        data.description ??
        "Choose a language to discover videos from around the world."
      }
      backgroundColor={data.backgroundColor ?? "#071526"}
      languages={languages}
      metadataUnavailable={metadataUnavailable}
    />
  )
}
