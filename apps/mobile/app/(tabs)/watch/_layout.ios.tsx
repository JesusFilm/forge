import { Stack } from "expo-router"

import { BG_COLOR } from "../../../src/lib/color"
import { canUseLiquidGlass } from "../../../src/lib/liquidGlass"

/**
 * The native search field lives in this stack's header (feat-699 KTD9), so
 * the header shows only where Discover mounts `Stack.SearchBar`. Before
 * iOS 26 the screen keeps its own field and the header stays hidden.
 */
export default function DiscoverLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: canUseLiquidGlass(),
        headerTransparent: true,
        title: "",
        contentStyle: { backgroundColor: BG_COLOR },
      }}
    />
  )
}
