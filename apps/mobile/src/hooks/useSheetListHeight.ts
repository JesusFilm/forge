import { useEffect, useState } from "react"
import { useNavigation } from "expo-router"

import { LIST_SHEET_DETENTS } from "../styles/shared"

// react-native-screens emits `sheetDetentChange` with the index into
// sheetAllowedDetents. It's not in expo-router's typed event map, so the name
// is cast and the payload typed locally — in one place rather than per sheet.
type SheetDetentChangeEvent = { data?: { index?: number } }

/**
 * Concrete FlashList height for a formSheet. Unbounded content makes onLayout
 * circular, so derive LIST_SHEET_DETENTS[index] * windowHeight from the native
 * detent index. Listener registers once on [navigation]; height is derived not stored.
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
