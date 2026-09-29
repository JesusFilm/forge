import { useCallback, useMemo } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useDownloads } from "../../contexts/DownloadsProvider"
import { useTypography } from "../../hooks/useTypography"
import { TEXT_SECONDARY } from "../../lib/color"
import { buildMyWatchRail, type MyWatchRailTile } from "../../lib/myWatchRail"
import { useTabBarClearance } from "../../lib/tabBar"
import { HORIZONTAL_PADDING, feedback, layout, text } from "../../styles/shared"
import { LibraryEmptyState } from "../library/LibraryEmptyState"
import { ScreenTopBar, type ScreenTopBarAction } from "../ui/ScreenTopBar"
import { DownloadRail } from "./DownloadRail"
import { MyWatchHeader } from "./MyWatchHeader"

const CONTENT_BOTTOM_GAP = 24

/** The My Watch tab page (R1): a menu-only top bar, the identity header, then
 *  the Downloads rail or one whole-page empty message. Every exit uses
 *  navigate (KTD12). */
export function MyWatchScreen() {
  const router = useRouter()
  const typography = useTypography()
  const tabBarClearance = useTabBarClearance()
  const { offlineRecords, isReady } = useDownloads()

  const tiles = useMemo(
    () => buildMyWatchRail(offlineRecords),
    [offlineRecords],
  )

  const menuAction = useMemo<ScreenTopBarAction>(
    () => ({
      icon: "menu",
      accessibilityLabel: "More",
      onPress: () => router.navigate("/more"),
    }),
    [router],
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
    <View style={layout.screenContainer}>
      <ScreenTopBar trailingAction={menuAction} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: CONTENT_BOTTOM_GAP + tabBarClearance },
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
                  style={[text.sectionHeading, typography.titleSmall]}
                  accessibilityRole="header"
                >
                  Downloads
                </Text>
                <Pressable
                  onPress={openDownloads}
                  accessibilityRole="button"
                  accessibilityLabel="See all downloads"
                  {...{ "dd-action-name": "my-watch-see-all-downloads" }}
                  style={({ pressed }) => [
                    styles.seeAll,
                    pressed && feedback.pressed,
                  ]}
                >
                  <Text style={[styles.seeAllText, typography.bodySmall]}>
                    See all
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={TEXT_SECONDARY}
                  />
                </Pressable>
              </View>
              <DownloadRail tiles={tiles} onPressTile={openTile} />
            </View>
          ) : (
            <LibraryEmptyState style={styles.empty} />
          ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingTop: 8,
  },
  headingRow: {
    flexDirection: "row",
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
  seeAllText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  // The page has no other content, so the message centres in what is left.
  empty: {
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 24,
  },
})
