import { useQuery } from "@apollo/client/react"
import { useFocusEffect } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { ExperienceRenderer } from "../src/components/ExperienceRenderer"
import { HomeHeader } from "../src/components/HomeHeader"
import { COLORS } from "../src/lib/colors"
import { scale } from "../src/lib/scale"
import { GET_WATCH_SETTING } from "../src/lib/queries"

/**
 * Home screen.
 *
 * The TV home is the curated homepage Experience — the same model mobile and
 * web use — rendered through the shared ExperienceRenderer. We resolve the
 * homepage slug from the PUBLIC watchSetting query (no auth token), then hand
 * the slug to ExperienceRenderer which fetches + renders the experience via
 * the PUBLIC experienceBySlug query.
 *
 * This deliberately does NOT list every experience: the former design hit the
 * editor-gated Query.experiences and 401'd for the public app. See
 * GET_WATCH_SETTING in src/lib/queries.ts.
 */
export default function HomeScreen() {
  const [retryFocused, setRetryFocused] = useState(false)

  // Back-from-/search focus restoration. tvos#852 workaround: on every
  // regain-focus after the first real mount, bump a key that tells
  // <HomeHeader /> to apply hasTVPreferredFocus to its Search chip.
  // Skip the first mount so the experience content's own initial focus
  // wins on cold home render.
  //
  // Counter (not boolean) to absorb React Strict Mode's deliberate
  // double-invoke of effects in dev: with a counter we wait for the
  // *third* run-through (Strict Mode mount-unmount-mount + first
  // navigation back) before bumping.
  const [searchChipFocusKey, setSearchChipFocusKey] = useState(0)
  const focusEffectRunCountRef = useRef(0)
  useFocusEffect(
    useCallback(() => {
      focusEffectRunCountRef.current += 1
      // In production the cleanup-and-rerun pattern of Strict Mode does
      // not fire, so the first real run is run #1. In dev, Strict Mode
      // produces runs #1 (mount) + #2 (immediate remount) before any user
      // navigation; the first back-from-/search lands as run #3. Skip
      // everything before #2 so dev matches prod first-render behavior.
      const STRICT_MODE_DEV_RUNS = 1
      if (focusEffectRunCountRef.current <= STRICT_MODE_DEV_RUNS + 1) return
      setSearchChipFocusKey((k) => k + 1)
    }, []),
  )

  const {
    data: settingData,
    loading: settingLoading,
    error: settingError,
    refetch: settingRefetch,
  } = useQuery(GET_WATCH_SETTING, {
    variables: { locale: "en" },
    fetchPolicy: "cache-and-network",
  })

  const homepageSlug =
    settingData?.watchSetting?.homepageExperience?.slug ?? null

  // The nav header (Search chip). Rendered in every state — including loading,
  // error and empty — so Search stays reachable while the homepage resolves,
  // and passed into ExperienceRenderer as the sticky header once loaded.
  const homeHeader = (
    <HomeHeader
      key={`home-header-${searchChipFocusKey}`}
      searchChipPreferredFocus={searchChipFocusKey > 0}
    />
  )

  // ── Loading state (resolving which experience is the homepage) ──
  if (settingLoading && !settingData) {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </View>
    )
  }

  // ── Error state ──
  if (settingError) {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <Text style={styles.errorText}>Something went wrong</Text>
          <Text style={styles.errorDetail}>{settingError.message}</Text>
          <Pressable
            onFocus={() => setRetryFocused(true)}
            onBlur={() => setRetryFocused(false)}
            style={[
              styles.retryButton,
              retryFocused && styles.retryButtonFocused,
            ]}
            onPress={() => void settingRefetch()}
            hasTVPreferredFocus
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Empty state (no homepage configured for this locale) ──
  if (!homepageSlug) {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No content available</Text>
        </View>
      </View>
    )
  }

  return <ExperienceRenderer slug={homepageSlug} header={homeHeader} />
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(80),
  },
  // ── Error state ──
  errorText: {
    fontFamily: "System",
    fontSize: scale(28),
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: scale(8),
  },
  errorDetail: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    marginBottom: scale(32),
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: scale(40),
    paddingVertical: scale(16),
    borderRadius: scale(28),
    backgroundColor: COLORS.primary,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
  // ── Empty state ──
  emptyText: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.muted,
  },
})
