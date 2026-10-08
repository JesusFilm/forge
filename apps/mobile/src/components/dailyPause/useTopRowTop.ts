import { useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { devotionalVideoFrame } from "../../lib/dailyPause/videoFrame"

export type TopRowPlacement = "screen" | "letterbox"

/** The row's height: the 44 pt target of the close and of the developer Skip. */
export const TOP_ROW_HEIGHT = 44

/** The top of the run's top row (the close and the developer Skip). On a
 *  screen it is the safe area. On a video part the row's bottom edge meets the
 *  video's top edge, so it never covers the picture or its captions (R24). */
export function useTopRowTop(
  placement: TopRowPlacement,
  rowHeight: number,
): number {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  if (placement === "screen") return insets.top
  return Math.max(
    0,
    devotionalVideoFrame(window.width, window.height).top - rowHeight,
  )
}
