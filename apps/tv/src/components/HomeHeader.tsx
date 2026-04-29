import { useRouter } from "expo-router"
import { StyleSheet, View } from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"
import { SearchChip } from "./SearchChip"

type Props = {
  /**
   * When true, the Search chip claims focus on mount. Used to restore
   * focus after back-navigation from /search so the user returns to
   * where they left (tvos issue #852 workaround). Future nav items
   * (LocaleChip, ProfileChip) will get their own preferred-focus
   * props as they're added — kept per-item so a back-from-/locale
   * navigation can restore focus to the locale chip without dragging
   * search into the conversation.
   */
  searchChipPreferredFocus?: boolean
}

/**
 * Home-screen top-row nav slot. Netflix-style horizontally-centered
 * pill row above the hero. Today carries a single Search chip;
 * tomorrow will host a locale picker (feat-107) and later a profile
 * / library picker — each is a one-line add as a sibling of
 * <SearchChip /> below.
 *
 * Rendered ABOVE the video hero in flex order — NOT overlaid on it.
 * Per docs/solutions/best-practices/tv-focus-driven-hero-patterns-
 * 20260420.md, focusables visually overlapping a playing VideoView
 * lose D-pad navigation across the hero region (the AVPlayerLayer
 * intercepts focus traversal regardless of every RN-level guard
 * tried, including pointerEvents="none", focusable={false},
 * TVFocusGuideView with destinations, explicit nextFocusDown to a
 * sibling node handle, and unmounting the VideoView during chip
 * focus). The pill's prominence is carried by its size + stadium
 * shape + drop shadow (SearchChip.tsx), not by overlay positioning.
 */
export function HomeHeader({ searchChipPreferredFocus }: Props) {
  const router = useRouter()
  return (
    <View style={styles.row}>
      <SearchChip
        preferredFocus={searchChipPreferredFocus}
        onPress={() => router.push("/search")}
      />
      {/* Future nav items go here (locale picker, profile).
          The row's `justifyContent: "center"` + `gap` keeps the
          cluster centered and evenly spaced regardless of how
          many chips are present. */}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    // Horizontally center the nav cluster (Netflix pattern). With
    // a single chip today the chip lands dead-center; as more nav
    // items get added the cluster stays centered and `gap` handles
    // inter-item spacing without margin bookkeeping per child.
    justifyContent: "center",
    alignItems: "center",
    gap: scale(16),
    // Symmetric horizontal padding leaves room for the focus halo
    // glow on the leftmost / rightmost chips.
    paddingHorizontal: scale(48),
    paddingTop: scale(32),
    paddingBottom: scale(20),
    // Opaque background — required for stickyHeaderIndices on the
    // parent ScrollView to opaquely cover scrolled content beneath
    // the pinned header. Without this, the hero would visibly slide
    // up under the pill as the user scrolls.
    backgroundColor: COLORS.surface,
  },
})
