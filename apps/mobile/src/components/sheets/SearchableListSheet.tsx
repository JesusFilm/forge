import { type ReactNode, useCallback, useMemo, useRef, useState } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { useSheetListHeight } from "../../hooks/useSheetListHeight"
import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { acceptSheetTap, assembleSheetList } from "../../lib/sheetListLogic"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"

export type SearchableListSheetProps<T> = {
  rows: T[]
  // Selection identity of the active row (slug/documentId, never bcp47). Its row is
  // hoisted into the "Current" section and dropped from the list. Null/"" ⇒ none.
  activeId: string | null
  getSelectionId: (item: T) => string
  getKey: (item: T) => string
  getPrimaryLabel: (item: T) => string
  getSecondaryLabel?: (item: T) => string | null | undefined
  getSearchValues: (item: T) => (string | null | undefined)[]
  // Availability guard (e.g. a dub without `hls`): a false row silently ignores
  // taps. Defaults to always-selectable.
  isSelectable?: (item: T) => boolean
  onSelect: (item: T) => void
  searchPlaceholder: string
  searchAccessibilityLabel: string
  emptySearchMessage: string
  // Extra header content above the search field (e.g. the subtitle on/off switch).
  headerTop?: ReactNode
}

// Generic searchable list sheet: FlashList + search + "Current" section + 500ms
// double-tap debounce + formSheet detent-height wiring. The language/subtitle
// sheets are thin adapters supplying row identity, labels, guard, and callback.
export function SearchableListSheet<T>({
  rows,
  activeId,
  getSelectionId,
  getKey,
  getPrimaryLabel,
  getSecondaryLabel,
  getSearchValues,
  isSelectable,
  onSelect,
  searchPlaceholder,
  searchAccessibilityLabel,
  emptySearchMessage,
  headerTop,
}: SearchableListSheetProps<T>) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const typography = useTypography()
  const [query, setQuery] = useState("")
  // FlashList virtualizes but needs an explicit height inside the formSheet (the
  // content root is unbounded). Derived from the native detent index — see
  // useSheetListHeight, the single owner of that gotcha.
  const listHeight = useSheetListHeight(windowHeight)
  // Debounce so a fast double-tap can't fire the selection (and router.back())
  // twice and pop the underlying screen.
  const lastSelectRef = useRef(0)

  const { active, filtered } = useMemo(
    () =>
      assembleSheetList({
        rows,
        activeId,
        query,
        getSelectionId,
        getPrimaryLabel,
        getSearchValues,
      }),
    [rows, activeId, query, getSelectionId, getPrimaryLabel, getSearchValues],
  )

  const handleSelect = useCallback(
    (item: T) => {
      const now = Date.now()
      if (!acceptSheetTap(now, lastSelectRef.current)) return
      if (isSelectable && !isSelectable(item)) return
      lastSelectRef.current = now
      onSelect(item)
    },
    [isSelectable, onSelect],
  )

  const renderItem = useCallback(
    ({ item }: { item: T }) => {
      const secondary = getSecondaryLabel?.(item)
      return (
        <Pressable
          style={({ pressed }) => [styles.listRow, pressed && feedback.pressed]}
          onPress={() => handleSelect(item)}
          accessibilityRole="radio"
          accessibilityState={{ selected: false }}
          accessibilityLabel={getPrimaryLabel(item)}
        >
          <View style={styles.nameColumn}>
            <Text
              style={[styles.listRowText, typography.body]}
              numberOfLines={1}
            >
              {getPrimaryLabel(item)}
            </Text>
            {secondary ? (
              <Text
                style={[styles.nativeText, typography.bodySmall]}
                numberOfLines={1}
              >
                {secondary}
              </Text>
            ) : null}
          </View>
        </Pressable>
      )
    },
    [getPrimaryLabel, getSecondaryLabel, handleSelect, typography],
  )

  const keyExtractor = useCallback((item: T) => getKey(item), [getKey])

  const activeSecondary = active ? getSecondaryLabel?.(active) : null

  // Search + current selection live in the list header so they scroll with the
  // list in one container.
  const header = (
    <View style={styles.header}>
      {headerTop}

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={TEXT_SECONDARY} />
        <TextInput
          style={[styles.searchInput, typography.body]}
          placeholder={searchPlaceholder}
          placeholderTextColor={TEXT_SECONDARY}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={searchAccessibilityLabel}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        )}
      </View>

      {active && (
        <View style={styles.currentSection}>
          <Text style={[styles.currentLabel, typography.bodySmall]}>
            Current
          </Text>
          <View style={[styles.listRow, styles.listRowActive]}>
            <Ionicons name="checkmark" size={18} color={ACCENT} />
            <View style={styles.nameColumn}>
              <Text
                style={[
                  styles.listRowText,
                  typography.body,
                  styles.listRowTextActive,
                ]}
                numberOfLines={1}
              >
                {getPrimaryLabel(active)}
              </Text>
              {activeSecondary ? (
                <Text
                  style={[styles.nativeText, typography.bodySmall]}
                  numberOfLines={1}
                >
                  {activeSecondary}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </View>
  )

  return (
    <View style={styles.container}>
      <View style={{ height: listHeight }}>
        <FlashList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          // Off by intent: FlashList v2's default maintainVisibleContentPosition
          // (for chat-like lists) makes our list jump when the search swaps data
          // wholesale (e.g. the X clearing the query scrolls up then settles).
          maintainVisibleContentPosition={{ disabled: true }}
          ListHeaderComponent={header}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING,
            paddingBottom: insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptySearch}>
              <Text style={[styles.emptySearchText, typography.body]}>
                {emptySearchMessage}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 36,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  searchInput: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    padding: 0,
  },
  currentSection: {
    marginBottom: 12,
  },
  currentLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 6,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
  },
  listRowActive: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  nameColumn: {
    flex: 1,
    minWidth: 0,
  },
  listRowText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  listRowTextActive: {
    fontWeight: "600",
  },
  nativeText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 2,
  },
  emptySearch: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySearchText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
})
