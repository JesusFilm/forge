import React, { useCallback, useRef, type ReactNode } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in base RN types
  TVFocusGuideView,
} from "react-native"

/** Module-level focus memory: railId -> last focused index */
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
  const listRef = useRef<FlatList<T>>(null)

  const handleItemFocus = useCallback(
    (index: number) => {
      focusMemory.set(railId, index)
    },
    [railId],
  )

  if (data.length === 0) {
    return null
  }

  const savedIndex = focusMemory.get(railId)

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <TVFocusGuideView autoFocus>
        <FlatList
          ref={listRef}
          data={data}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          initialScrollIndex={savedIndex}
          keyExtractor={keyExtractor}
          getItemLayout={undefined}
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
    color: "#A8A29E",
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
