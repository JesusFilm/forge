import { useRouter } from "expo-router"
import { StyleSheet, Text, View } from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"
import { FocusableCard } from "./FocusableCard"

type Props = {
  /**
   * When true, the Search chip claims focus on mount. Used to restore
   * focus after back-navigation from /search so the user returns to
   * where they left (tvos issue #852 workaround).
   */
  searchChipPreferredFocus?: boolean
  /**
   * Optional callback when the Search chip gains focus. Consumers on
   * the home screen can use this to pause rail focus commits while
   * the chip is the active focus target.
   */
  onSearchChipFocus?: () => void
}

/**
 * Home-screen top-left header row.
 *
 * NOT absolute-positioned — per docs/solutions/best-practices/
 * react-native-tvos-porting-pitfalls-20260414.md, absolute-positioned
 * focusables are ignored by the tvOS focus engine. This is a flexbox
 * row at the top of the home ScrollView above <HomeHero>; the Search
 * chip becomes reachable via D-pad-up from the Experiences rail via
 * natural flexbox ordering, not absolute layering.
 *
 * Rest of the row is intentionally empty today; it is the anchor
 * slot for future top-nav items (localization selector, profile,
 * etc.) that will share this row's flex.
 */
export function HomeHeader({
  searchChipPreferredFocus,
  onSearchChipFocus,
}: Props) {
  const router = useRouter()
  return (
    <View style={styles.row}>
      <FocusableCard
        onPress={() => router.push("/search")}
        onFocus={onSearchChipFocus}
        hasTVPreferredFocus={searchChipPreferredFocus}
        accessibilityLabel="Search"
        style={styles.chip}
      >
        <View style={styles.chipInner}>
          <Text style={styles.glyph} accessibilityElementsHidden>
            {/* Magnifier glyph — system font, no SVG dep (see
             * react-native-tvos-porting-pitfalls: avoid react-native-svg). */}
            {"⌕"}
          </Text>
          <Text style={styles.label}>Search</Text>
        </View>
      </FocusableCard>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(48),
    paddingTop: scale(24),
    paddingBottom: scale(8),
  },
  chip: {
    backgroundColor: COLORS.surfaceContainer,
    paddingHorizontal: scale(20),
    paddingVertical: scale(10),
  },
  chipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
  },
  glyph: {
    fontFamily: "System",
    fontSize: scale(20),
    color: COLORS.text,
  },
  label: {
    fontFamily: "System",
    fontSize: scale(16),
    fontWeight: "600",
    color: COLORS.text,
  },
})
