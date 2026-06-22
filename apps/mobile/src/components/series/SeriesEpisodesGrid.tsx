import { useCallback } from "react"
import { FlatList, StyleSheet, type ListRenderItemInfo } from "react-native"
import type { ReactElement } from "react"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { SeriesEpisodeCard } from "./SeriesEpisodeCard"

type SeriesEpisodesGridProps = {
  episodes: WatchEpisode[]
  header: ReactElement
  onSelect: (episode: WatchEpisode) => void
}

// Series scroll container: 2-column episode grid with hero-adjacent content in
// the list header. The grid IS the scroll container to avoid a FlatList nested
// in a ScrollView (nested-VirtualizedList warning). No episodes → header only.
export function SeriesEpisodesGrid({
  episodes,
  header,
  onSelect,
}: SeriesEpisodesGridProps) {
  // renderItem/keyExtractor memoized — Android is the primary device tier.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WatchEpisode>) => (
      <SeriesEpisodeCard episode={item} onSelect={onSelect} />
    ),
    [onSelect],
  )
  const keyExtractor = useCallback((item: WatchEpisode) => item.documentId, [])

  return (
    <FlatList
      data={episodes}
      numColumns={2}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.column}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    />
  )
}

const styles = StyleSheet.create({
  column: {
    paddingHorizontal: 10,
  },
  content: {
    paddingBottom: 80,
  },
})
