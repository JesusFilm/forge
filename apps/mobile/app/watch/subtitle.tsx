import { useCallback, useEffect } from "react"
import { useRouter } from "expo-router"

import { SubtitleSheetContent } from "../../src/components/watch/SubtitleSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { SheetError } from "../../src/components/watch/SheetError"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function SubtitleSheetRoute() {
  const router = useRouter()
  const {
    video,
    activeVariant,
    activeVariantMedia,
    activeVariantMediaLoading,
    activeVariantMediaError,
    ensureActiveVariantMedia,
    subtitleEnabled,
    activeSubtitleSlug,
    setSubtitleEnabled,
    setActiveSubtitleSlug,
  } = useWatchSession()

  // Subtitles are fetched lazily per dub — kick off the active variant's fetch
  // when the sheet opens (no-op if already loaded / in flight).
  useEffect(() => {
    ensureActiveVariantMedia()
  }, [ensureActiveVariantMedia])

  const handleSubtitleChange = useCallback(
    (enabled: boolean, slug: string | null, isUserSelection: boolean) => {
      setSubtitleEnabled(enabled)
      // Only a deliberate row pick changes (and persists) the language. A bare
      // toggle keeps the already-resolved track without overwriting the pref.
      if (isUserSelection) setActiveSubtitleSlug(slug)
    },
    [setSubtitleEnabled, setActiveSubtitleSlug],
  )

  // Video present but its variant isn't enriched yet → loading, not empty.
  if (video && !activeVariant) return <SheetLoading />
  if (!activeVariant) return null
  // Active dub's subtitles still loading → loading, not an empty list.
  if (activeVariantMedia == null && activeVariantMediaLoading)
    return <SheetLoading />
  // Fetch failed → retry, not a misleading empty list.
  if (activeVariantMedia == null && activeVariantMediaError)
    return (
      <SheetError
        message="Couldn't load subtitles. Check your connection and try again."
        onRetry={ensureActiveVariantMedia}
      />
    )

  return (
    <SubtitleSheetContent
      subtitles={activeVariantMedia?.subtitles ?? []}
      subtitleEnabled={subtitleEnabled}
      activeSubtitleSlug={activeSubtitleSlug}
      onSubtitleChange={handleSubtitleChange}
      onClose={() => router.back()}
    />
  )
}
