import { useCallback } from "react"
import { useRouter } from "expo-router"

import { SubtitleSheetContent } from "../../src/components/watch/SubtitleSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function SubtitleSheetRoute() {
  const router = useRouter()
  const {
    video,
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

  // Video present but its variant isn't enriched yet → loading, not empty.
  if (video && !activeVariant) return <SheetLoading />
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
