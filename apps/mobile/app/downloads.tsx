import { useLocalSearchParams } from "expo-router"

import { LibraryDownloads } from "../src/components/library/LibraryDownloads"

// A root route, so no tab bar sits under the list (KTD1). `?series=<slug>`
// opens at that series card, as a rail tile tap asks (KTD5).
export default function DownloadsScreen() {
  const { series } = useLocalSearchParams<{ series?: string }>()

  return (
    <LibraryDownloads
      focusSeriesSlug={
        typeof series === "string" && series.length > 0 ? series : undefined
      }
    />
  )
}
