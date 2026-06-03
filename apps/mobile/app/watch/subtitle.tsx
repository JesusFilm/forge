import { useCallback } from "react"
import { useRouter } from "expo-router"

import { SubtitleSheetContent } from "../../src/components/watch/SubtitleSheet"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function SubtitleSheetRoute() {
  const router = useRouter()
  const {
    activeVariant,
    subtitleEnabled,
    activeSubtitleSlug,
    setSubtitleEnabled,
    setActiveSubtitleSlug,
  } = useWatchSession()

  const handleSubtitleChange = useCallback(
    (enabled: boolean, slug: string | null) => {
      setSubtitleEnabled(enabled)
      setActiveSubtitleSlug(slug)
    },
    [setSubtitleEnabled, setActiveSubtitleSlug],
  )

  if (!activeVariant) return null

  return (
    <SubtitleSheetContent
      subtitles={activeVariant.subtitles}
      subtitleEnabled={subtitleEnabled}
      activeSubtitleSlug={activeSubtitleSlug}
      onSubtitleChange={handleSubtitleChange}
      onClose={() => router.back()}
    />
  )
}
