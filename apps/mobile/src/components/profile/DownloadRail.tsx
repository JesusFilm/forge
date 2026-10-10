import { useCallback } from "react"
import { FlatList, useWindowDimensions } from "react-native"

import { useT } from "../../i18n/useT"
import type { MyWatchRailTile } from "../../lib/myWatchRail"
import { CARD_GAP, carousel } from "../../styles/shared"
import { homeCardWidth } from "../home/HomeCard"
import { DownloadTile } from "./DownloadTile"

export type DownloadRailProps = {
  tiles: readonly MyWatchRailTile[]
  onPressTile: (tile: MyWatchRailTile) => void
}

/** The My Watch Downloads rail: Home's landscape card size and snap. */
export function DownloadRail({ tiles, onPressTile }: DownloadRailProps) {
  const { width: screenWidth } = useWindowDimensions()
  const t = useT("MyWatch")
  const tileWidth = homeCardWidth("landscape", screenWidth)

  const renderItem = useCallback(
    ({ item }: { item: MyWatchRailTile }) => (
      <DownloadTile tile={item} width={tileWidth} onPress={onPressTile} />
    ),
    [tileWidth, onPressTile],
  )

  return (
    <FlatList
      data={tiles}
      renderItem={renderItem}
      keyExtractor={(tile) => tile.key}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={carousel.listContent}
      snapToInterval={tileWidth + CARD_GAP}
      snapToAlignment="start"
      decelerationRate="fast"
      accessibilityLabel={t("railAriaLabel", { count: tiles.length })}
    />
  )
}
