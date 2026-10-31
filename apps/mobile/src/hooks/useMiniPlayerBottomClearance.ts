import { Platform, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { miniPlayerBottomClearance } from "../lib/miniPlayer/layout"
import { tabBarOccupiedHeightFor } from "../lib/tabBar"

/** The bottom pad a root screen's scroll content needs to clear the floating
 *  window (see `miniPlayerBottomClearance`). Add the screen's own end gap. */
export function useMiniPlayerBottomClearance(): number {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  return miniPlayerBottomClearance({
    screen: { width, height },
    insets,
    tabBarReserve: tabBarOccupiedHeightFor(Platform.OS),
  })
}
