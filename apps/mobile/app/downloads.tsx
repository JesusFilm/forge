import { View } from "react-native"
import { useLocalSearchParams } from "expo-router"

import { LibraryDownloads } from "../src/components/library/LibraryDownloads"
import { ScreenTopBar } from "../src/components/ui/ScreenTopBar"
import { layout } from "../src/styles/shared"

// A root route, so no tab bar sits under the list (KTD1). `?series=<slug>`
// opens at that series card, as a rail tile tap asks (KTD5).
export default function DownloadsScreen() {
  const { series } = useLocalSearchParams<{ series?: string }>()

  return (
    <View style={layout.screenContainer}>
      <ScreenTopBar title="Downloads" showBack />
      <LibraryDownloads
        focusSeriesSlug={
          typeof series === "string" && series.length > 0 ? series : undefined
        }
      />
    </View>
  )
}
