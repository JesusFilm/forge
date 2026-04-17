import React, { useCallback, type ReactNode } from "react"
import {
  findNodeHandle,
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
  /**
   * Notifies the parent when the rail's focusable wrapper is ready,
   * so the parent can target it with `nextFocusDown` from an element
   * above the rail (e.g., the Explore CTA in the hero).
   */
  onFocusHandleChange?: (handle: number | null) => void
}

export function ContentRail<T>({
  title,
  data,
  renderItem,
  railId,
  keyExtractor,
  onItemFocus,
  onFocusHandleChange,
}: ContentRailProps<T>) {
  const handleItemFocus = useCallback(
    (index: number) => {
      focusMemory.set(railId, index)
      onItemFocus?.(index, data[index])
    },
    [railId, onItemFocus, data],
  )

  const setRailRef = useCallback(
    (node: View | null) => {
      if (!onFocusHandleChange) return
      onFocusHandleChange(node ? (findNodeHandle(node) ?? null) : null)
    },
    [onFocusHandleChange],
  )

  if (data.length === 0) {
    return null
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <TVFocusGuideView autoFocus ref={setRailRef}>
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
              {renderItem(item, index, {
                onFocus: () => handleItemFocus(index),
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
