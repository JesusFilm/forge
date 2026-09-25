import { useMemo } from "react"
import { useRouter } from "expo-router"

import { BibleReader } from "../../src/components/bible/BibleReader"
import { useFloatingObstacles } from "../../src/hooks/usePlaybackFrame"
import { readerSheetCallbacks } from "../../src/lib/bible/routes/sheetCallbacks"

// feat-551 R2, R3, KTD9: the Bible tab. It opens at the saved reading position,
// or at John 3:16, and shares that position with the pushed reader (KD2).
export default function BibleTabScreen() {
  const router = useRouter()
  const callbacks = useMemo(() => readerSheetCallbacks(router), [router])
  // R10: the verse stays clear of the mini player that floats over it.
  const floatingObstacles = useFloatingObstacles()

  return (
    <BibleReader
      host="tab"
      floatingObstacles={floatingObstacles}
      {...callbacks}
    />
  )
}
