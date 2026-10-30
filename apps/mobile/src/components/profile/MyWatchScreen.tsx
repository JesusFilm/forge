import { useCallback, useMemo } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useDownloads } from "../../contexts/DownloadsProvider"
import { useTypography } from "../../hooks/useTypography"
import { directionalIcon } from "../../i18n/layoutRtl"
import { useTextDirection } from "../../i18n/textDirection"
import { useT } from "../../i18n/useT"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { canUseLiquidGlass } from "../../lib/liquidGlass"
import { buildMyWatchRail, type MyWatchRailTile } from "../../lib/myWatchRail"
import { useTabBarClearance } from "../../lib/tabBar"
import { HORIZONTAL_PADDING, feedback, layout, text } from "../../styles/shared"
import { LibraryEmptyState } from "../library/LibraryEmptyState"
import { GlassSurface, type GlassFallback } from "../ui/GlassSurface"
import { ScreenTopBar, type ScreenTopBarAction } from "../ui/ScreenTopBar"
import { DownloadRail } from "./DownloadRail"
import { MyWatchHeader } from "./MyWatchHeader"

const CONTENT_BOTTOM_GAP = 24
// The menu floats at the right, clear of the centered avatar, so the header
// starts this far below the safe area instead of under a whole bar row.
const CONTENT_TOP_GAP = 16

/** The My Watch tab page (R1): a menu-only top bar, the identity header, then
 *  the Downloads rail or one whole-page empty message. Every exit uses
 *  navigate (KTD12). */
export function MyWatchScreen({ testID }: { testID?: string }) {
  const router = useRouter()
  const typography = useTypography()
  const t = useT("MyWatch")
  const tLibrary = useT("Library")
  const uiDirection = useTextDirection().ui
  const tabBarClearance = useTabBarClearance()
  const insets = useSafeAreaInsets()
  const { offlineRecords, isReady } = useDownloads()
  const glass = canUseLiquidGlass()

  const tiles = useMemo(
    () => buildMyWatchRail(offlineRecords),
    [offlineRecords],
  )

  const menuAction = useMemo<ScreenTopBarAction>(
    () => ({
      icon: "menu",
      accessibilityLabel: t("moreTitle"),
      onPress: () => router.navigate("/more"),
      actionName: "my-watch-more",
    }),
    [router, t],
  )

  const openDownloads = useCallback(
    () => router.navigate("/downloads"),
    [router],
  )

  // A video tile takes the list row's route, so the watch screen plays the
  // file on disk (R6). A series tile opens Downloads at that series (KTD5).
  const openTile = useCallback(
    (tile: MyWatchRailTile) => {
      if (tile.kind === "video") {
        router.navigate(`/watch/${encodeURIComponent(tile.record.videoSlug)}`)
        return
      }
      router.navigate({
        pathname: "/downloads",
        params: { series: tile.group.seriesSlug },
      })
    },
    [router],
  )

  return (
    <View testID={testID} style={layout.screenContainer}>
      {/* Android sorts screen-reader order by position, and a list that also
          starts at y 0 is taller than the bar, so it would read before More. */}
      <ScrollView
        style={{ marginTop: insets.top }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: CONTENT_TOP_GAP,
            paddingBottom: CONTENT_BOTTOM_GAP + tabBarClearance,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <MyWatchHeader />

        {/* Before the manifest hydrates, show neither the rail nor the empty state (R9). */}
        {isReady &&
          (tiles.length > 0 ? (
            <View>
              <View style={styles.headingRow}>
                <Text
                  style={[
                    text.sectionHeading,
                    typography.titleSmall,
                    uiDirection,
                  ]}
                  accessibilityRole="header"
                >
                  {tLibrary("downloadsTitle")}
                </Text>
                <Pressable
                  onPress={openDownloads}
                  accessibilityRole="button"
                  accessibilityLabel={t("seeAllDownloadsAriaLabel")}
                  {...{ "dd-action-name": "my-watch-see-all-downloads" }}
                  style={({ pressed }) => [
                    glass ? styles.seeAllGlassTarget : styles.seeAll,
                    pressed && !glass && feedback.pressed,
                  ]}
                >
                  <GlassSurface
                    style={glass ? styles.seeAllPill : styles.seeAllRow}
                    fallback={BARE_LINK}
                    interactive
                  >
                    <Text
                      style={[
                        styles.seeAllText,
                        glass && styles.seeAllTextGlass,
                        typography.bodySmall,
                      ]}
                    >
                      {t("seeAll")}
                    </Text>
                    <Ionicons
                      name={directionalIcon("chevron-forward")}
                      size={16}
                      color={glass ? TEXT_PRIMARY : TEXT_SECONDARY}
                    />
                  </GlassSurface>
                </Pressable>
              </View>
              <DownloadRail tiles={tiles} onPressTile={openTile} />
            </View>
          ) : (
            <LibraryEmptyState style={styles.empty} />
          ))}
      </ScrollView>
      <ScreenTopBar overlay trailingAction={menuAction} />
    </View>
  )
}

// Without Liquid Glass the link stays bare text, as before.
const BARE_LINK: GlassFallback = { kind: "fill", style: null }

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  headingRow: {
    flexDirection: "row",
    // At a large text size, See all moves under the heading, not off screen.
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  seeAll: {
    minHeight: 44,
    minWidth: 44,
    // Pulls the target out so the chevron lines up with the content edge.
    marginRight: -8,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // The pill's edge, not the chevron, sits on the content edge.
  seeAllGlassTarget: {
    minHeight: 44,
    justifyContent: "center",
  },
  seeAllPill: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllText: {
    color: TEXT_SECONDARY,
    fontWeight: "600",
  },
  seeAllTextGlass: {
    color: TEXT_PRIMARY,
  },
  // The page has no other content, so the message centres in what is left.
  empty: {
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 24,
  },
})
