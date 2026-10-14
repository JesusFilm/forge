import { useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  runVideoLayout,
  type RunVideoLayout,
} from "../../lib/dailyPause/videoFrame"

/** The top of the run's top row (the close): the safe area's edge on every
 *  step, where the marker row also sits. */
export function useTopRowTop(): number {
  return useSafeAreaInsets().top
}

/** Where the picture, the bar, and the marker row of a video part sit. */
export function useRunVideoLayout(): RunVideoLayout {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  return runVideoLayout(window.width, window.height, insets)
}
