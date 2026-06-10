/**
 * App-baked mission storytelling + beta invitation for the Home feed.
 *
 * Static content ported from apps/web/src/components/home/WatchHomePromo.tsx
 * with a compact stacked-card mobile presentation. Renders as a feed item
 * inside the Home FlashList; carries its own translucent background per the
 * transparent-feed convention.
 */
import { type ComponentProps, memo, useCallback } from "react"
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT_ON_DARK,
  BG_COLOR,
  TEXT_PRIMARY,
  hexToRgba,
} from "../../lib/color"
import { openExternalUrl } from "../../lib/openExternalUrl"
import {
  CARD_BORDER_RADIUS,
  CARD_GAP,
  HORIZONTAL_PADDING,
  feedback,
} from "../../styles/shared"

// Wide card with a peek of the next one — affords horizontal swiping while
// keeping each group one card tall instead of three stacked (less vertical
// scrolling to traverse the section).
const CARD_WIDTH_RATIO = 0.78

const BETA_SIGNUP_URL = "https://mailchi.mp/jesusfilm/beta"

// Web's wash: linear-gradient(135deg, burgundy 0.6, purple 0.2, ember 0.1) —
// kept quieter here so feed cards stay legible over the tint.
const WASH_BURGUNDY = "#450a1d"
const WASH_PURPLE = "#581c87"
const WASH_EMBER = "#ea580c"

type MissionPoint = {
  icon: ComponentProps<typeof Ionicons>["name"]
  title: string
  description: string
}

type Highlight = {
  title: string
  description: string
}

const MISSION_POINTS: readonly MissionPoint[] = [
  {
    icon: "globe-outline",
    title: "The most translated film library in the world",
    description:
      "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
  },
  {
    icon: "film-outline",
    title: "Carrying trusted voices into new formats",
    description:
      "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
  },
  {
    icon: "people-outline",
    title: "More than a library. A mission-driven team.",
    description:
      "Jesus Film Project is a global team of translators, media specialists, editors, and creators turning decades of ministry experience into tools for disciple-makers everywhere.",
  },
] as const

const HIGHLIGHTS: readonly Highlight[] = [
  {
    title: "Next Steps Platform",
    description:
      "Connect viewers with tangible opportunities on their spiritual journey, helping them take a next step into community, Scripture, or mission.",
  },
  {
    title: "Evangelistic Media Library",
    description:
      "An extensive Christian media library with thousands of videos, films, and resources available in multiple languages for ministry and evangelism worldwide.",
  },
  {
    title: "Digital Tools for Ministries",
    description:
      "Video management, content distribution, audience engagement, and analytics designed to help ministries reach more people effectively.",
  },
] as const

