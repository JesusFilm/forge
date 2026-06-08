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

// The series screen's scroll container: a 2-column grid of episode cards with
// the hero-adjacent content (metadata, actions, description) in the list header.
// Using the grid AS the scroll container avoids a vertical FlatList nested in a
// ScrollView (the nested-VirtualizedList warning). With no episodes the header
// still renders and no grid or placeholder shows.
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
