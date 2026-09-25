import { useWindowDimensions } from "react-native"

// The Bible reader's tablet layout starts at this shortest side (feat-551
// KD9). It is Android's `sw600dp`: the largest iPhone is 440pt across and
// the smallest iPad is 744pt.
export const TABLET_SHORTEST_SIDE = 600

/** The shortest side decides, so a phone turned to landscape stays a phone. */
export function isTabletLayout(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_SHORTEST_SIDE
}

/** Follows the WINDOW, so iPad Split View can switch the layout live. */
export function useIsTabletLayout(): boolean {
  const { width, height } = useWindowDimensions()
  return isTabletLayout(width, height)
}
