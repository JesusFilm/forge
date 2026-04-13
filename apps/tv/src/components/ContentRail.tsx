import React, { useCallback, type ReactNode } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native"

import { COLORS } from "../lib/colors"

/**
 * Module-level focus memory: railId -> last focused index.
 *
 * Writes on every item focus. Reads are currently wired nowhere —
 * `initialScrollIndex` was removed because FlatList requires
 * `getItemLayout` for it (and our items aren't fixed-size). The write
 * remains so a future scroll-restore implementation has state to
 * consume. If restoration is built, see `onScrollToIndexFailed` below
 * for the fallback path.
 */
const focusMemory = new Map<string, number>()

type ContentRailProps<T> = {
  title: string
  data: T[]
  renderItem: (item: T, index: number) => ReactNode
  railId: string
  keyExtractor: (item: T) => string
}

export function ContentRail<T>({
  title,
  data,
  renderItem,
  railId,
  keyExtractor,
}: ContentRailProps<T>) {
  const handleItemFocus = useCallback(
    (index: number) => {
      focusMemory.set(railId, index)
    },
    [railId],
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
              style={index < data.length - 1 ? styles.itemWithGap : undefined}
              onFocus={() => handleItemFocus(index)}
            >
              {renderItem(item, index)}
            </View>
          )}
        />
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  title: {
    fontFamily: "System",
    fontSize: 20,
    color: COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingHorizontal: 80,
  },
  listContent: {
    paddingHorizontal: 80,
  },
  itemWithGap: {
    marginRight: 24,
  },
})
