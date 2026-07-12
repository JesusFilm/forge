import { useState } from "react"
import { Dimensions, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"

import { FocusableCard } from "../FocusableCard"
import { LinkModal } from "../LinkModal"
import { COLORS, hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import type { NormalizedBlock } from "../../lib/normalizer"
import { isAllowedQuizUrl } from "../../lib/validateUrl"

// ── Quiz gradient (from mobile src/lib/color.ts) ───────────────────────
// DELIBERATE WATCH_THEME exception (commit 74e7965a) — do NOT auto-migrate this
// Crimson gradient to WATCH (U4 did once, and it was reverted). 2nd stop = COLORS.primary.

const QUIZ_GRADIENT: readonly [string, string] = ["#E8891C", COLORS.primary]

// Constrain the CTA to half the viewport so it reads as a button, not a banner.
const { width: SCREEN_WIDTH } = Dimensions.get("window")
const QUIZ_WIDTH = SCREEN_WIDTH / 2

// ── QuizButtonRenderer ─────────────────────────────────────────────────────

export function QuizButtonRenderer({ section }: { section: NormalizedBlock }) {
  const [modalVisible, setModalVisible] = useState(false)

  const buttonText = section.buttonText as string | null
  const iframeSrc = section.iframeSrc as string | null

  // Silent drop if URL is invalid or missing
  if (!iframeSrc || !isAllowedQuizUrl(iframeSrc)) return null

  const openModal = () => setModalVisible(true)
  const closeModal = () => setModalVisible(false)

  return (
    <>
      <View style={styles.sectionOuter}>
        <FocusableCard
          onPress={openModal}
          style={styles.cardOverride}
          accessibilityLabel={buttonText ?? "Take the quiz"}
        >
          <LinearGradient
            colors={[...QUIZ_GRADIENT]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.buttonGradient}
          >
            <View style={styles.buttonContent}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>QUIZ</Text>
              </View>
              <Text style={styles.buttonLabel} numberOfLines={2}>
                {buttonText ?? "Take the quiz"}
              </Text>
              <Text style={styles.arrow}>{"\u2192"}</Text>
            </View>
          </LinearGradient>
        </FocusableCard>
      </View>

      <LinkModal
        url={iframeSrc}
        visible={modalVisible}
        onClose={closeModal}
        urlValidator={isAllowedQuizUrl}
        errorText="Couldn't load the quiz."
      />
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionOuter: {
    paddingHorizontal: scale(80),
    paddingVertical: scale(12),
    alignItems: "center",
  },
  cardOverride: {
    width: QUIZ_WIDTH,
    backgroundColor: hexToRgba(COLORS.surface, 0),
    borderRadius: scale(16),
    overflow: "hidden",
  },
  buttonGradient: {
    borderRadius: scale(16),
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(24),
    paddingVertical: scale(24),
  },
  badge: {
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: scale(8),
    paddingHorizontal: scale(10),
    paddingVertical: scale(5),
    marginRight: scale(16),
  },
  badgeText: {
    color: "#ffffff",
    fontSize: Math.round(scale(14)),
    fontWeight: "800",
    fontFamily: "System",
    letterSpacing: 1.5,
  },
  buttonLabel: {
    flex: 1,
    color: "#ffffff",
    fontSize: Math.round(scale(22)),
    fontWeight: "700",
    fontFamily: "System",
    textAlign: "center",
  },
  arrow: {
    color: "#ffffff",
    fontSize: Math.round(scale(28)),
    marginLeft: scale(16),
  },
})
