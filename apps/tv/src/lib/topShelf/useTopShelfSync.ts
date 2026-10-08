import { useEffect, useState } from "react"
import { AppState, Platform } from "react-native"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import type { WatchHomeModel } from "../watchHome/model"
import type { ContinueWatchingEntry } from "../watchEvents/continueWatching"
import {
  syncTopShelf,
  stopTopShelfSync,
  clearPersonalTopShelf,
  invalidateTopShelfLanguage,
} from "./sync"
import { subscribeRecommendations } from "../recommendations/client"
import { topShelfPreviewEnabled } from "./preview"

export function useTopShelfSync(
  model: WatchHomeModel | null,
  entries: ContinueWatchingEntry[],
  visible: boolean,
  previewOnly = false,
) {
  const {
    audioLanguageSlug,
    hydrated,
    topShelfPreviewStyle,
    setTopShelfPreviewMessage,
    topShelfPreviewRevision,
  } = useWatchPreferences()
  const previewEnabled = topShelfPreviewEnabled(
    process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED,
    Platform.OS,
    Platform.isTV,
  )
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  )
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (Platform.OS === "ios" && Platform.isTV && hydrated && foreground)
      void invalidateTopShelfLanguage(audioLanguageSlug ?? "english").catch(
        () => {},
      )
  }, [audioLanguageSlug, hydrated, foreground])
  useEffect(
    () =>
      subscribeRecommendations(() => {
        void clearPersonalTopShelf()
          .finally(() => setRevision((value) => value + 1))
          .catch(() => {})
      }),
    [],
  )
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    )
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (previewOnly && previewEnabled && topShelfPreviewStyle && !model)
      setTopShelfPreviewMessage("Preparing Top Shelf content…")
    if (
      Platform.OS !== "ios" ||
      !Platform.isTV ||
      !model ||
      !hydrated ||
      !visible ||
      (previewOnly && !(previewEnabled && topShelfPreviewStyle)) ||
      !foreground
    )
      return
    let cancelled = false
    const timer = setTimeout(
      () => {
        void syncTopShelf(
          model,
          entries,
          audioLanguageSlug ?? "english",
          topShelfPreviewStyle,
          previewEnabled && topShelfPreviewStyle
            ? (message) => {
                if (!cancelled) setTopShelfPreviewMessage(message)
              }
            : undefined,
        )
      },
      previewOnly ? 0 : 4000,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
      stopTopShelfSync()
    }
  }, [
    model,
    entries,
    audioLanguageSlug,
    hydrated,
    visible,
    foreground,
    revision,
    previewEnabled,
    topShelfPreviewStyle,
    setTopShelfPreviewMessage,
    topShelfPreviewRevision,
    previewOnly,
  ])
}
