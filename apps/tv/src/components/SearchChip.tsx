import { StyleSheet, Text, View } from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"
import { FocusableCard } from "./FocusableCard"

type Props = {
  /** Press handler. The chip itself is router-agnostic — the
   *  consumer (HomeHeader) decides where Search routes to. */
  onPress: () => void
  /** When true, the chip claims focus on mount. HomeHeader bumps a
   *  key on regain-focus to drive this for back-from-/search focus
   *  restoration (tvos issue #852 workaround). */
  preferredFocus?: boolean
}

/**
 * Top-nav Search chip. Self-contained primitive — sibling to future
 * top-row nav items (LocaleChip in feat-107, ProfileChip later, etc.).
 * All chip-specific layout, sizing, and styling live here so the
 * containing HomeHeader stays a thin row of nav items.
 *
 * Avoids position: "absolute" — focusables in absolute layers are
 * skipped by the tvOS focus engine
 * (docs/solutions/best-practices/react-native-tvos-porting-pitfalls-
 * 20260414.md). Overlay-on-hero positioning is the parent's concern;
 * the chip itself is just a flexbox row child.
 */
export function SearchChip({ onPress, preferredFocus }: Props) {
  // Wrap FocusableCard in a View that carries the static drop shadow.
  // FocusableCard's `inner` has overflow: "hidden" so a shadow on the
  // chip itself would be clipped — and FocusableCard's `outer` slot is
  // reserved for the focus glow (crimson on focus). Putting the static
  // shadow one layer up keeps both visible: a constant warm-stone lift
  // off the hero, plus the crimson focus halo on top when active.
  return (
    <View style={styles.shadowWrapper}>
      <FocusableCard
        onPress={onPress}
        hasTVPreferredFocus={preferredFocus}
        accessibilityLabel="Search"
        accessibilityHint="Opens the search screen"
        style={styles.chip}
      >
        <View style={styles.inner}>
          <Text style={styles.glyph} accessibilityElementsHidden>
            {/* Magnifier glyph — system font, no SVG dep (per
             * react-native-tvos-porting-pitfalls: avoid react-native-svg). */}
            {"⌕"}
          </Text>
          <Text style={styles.label}>Search</Text>
        </View>
      </FocusableCard>
    </View>
  )
}

// Stadium-pill height + borderRadius math: the inner chip's height is
// driven by paddingVertical (scale(14) * 2 = scale(28)) plus the
// glyph's line-box (~scale(50) at fontSize 40 + line-height auto).
// Total ≈ scale(78). For a true stadium silhouette, borderRadius
// must be ≥ height/2 — scale(40) lands the corners exactly at the
// half-height threshold.
const PILL_BORDER_RADIUS = scale(40)

const styles = StyleSheet.create({
  shadowWrapper: {
    // Drop shadow lifts the chip off the dark page above the hero.
    // shadowColor uses COLORS.surface (warm stone, the design
    // system's deepest tone) rather than pure black, so the shadow
    // tints toward the palette instead of dropping a stark
    // pure-black halo.
    shadowColor: COLORS.surface,
    shadowOffset: { width: 0, height: scale(6) },
    shadowOpacity: 0.65,
    shadowRadius: scale(14),
    // Android TV elevation — tvOS uses shadow* above, Android
    // needs both elevation and the renderToHardwareTextureAndroid
    // hint that FocusableCard already applies internally.
    elevation: 10,
    // Match the pill's borderRadius so the shadow silhouette
    // follows the stadium shape.
    borderRadius: PILL_BORDER_RADIUS,
  },
  chip: {
    // surfaceContainerHighest gives the chip enough contrast
    // against the warm-stone page background that it reads as a
    // distinct CTA without resorting to pure black or pure white.
    backgroundColor: COLORS.surfaceContainerHighest,
    // Generous horizontal padding for a stadium silhouette — the
    // pill should read as elongated, not as a square button. scale(40)
    // gives roughly 2× the vertical padding on each side.
    paddingHorizontal: scale(40),
    paddingVertical: scale(14),
    borderRadius: PILL_BORDER_RADIUS,
    // alignSelf: "flex-start" stops the parent flex row from
    // stretching the chip's outer wrapper to row height, which
    // (combined with FocusableCard's internal `flex: 1` on its
    // inner View) was collapsing the chip's content area to zero
    // and leaving an empty pill silhouette. With "flex-start" the
    // chip sizes to its intrinsic content + padding, exactly what
    // the rail-card consumers of FocusableCard get for free via
    // their explicit `width` prop.
    alignSelf: "flex-start",
    // Explicit minimum dimensions guarantee the inner View renders
    // its content area at the correct size even when FocusableCard's
    // hardcoded `flex: 1` on the inner would otherwise collapse it.
    minHeight: scale(80),
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(14),
  },
  glyph: {
    fontFamily: "System",
    // The Unicode "⌕" (TELEPHONE RECORDER, repurposed as a
    // magnifier in SF Pro) is thin and sparse — scale(40) at
    // weight 700 gives the chip enough visual weight to read as a
    // search affordance from across a 10-foot living room.
    fontSize: scale(40),
    fontWeight: "700",
    color: COLORS.text,
  },
  label: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
})
