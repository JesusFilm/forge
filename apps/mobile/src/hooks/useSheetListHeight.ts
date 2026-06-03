import { useEffect, useState } from "react"
import { useNavigation } from "expo-router"

import { LIST_SHEET_DETENTS } from "../styles/shared"

// react-native-screens emits `sheetDetentChange` with the index into
// sheetAllowedDetents. It's not in expo-router's typed event map, so the name
// is cast and the payload typed locally — in one place rather than per sheet.
type SheetDetentChangeEvent = { data?: { index?: number } }

/**
 * Height for a FlashList inside a formSheet.
 *
 * FlashList needs a CONCRETE height to virtualize, but the formSheet content
 * root is unbounded so onLayout can't measure it (it reads back our own fixed
 * height — circular). Derive the height from the native detent index instead:
 * track the current detent and return LIST_SHEET_DETENTS[index] * windowHeight,
 * seeded at the initial (index 0) detent.
 *
 * The listener registers once on [navigation] (reading windowHeight through the
 * derived return, not the closure) so a rotation/font-scale change mid-drag
 * can't drop a detent event by tearing the listener down. The state update
 * bails when the index is unchanged, so a per-frame event stream during a drag
 * doesn't thrash renders. The height is derived (not stored), so it also tracks
 * windowHeight changes without an extra effect.
 */
export function useSheetListHeight(windowHeight: number): number {
  const [detentIndex, setDetentIndex] = useState(0)
  const navigation = useNavigation()

  useEffect(() => {
    const unsub = navigation.addListener(
      "sheetDetentChange" as never,
      (e: SheetDetentChangeEvent) => {
        const idx = e?.data?.index ?? 0
        setDetentIndex((prev) => (prev === idx ? prev : idx))
      },
    )
    return unsub
  }, [navigation])

  const fraction = LIST_SHEET_DETENTS[detentIndex] ?? LIST_SHEET_DETENTS[0]
  return Math.round(windowHeight * fraction)
}
