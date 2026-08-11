/**
 * /mission — Jesus Film mission storytelling page (prose moved off the Home
 * feed: framing, three points, building-next, beta invite). Reached from the
 * Home mission rail; the native stack header supplies back navigation.
 */
import { useCallback, useEffect, useRef } from "react"
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useTypography } from "../src/hooks/useTypography"
import {
  ACCENT_ON_DARK,
  BG_COLOR,
  TEXT_PRIMARY,
  hexToRgba,
} from "../src/lib/color"
import { openExternalUrl } from "../src/lib/openExternalUrl"
import { FloatingBackButton } from "../src/components/ui/FloatingBackButton"
import { BACK_BUTTON_PROPS } from "../src/lib/playerLayout"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  feedback,
  text,
} from "../src/styles/shared"
import {
  BETA_CTA_LABEL,
  BETA_SIGNUP_URL,
  HIGHLIGHTS,
  HIGHLIGHTS_LABEL,
  INVITE_BODY,
  INVITE_EYEBROW,
  INVITE_HEADLINE_ACCENT,
  INVITE_HEADLINE_PREFIX,
  INVITE_HEADLINE_SUFFIX,
  MISSION_EYEBROW,
  MISSION_HEADLINE,
  MISSION_INTRO,
  MISSION_POINTS,
  MISSION_WASH,
} from "../src/components/home/missionContent"

// Floating back button (top 10 + 40pt tall) plus breathing room, so the
// eyebrow clears it now that no native header reserves that space.
const BACK_BUTTON_CLEARANCE = BACK_BUTTON_PROPS.topOffset + 40 + 14

export default function MissionScreen() {
  const typography = useTypography()
  const insets = useSafeAreaInsets()
  const { section } = useLocalSearchParams<{ section?: string }>()

  // Land pre-scrolled on the requested section: the roadmap header's
  // onLayout y is relative to the scroll content (it is a direct child),
  // so one unanimated scrollTo on first layout puts it at the top.
  const scrollRef = useRef<ScrollView>(null)
  const didScrollToSectionRef = useRef(false)

  // Re-arm the one-shot scroll when a new deep link changes the section on a
  // reused screen (navigate to ?section=roadmap a second time).
  useEffect(() => {
    didScrollToSectionRef.current = false
  }, [section])

  const handleRoadmapLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (section !== "roadmap" || didScrollToSectionRef.current) return
      didScrollToSectionRef.current = true
      // layout.y includes the content padding. With no native header the
      // viewport top is screen y=0, so subtract the padding back off or the
      // heading lands under the status bar and the floating back button.
      const y = Math.max(
        0,
        event.nativeEvent.layout.y - (insets.top + BACK_BUTTON_CLEARANCE),
      )
      scrollRef.current?.scrollTo({ y, animated: false })
    },
    [section, insets.top],
  )

  const handleBetaPress = () => {
    openExternalUrl(BETA_SIGNUP_URL)
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          hexToRgba(MISSION_WASH.burgundy, 0.45),
          hexToRgba(MISSION_WASH.purple, 0.15),
          hexToRgba(MISSION_WASH.ember, 0.08),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            // No native header now, so the screen owns the safe area: clear it
            // plus the floating back button before the first line of prose.
            paddingTop: insets.top + BACK_BUTTON_CLEARANCE,
            paddingBottom: insets.bottom + 48,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[text.eyebrow, styles.eyebrow, typography.caption]}>
          {MISSION_EYEBROW}
        </Text>
        <Text
          style={[styles.headline, typography.headingScale.h2]}
          accessibilityRole="header"
        >
          {MISSION_HEADLINE}
        </Text>
        <Text style={[styles.intro, typography.body]}>{MISSION_INTRO}</Text>

        <View style={styles.cardStack}>
          {MISSION_POINTS.map((point) => (
            <View key={point.title} style={styles.pointCard}>
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
          ))}
        </View>

        <Text
          style={[styles.buildingNextLabel, typography.titleSmall]}
          accessibilityRole="header"
          onLayout={handleRoadmapLayout}
        >
          {HIGHLIGHTS_LABEL}
        </Text>
        <View style={styles.cardStack}>
          {HIGHLIGHTS.map((highlight) => (
            <View key={highlight.title} style={styles.highlightCard}>
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
          ))}
        </View>

        <View style={styles.invite}>
          <Text
            style={[
              text.eyebrow,
              styles.eyebrow,
              styles.inviteEyebrow,
              typography.caption,
            ]}
          >
            {INVITE_EYEBROW}
          </Text>
          <Text
            style={[styles.inviteHeadline, typography.headingScale.h3]}
            accessibilityRole="header"
          >
            {INVITE_HEADLINE_PREFIX}
            <Text style={styles.inviteHeadlineAccent}>
              {INVITE_HEADLINE_ACCENT}
            </Text>
            {INVITE_HEADLINE_SUFFIX}
          </Text>
          <Text style={[styles.inviteBody, typography.body]}>
            {INVITE_BODY}
          </Text>
          <Pressable
            onPress={handleBetaPress}
            style={({ pressed }) => [
              styles.betaButton,
              pressed && Platform.OS === "ios" && feedback.pressed,
            ]}
            android_ripple={{ color: "rgba(0, 0, 0, 0.1)" }}
            accessibilityRole="button"
            accessibilityLabel={BETA_CTA_LABEL}
          >
            <Text style={[styles.betaButtonText, typography.body]}>
              {BETA_CTA_LABEL}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <FloatingBackButton {...BACK_BUTTON_PROPS} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  content: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  // Local overrides on the shared text.eyebrow base (warm tint, wider
  // tracking, page-scale margin).
  eyebrow: {
    color: hexToRgba("#fee2e2", 0.7),
    letterSpacing: 3,
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
  cardStack: {
    gap: 12,
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
    // gradient-fill without MaskedView, so the accent token carries the
    // emphasis instead.
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
