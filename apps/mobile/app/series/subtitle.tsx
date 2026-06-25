import { useCallback } from "react"
import { useRouter } from "expo-router"

import { SubtitleSheetContent } from "../../src/components/watch/SubtitleSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { SheetError } from "../../src/components/watch/SheetError"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import { useSeriesSubtitleUnion } from "../../src/hooks/useSeriesSubtitleUnion"
import { reconcileSeriesSubtitleSlug } from "../../src/lib/subtitleSelection"

// formSheet route for the series subtitle picker. Subtitles live per-dub, so the
// union is resolved lazily for the selected audio language; the pick persists
// app-wide, mirroring how the series language sheet sets audio.
export default function SeriesSubtitleRoute() {
  const router = useRouter()
  const { series, selectedLanguageSlug } = useSeriesSession()
  const {
    subtitleLanguageSlug,
    subtitlesEnabled,
    setPreferredSubtitleLanguage,
    setPreferredSubtitleName,
    setSubtitlesEnabled,
  } = useWatchPreferences()

  const { subtitles, loading, error, retry } = useSeriesSubtitleUnion(
    series?.episodes ?? null,
    selectedLanguageSlug,
    true,
  )

  const handleSubtitleChange = useCallback(
    (enabled: boolean, slug: string | null, isUserSelection: boolean) => {
      setSubtitlesEnabled(enabled)
      // A bare toggle must not overwrite the cross-content preference with the
      // series' reconciled fallback slug — only a deliberate row pick persists.
      if (!isUserSelection) return
      setPreferredSubtitleLanguage(slug)
      // Cache the display name so the pill paints on a cold load (subtitle names
      // come from this lazy fetch, so the slug alone can't be mapped later).
      const name = slug
        ? (subtitles?.find((s) => s.languageSlug === slug)?.languageName ??
          null)
        : null
      setPreferredSubtitleName(name)
    },
    [
      subtitles,
      setSubtitlesEnabled,
      setPreferredSubtitleLanguage,
      setPreferredSubtitleName,
    ],
  )

  if (!series || !selectedLanguageSlug) return <SheetLoading />
  if (error)
    return (
      <SheetError
        message="Couldn't load subtitles. Check your connection and try again."
        onRetry={retry}
      />
    )
  if (subtitles == null || loading) return <SheetLoading />

  // Highlight the track the series actually uses (the preference resolved against
  // what it offers), so the "Current" row matches the detail-page pill. Null when
  // off or unsupported → no "Current" row, never a track the series doesn't carry.
  const activeSlug = reconcileSeriesSubtitleSlug(
    subtitlesEnabled,
    subtitleLanguageSlug,
    subtitles,
    series.primaryLanguageBcp47,
  )

  return (
    <SubtitleSheetContent
      subtitles={subtitles}
      subtitleEnabled={subtitlesEnabled}
      activeSubtitleSlug={activeSlug}
      onSubtitleChange={handleSubtitleChange}
      onClose={() => router.back()}
    />
  )
}
