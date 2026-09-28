import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  ACCENT,
  BG_COLOR,
  BLACK,
  TEXT_BODY,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import type { FeedPhase } from "../../lib/explore/feedState"
import { EXPLORE_COPY } from "../../lib/explore/copy"
import { useTypography } from "../../hooks/useTypography"
import { feedback } from "../../styles/shared"

export type ExploreStatesProps = {
  /** The two phases that replace the whole feed. */
  phase: Extract<FeedPhase, "offline" | "empty">
  /** The feed language's display name, for the empty state (R37). */
  languageName: string
  onRetry: () => void
}

/**
 * Explore's non-clip states. An unreachable admin reaches the reducer as the
 * `offline` event, so it shows the offline view, never the empty one (R47).
 */
export function ExploreStates({
  phase,
  languageName,
  onRetry,
}: ExploreStatesProps) {
  if (phase === "offline") return <ExploreOffline onRetry={onRetry} />
  return <ExploreEmpty languageName={languageName} />
}

/** No network, or no admin: a message and a retry (R36, R47). */
function ExploreOffline({ onRetry }: { onRetry: () => void }) {
  const typography = useTypography()
  return (
    <View style={styles.screen} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={40} color={TEXT_SECONDARY} />
      <Text
        style={[styles.title, typography.titleSmall]}
        accessibilityRole="header"
      >
        {EXPLORE_COPY.offlineTitle}
      </Text>
      <Text style={[styles.body, typography.bodySmall]}>
        {EXPLORE_COPY.offlineBody}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel={EXPLORE_COPY.retry}
      >
        <Text style={[styles.retryText, typography.body]}>
          {EXPLORE_COPY.retry}
        </Text>
      </Pressable>
    </View>
  )
}

/** No eligible video in the feed language (R37). */
function ExploreEmpty({ languageName }: { languageName: string }) {
  const typography = useTypography()
  return (
    <View style={styles.screen}>
      <Ionicons name="film-outline" size={40} color={TEXT_SECONDARY} />
      <Text
        style={[styles.title, typography.titleSmall]}
        accessibilityRole="header"
      >
        {EXPLORE_COPY.emptyTitle(languageName)}
      </Text>
      <Text style={[styles.body, typography.bodySmall]}>
        {EXPLORE_COPY.emptyBody}
      </Text>
    </View>
  )
}

/**
 * A clip that cannot play (R40). It takes no touch, so the pager's swipe still
 * works, and it has no timer, so it never moves on by itself.
 */
export function ClipFailed() {
  const typography = useTypography()
  return (
    <View testID="clip-failed" style={styles.failedLayer} pointerEvents="none">
      <Text
        style={[styles.failedText, typography.bodySmall]}
        accessibilityLiveRegion="polite"
      >
        {EXPLORE_COPY.clipFailed}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
    backgroundColor: BG_COLOR,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: TEXT_BODY,
    fontFamily: "System",
    textAlign: "center",
  },
  retry: {
    marginTop: 8,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 24,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT,
  },
  retryText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "600",
  },
  failedLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  // Its own dark backing, so it reads over any still.
  failedText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: hexToRgba(BLACK, 0.7),
  },
})
