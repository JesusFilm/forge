import { useMemo } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"

import { BibleReader } from "../src/components/bible/BibleReader"
import { parseReaderRouteParams } from "../src/lib/bible/routes/readerRoute"
import { readerSheetCallbacks } from "../src/lib/bible/routes/sheetCallbacks"

// feat-551 R1, R6, KTD9: the reader pushed over the watch screen. It opens at
// the verse in its params (`readerHref`), and back returns to the screen below.
// The root layout narrows the iOS back swipe to the left edge for this route.
export default function ReaderRoute() {
  const router = useRouter()
  const { startRef } = parseReaderRouteParams(useLocalSearchParams())
  const callbacks = useMemo(() => readerSheetCallbacks(router), [router])

  return (
    <BibleReader
      host="pushed"
      startRef={startRef}
      onBack={() => router.back()}
      {...callbacks}
    />
  )
}
