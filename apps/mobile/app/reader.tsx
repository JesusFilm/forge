import { useMemo } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"

import { BibleReader } from "../src/components/bible/BibleReader"
import { useFloatingWindowFrame } from "../src/hooks/usePlaybackFrame"
import { parseReaderRouteParams } from "../src/lib/bible/routes/readerRoute"
import { readerSheetCallbacks } from "../src/lib/bible/routes/sheetCallbacks"

// feat-551 R1, R6, KTD9: the reader pushed over the watch screen. It opens at
// the verse in its params (`readerHref`), and back returns to the screen below.
// The root layout narrows the iOS back swipe to the left edge for this route.
export default function ReaderRoute() {
  const router = useRouter()
  const { startRef, source } = parseReaderRouteParams(useLocalSearchParams())
  const callbacks = useMemo(() => readerSheetCallbacks(router), [router])
  // R10: the verse stays clear of the mini player that floats over it.
  const windowFrame = useFloatingWindowFrame()
  const floatingObstacles = useMemo(
    () => (windowFrame ? [windowFrame] : undefined),
    [windowFrame],
  )

  return (
    <BibleReader
      host="pushed"
      source={source}
      startRef={startRef}
      onBack={() => router.back()}
      floatingObstacles={floatingObstacles}
      {...callbacks}
    />
  )
}
