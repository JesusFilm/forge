import React, { useCallback, type ReactNode } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  TVFocusGuideView,
  View,
} from "react-native"

import { COLORS } from "../lib/colors"
import { scale } from "../lib/scale"

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
              style={[
                styles.itemWrapper,
                index < data.length - 1 && styles.itemWithGap,
              ]}
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