export const HomeMissionSection = memo(function HomeMissionSection() {
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO)

  const handleBetaPress = useCallback(() => {
    openExternalUrl(BETA_SIGNUP_URL)
  }, [])

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[
          hexToRgba(WASH_BURGUNDY, 0.45),
          hexToRgba(WASH_PURPLE, 0.15),
          hexToRgba(WASH_EMBER, 0.08),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.content}>
        <Text style={[styles.eyebrow, typography.caption]}>
          Built for global missions
        </Text>
        <Text
          style={[styles.headline, typography.headingScale.h2]}
          accessibilityRole="header"
        >
          {"The message doesn't change. The way people watch does."}
        </Text>
        <Text style={[styles.intro, typography.body]}>
          We are rebuilding our video library and tools from the ground up,
          committing decades of translation work to the platforms where people
          already gather, watch, and share.
        </Text>

        <FlatList
          horizontal
          data={MISSION_POINTS}
          keyExtractor={(point) => point.title}
          renderItem={({ item: point }) => (
            <View style={[styles.pointCard, { width: cardWidth }]}>
              <Ionicons
                name={point.icon}
                size={28}
                color={hexToRgba(TEXT_PRIMARY, 0.4)}
              />
              <Text style={[styles.cardTitle, typography.titleSmall]}>
                {point.title}
              </Text>
              <Text style={[styles.cardBody, typography.bodySmall]}>
                {point.description}
              </Text>
            </View>
          )}
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + CARD_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          style={styles.carousel}
          contentContainerStyle={styles.carouselContent}
          accessibilityLabel={`${MISSION_POINTS.length} mission points`}
        />

        <Text style={[styles.buildingNextLabel, typography.titleSmall]}>
          What we are building next
        </Text>
        <FlatList
          horizontal
          data={HIGHLIGHTS}
          keyExtractor={(highlight) => highlight.title}
          renderItem={({ item: highlight }) => (
            <View style={[styles.highlightCard, { width: cardWidth }]}>
              <Text
                style={[
                  styles.cardTitle,
                  styles.highlightTitle,
                  typography.titleSmall,
                ]}
              >
                {highlight.title}
              </Text>
              <Text style={[styles.cardBody, typography.bodySmall]}>
                {highlight.description}
              </Text>
            </View>
          )}
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + CARD_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          style={styles.carousel}
          contentContainerStyle={styles.carouselContent}
          accessibilityLabel={`${HIGHLIGHTS.length} upcoming products`}
        />

        <View style={styles.invite}>
          <Text
            style={[styles.eyebrow, styles.inviteEyebrow, typography.caption]}
          >
            {"You're invited"}
          </Text>
          <Text
            style={[styles.inviteHeadline, typography.headingScale.h3]}
            accessibilityRole="header"
          >
            Help build{" "}
            <Text style={styles.inviteHeadlineAccent}>the next generation</Text>{" "}
            of mission tools
          </Text>
          <Text style={[styles.inviteBody, typography.body]}>
            {
              "We're inviting practitioners, creators, and partners into early access. Test new tools first, give feedback, and help shape products designed for real mission work."
            }
          </Text>
          <Pressable
            onPress={handleBetaPress}
            style={({ pressed }) => [
              styles.betaButton,
              pressed && Platform.OS === "ios" && feedback.pressed,
            ]}
            android_ripple={{ color: "rgba(0, 0, 0, 0.1)" }}
            accessibilityRole="button"
            accessibilityLabel="Become a beta tester"
          >
            <Text style={[styles.betaButtonText, typography.body]}>
              Become a beta tester
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    // Translucent feed-item background (matches CuratedHomeLayout's
    // feedItemBackground convention); the gradient wash layers on top.
    backgroundColor: hexToRgba(BG_COLOR, 0.9),
    overflow: "hidden",
  },
  content: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 36,
  },
  eyebrow: {
    color: hexToRgba("#fee2e2", 0.7),
    fontFamily: "System",
    fontWeight: "600",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  headline: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
    marginBottom: 12,
  },
  intro: {
    color: hexToRgba(TEXT_PRIMARY, 0.8),
    fontFamily: "System",
    marginBottom: 28,
  },
  carousel: {
    // Escape the content padding so cards can bleed to the screen edge while
    // the first card still aligns with the padded text above it.
    marginHorizontal: -HORIZONTAL_PADDING,
  },
  carouselContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  pointCard: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 20,
  },
  highlightCard: {
    backgroundColor: hexToRgba("#0c0a09", 0.35),
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 20,
  },
  cardTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
    marginTop: 12,
  },
  highlightTitle: {
    marginTop: 0,
  },
  cardBody: {
    color: hexToRgba(TEXT_PRIMARY, 0.7),
    fontFamily: "System",
    marginTop: 8,
  },
  buildingNextLabel: {
    color: hexToRgba(TEXT_PRIMARY, 0.8),
    fontFamily: "System",
    fontWeight: "600",
    marginTop: 28,
    marginBottom: 12,
  },
  invite: {
    alignItems: "center",
    marginTop: 36,
  },
  inviteEyebrow: {
    textAlign: "center",
  },
  inviteHeadline: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },
  inviteHeadlineAccent: {
    // Web renders this span with a purple→blue→pink gradient; RN text can't
    // gradient-fill without MaskedView, so the app's accent text token
    // carries the emphasis instead.
    color: ACCENT_ON_DARK,
  },
  inviteBody: {
    color: hexToRgba(TEXT_PRIMARY, 0.8),
    fontFamily: "System",
    textAlign: "center",
    marginBottom: 24,
  },
  betaButton: {
    backgroundColor: TEXT_PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  betaButtonText: {
    color: BG_COLOR,
    fontFamily: "System",
    fontWeight: "600",
  },
})
