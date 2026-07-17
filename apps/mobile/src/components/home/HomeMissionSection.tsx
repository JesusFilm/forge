/**
 * Mission rail for the Home feed: three tappable 16:9 cards in shelf language.
 * Cards push to /mission for the prose; the beta card opens external signup.
 * Renders as a feed item with its own translucent background.
 */
import { memo, useCallback } from "react"
import {
  FlatList,
  type ListRenderItem,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import {
  BG_COLOR,
  BLACK,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  hexToRgba,
} from "../../lib/color"
import { openExternalUrl } from "../../lib/openExternalUrl"
import {
  CARD_GAP,
  HORIZONTAL_PADDING,
  card,
  feedback,
  text,
} from "../../styles/shared"
import { homeCardWidth } from "./HomeCard"
import {
  BETA_CTA_LABEL,
  BETA_SIGNUP_URL,
  HIGHLIGHTS_LABEL,
  INVITE_EYEBROW,
  MISSION_EYEBROW,
  MISSION_HEADLINE,
  MISSION_WASH,
} from "./missionContent"

type MissionCardSpec = {
  key: string
  eyebrow: string
  title: string
  icon: React.ComponentProps<typeof Ionicons>["name"]
  /** Gradient pair behind the card content. */
  wash: [string, string]
  action: "mission" | "roadmap" | "beta"
  accessibilityHint: string
}

const CARDS: readonly MissionCardSpec[] = [
  {
    key: "mission",
    eyebrow: "Our mission",
    title: MISSION_HEADLINE,
    icon: "globe-outline",
    wash: [MISSION_WASH.burgundy, MISSION_WASH.purple],
    action: "mission",
    accessibilityHint: "Opens the Jesus Film mission page",
  },
  {
    key: "building-next",
    eyebrow: "Roadmap",
    title: HIGHLIGHTS_LABEL,
    icon: "construct-outline",
    wash: [MISSION_WASH.purple, MISSION_WASH.burgundy],
    action: "roadmap",
    accessibilityHint:
      "Opens the Jesus Film mission page at the roadmap section",
  },
  {
    key: "beta",
    eyebrow: INVITE_EYEBROW,
    title: BETA_CTA_LABEL,
    icon: "person-add-outline",
    wash: [MISSION_WASH.ember, MISSION_WASH.burgundy],
    action: "beta",
    accessibilityHint: "Opens the beta signup in your browser",
  },
] as const

const keyExtractor = (spec: MissionCardSpec) => spec.key

const CARD_RIPPLE = { color: "rgba(255, 255, 255, 0.08)" }

export const HomeMissionSection = memo(function HomeMissionSection() {
  const typography = useTypography()
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = homeCardWidth("landscape", screenWidth)

  const handlePress = useCallback(
    (spec: MissionCardSpec) => {
      if (spec.action === "beta") {
        openExternalUrl(BETA_SIGNUP_URL)
        return
      }
      // navigate (not push) dedupes a double-tap into one screen.
      router.navigate(
        spec.action === "roadmap" ? "/mission?section=roadmap" : "/mission",
      )
    },
    [router],
  )

  const renderItem = useCallback<ListRenderItem<MissionCardSpec>>(
    ({ item: spec }) => (
      <Pressable
        onPress={() => handlePress(spec)}
        style={({ pressed }) => [
          card.surface,
          styles.card,
          { width: cardWidth },
          pressed && Platform.OS === "ios" && feedback.pressed,
        ]}
        android_ripple={CARD_RIPPLE}
        accessibilityRole="button"
        accessibilityLabel={spec.title}
        accessibilityHint={spec.accessibilityHint}
      >
        <LinearGradient
          colors={[
            hexToRgba(spec.wash[0], 0.75),
            hexToRgba(spec.wash[1], 0.35),
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Ionicons
          name={spec.icon}
          size={64}
          color={hexToRgba(TEXT_PRIMARY, 0.18)}
          style={styles.cardIcon}
        />
        <LinearGradient
          colors={[hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.7)]}
          style={styles.cardFooterGradient}
        />
        <View style={styles.cardFooter}>
          <Text style={[styles.cardEyebrow, typography.caption]}>
            {spec.eyebrow.toUpperCase()}
          </Text>
          <Text
            style={[styles.cardTitle, typography.titleSmall]}
            numberOfLines={2}
          >
            {spec.title}
          </Text>
        </View>
      </Pressable>
    ),
    [typography, cardWidth, handlePress],
  )

  return (
    <View style={styles.container}>
      <Text style={[text.eyebrow, styles.headerEyebrow, typography.caption]}>
        {MISSION_EYEBROW}
      </Text>

      <FlatList
        horizontal
        data={CARDS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.railContent}
        accessibilityLabel={`${CARDS.length} items in ${MISSION_EYEBROW}`}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    // Translucent feed-item background (matches the feed convention).
    backgroundColor: hexToRgba(BG_COLOR, 0.9),
    paddingVertical: 16,
    paddingBottom: 24,
  },
  headerEyebrow: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 8,
  },
  card: {
    aspectRatio: 16 / 9,
    overflow: "hidden",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
  },
  cardIcon: {
    position: "absolute",
    top: 14,
    left: 14,
  },
  cardFooterGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
  cardFooter: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 14,
  },
  cardEyebrow: {
    color: hexToRgba("#fee2e2", 0.75),
    fontFamily: "System",
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 4,
  },
  cardTitle: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "600",
  },
  railContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
})
