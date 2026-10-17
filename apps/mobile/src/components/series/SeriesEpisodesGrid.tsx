import { useCallback, useMemo } from "react"
import { FlatList, StyleSheet, type ListRenderItemInfo } from "react-native"
import type { ReactElement } from "react"

import { useLocaleEpoch } from "../../i18n/useT"
import type { WatchEpisode } from "../../lib/normalizeVideo"
import type { EpisodeBadgeState } from "../../lib/seriesDownloadAggregate"
import { SeriesEpisodeCard } from "./SeriesEpisodeCard"

type SeriesEpisodesGridProps = {
  episodes: WatchEpisode[]
  header: ReactElement
  onSelect: (episode: WatchEpisode) => void
  /** slug → download badge state; identity changes drive a row re-render (U9). */
  badgeBySlug?: Map<string, EpisodeBadgeState>
}

// Series scroll container: 2-column episode grid with hero-adjacent content in
// the list header. The grid IS the scroll container to avoid a FlatList nested
// in a ScrollView (nested-VirtualizedList warning). No episodes → header only.
export function SeriesEpisodesGrid({
  episodes,
  header,
  onSelect,
  badgeBySlug,
}: SeriesEpisodesGridProps) {
  // renderItem/keyExtractor memoized — Android is the primary device tier.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WatchEpisode>) => (
      <SeriesEpisodeCard
        episode={item}
        onSelect={onSelect}
        downloadState={badgeBySlug?.get(item.slug)}
      />
    ),
    [onSelect, badgeBySlug],
  )
  const keyExtractor = useCallback((item: WatchEpisode) => item.documentId, [])
  // The epoch rides along so recycled cells take a new UI language (KTD5).
  const epoch = useLocaleEpoch()
  const extraData = useMemo(
    () => ({ badgeBySlug, epoch }),
    [badgeBySlug, epoch],
  )

  return (
    <FlatList
      data={episodes}
      numColumns={2}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      // A new badge-map identity forces rows to recompute so badges don't freeze
      // when a download completes, pauses, or is deleted (R8/AE6).
      extraData={extraData}
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
