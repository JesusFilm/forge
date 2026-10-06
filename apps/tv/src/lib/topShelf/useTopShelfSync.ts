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

export function useTopShelfSync(
  model: WatchHomeModel | null,
  entries: ContinueWatchingEntry[],
  visible: boolean,
) {
  const { audioLanguageSlug, hydrated } = useWatchPreferences()
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
    if (
      Platform.OS !== "ios" ||
      !Platform.isTV ||
      !model ||
      !hydrated ||
      !visible ||
      !foreground
    )
      return
    const timer = setTimeout(() => {
      void syncTopShelf(model, entries, audioLanguageSlug ?? "english")
    }, 4000)
    return () => {
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
  ])
}
