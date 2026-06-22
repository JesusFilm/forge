import React, { useCallback, type ReactNode } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"

import { TVFocusGuideView } from "./TVFocusGuideView"
import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"

/**
 * Hooks passed into each item's renderItem so the consumer wires focus directly
 * into the interactive child (e.g. FocusableCard's `onFocus`). The wrapper View's
 * `onFocus` doesn't fire reliably for a nested Pressable on tvOS — focus events
 * don't bubble consistently across react-native-tvos versions.
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
   * Fires when a rail item gains focus; the home screen uses it to drive the
   * hero swap. Optional — rails that don't consume focus leave it unset.
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
  // Closes over `item` rather than indexing `data`: FlatList fires focus
  // callbacks async, and Apollo can swap in a shorter `data` first, so
  // `data[index]` would be undefined and `item.documentId` reads would throw.
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
