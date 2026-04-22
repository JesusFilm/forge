import React, { useCallback, type ReactNode } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"

/**
 * Hooks passed into each rail item's renderItem so the consumer can
 * wire focus events directly into the interactive child (e.g., a
 * FocusableCard's `onFocus` prop). Needed because the wrapper `View`'s
 * `onFocus` does NOT reliably fire when a nested `Pressable` inside a
 * `FocusableCard` gains focus on tvOS — the event doesn't bubble up
 * consistently across react-native-tvos versions.
 */
export type ContentRailItemHooks = {
  onFocus: () => void
}

type ContentRailProps<T> = {
  title: string
  data: T[]
  renderItem: (item: T, index: number, hooks: ContentRailItemHooks) => ReactNode
  railId: string
  keyExtractor: (item: T) => string
  /**
   * Fires whenever a rail item becomes focused. Used by the home
   * screen to drive the focus-driven hero swap. Optional — rails
   * that don't consume focus events leave it unset.
   */
  onItemFocus?: (index: number, item: T) => void
}

export function ContentRail<T>({
  title,
  data,
  renderItem,
  keyExtractor,
  onItemFocus,
}: ContentRailProps<T>) {
  // `handleItemFocus` closes over `item` rather than indexing back into
  // `data`: FlatList fires focus callbacks asynchronously, and the
  // Apollo cache can deliver a shorter `data` array before a queued
  // callback fires. `data[index]` would then be `undefined` and
  // consumers that read `item.documentId` would throw.
  const handleItemFocus = useCallback(
    (index: number, item: T) => {
      onItemFocus?.(index, item)
    },
    [onItemFocus],
  )

  if (data.length === 0) {
    return null
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <TVFocusGuideView autoFocus>
        <FlatList
          data={data}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item, index }) => (
            <View
              style={[
                styles.itemWrapper,
                index < data.length - 1 && styles.itemWithGap,
              ]}
            >
              {renderItem(item, index, {
                onFocus: () => handleItemFocus(index, item),
              })}
            </View>
          )}
        />
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  title: {
    fontFamily: "System",
    fontSize: scale(20),
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: scale(12),
    paddingHorizontal: scale(80),
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  itemWrapper: {
    paddingVertical: scale(40),
  },
  itemWithGap: {
    marginRight: scale(24),
  },
})
