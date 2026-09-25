import { StyleSheet, View } from "react-native"

import { useExploreFocus } from "../../src/hooks/useExploreFocus"
import { isExploreAvailable } from "../../src/lib/explore/availability"
import { layout } from "../../src/styles/shared"

export default function ExploreTab() {
  // KTD16: the Android button hides, but the route stays reachable by URL.
  if (!isExploreAvailable()) return null
  return <ExploreRoute />
}

// A separate component, so the gate check above never skips a hook.
function ExploreRoute() {
  const { hasFocused } = useExploreFocus()

  return (
    <View style={layout.screenContainer}>
      {hasFocused ? (
        <View testID="explore-feed-slot" style={StyleSheet.absoluteFill} />
      ) : null}
    </View>
  )
}
