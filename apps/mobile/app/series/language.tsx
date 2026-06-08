import { useCallback } from "react"
import { useRouter } from "expo-router"

import { SeriesLanguageSheet } from "../../src/components/series/SeriesLanguageSheet"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"

// formSheet route for the series language picker. Reads the series' language
// union + current selection from the shared session and writes the pick back —
// the screen's hero swaps its trailer dub (best-effort) and the choice persists
// as the audio preference that the tapped episode opens in.
export default function SeriesLanguageRoute() {
  const router = useRouter()
  const { series, languages, selectedLanguageSlug, setSelectedLanguageSlug } =
    useSeriesSession()

  const handleLanguageChange = useCallback(
    (slug: string) => setSelectedLanguageSlug(slug),
    [setSelectedLanguageSlug],
  )

  if (!series) return null

  return (
    <SeriesLanguageSheet
      languages={languages}
      activeLanguageSlug={selectedLanguageSlug ?? ""}
      onLanguageChange={handleLanguageChange}
      onClose={() => router.back()}
    />
  )
}
