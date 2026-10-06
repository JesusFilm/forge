import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useRef } from "react"
import { View, StyleSheet } from "react-native"
import { useFocusEffect } from "expo-router"
import { useWatchHome } from "../../src/hooks/useWatchHome"
import { HomeRail } from "../../src/components/home/HomeRail"
import { ScreenStateView } from "../../src/components/ScreenStateView"
import { resolveHomeCardPath } from "../../src/components/home/homeCardRouting"
import { createFocusMemory } from "../../src/components/home/focusMemory"
import { WATCH_THEME } from "../../src/components/watch/watchDetailTheme"
import { scale } from "../../src/lib/scale"

export default function TopShelfTopicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { model, loading, error, refetch } = useWatchHome()
  const section = model?.sections.find((item) => item.id === id)
  const focus = useRef(createFocusMemory())
  useFocusEffect(
    useCallback(() => {
      const frame = requestAnimationFrame(() => focus.current.restore())
      return () => cancelAnimationFrame(frame)
    }, []),
  )
  return (
    <View style={styles.screen}>
      {section ? (
        <HomeRail
          eyebrow="Choose Your Journey"
          title={section.title}
          cards={section.cards}
          rowIndex={0}
          onCardFocus={(_card, node) => focus.current.capture(node)}
          onCardPress={(card) => {
            const path = resolveHomeCardPath(card)
            if (path) router.push(path as never)
          }}
        />
      ) : (
        <ScreenStateView
          kind={loading ? "loading" : error ? "error" : "empty"}
          message={
            loading
              ? "Loading stories…"
              : "This collection is no longer available."
          }
          onRetry={error ? refetch : () => router.replace("/")}
        />
      )}
    </View>
  )
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
    paddingTop: scale(100),
  },
})
