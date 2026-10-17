import { View } from "react-native"

import { ExploreFeed } from "../../src/components/explore/ExploreFeed"
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
  const { focused, hasFocused } = useExploreFocus()

  return (
    <View style={layout.screenContainer}>
      {hasFocused ? <ExploreFeed focused={focused} /> : null}
    </View>
  )
}
