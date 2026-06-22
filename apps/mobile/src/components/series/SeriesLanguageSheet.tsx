import { useCallback, useMemo, useRef, useState } from "react"
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
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"

// Series language sheet over childDubLanguages (episode language union); separate
// from watch LanguageSheetContent because identity is the unique `slug` not bcp47
// (`ko` collides with `ko-kmr`) and there's no `hls`/`documentId` to guard.
function displayName(lang: WatchChildLanguage): string {
  return lang.name ?? lang.slug
}

function sortByName(languages: WatchChildLanguage[]): WatchChildLanguage[] {
  return [...languages].sort((a, b) =>
    displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()),
  )
}

export type SeriesLanguageSheetProps = {
  languages: WatchChildLanguage[]
  activeLanguageSlug: string
  onLanguageChange: (slug: string) => void
  onClose: () => void
}

export function SeriesLanguageSheet({
  languages,
  activeLanguageSlug,
  onLanguageChange,
  onClose,
}: SeriesLanguageSheetProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const typography = useTypography()
  const [query, setQuery] = useState("")
  // FlashList virtualizes but needs an explicit height inside the formSheet.
  const listHeight = useSheetListHeight(windowHeight)
  // Debounce so a fast double-tap can't pop the route twice.
  const lastSelectRef = useRef(0)

  const sorted = useMemo(() => sortByName(languages), [languages])
  const active = useMemo(
    () => sorted.find((l) => l.slug === activeLanguageSlug) ?? null,
    [sorted, activeLanguageSlug],
  )
  const filtered = useMemo(() => {
    let list = sorted
    if (query.trim()) {
      const lower = query.toLowerCase()
      list = sorted.filter((l) => displayName(l).toLowerCase().includes(lower))
    }
    return list.filter((l) => l.slug !== activeLanguageSlug)
  }, [sorted, query, activeLanguageSlug])

  const handleSelect = useCallback(
    (lang: WatchChildLanguage) => {
      const now = Date.now()
      if (now - lastSelectRef.current < 500) return
      lastSelectRef.current = now
      // Exact slug match — never bcp47.
      onLanguageChange(lang.slug)
      onClose()
    },
    [onLanguageChange, onClose],
  )

  const renderItem = useCallback(
    ({ item }: { item: WatchChildLanguage }) => (
      <Pressable
        style={({ pressed }) => [styles.listRow, pressed && feedback.pressed]}
        onPress={() => handleSelect(item)}
        accessibilityRole="radio"
        accessibilityState={{ selected: false }}
        accessibilityLabel={displayName(item)}
      >
        <View style={styles.nameColumn}>
          <Text style={[styles.listRowText, typography.body]} numberOfLines={1}>
            {displayName(item)}
          </Text>
        </View>
      </Pressable>
    ),
    [handleSelect, typography],
  )

  const keyExtractor = useCallback((item: WatchChildLanguage) => item.slug, [])

  const header = (
    <View style={styles.header}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={TEXT_SECONDARY} />
        <TextInput
          style={[styles.searchInput, typography.body]}
          placeholder="Search languages..."
          placeholderTextColor={TEXT_SECONDARY}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search languages"
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
                {displayName(active)}
              </Text>
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
          // Off by intent: FlashList v2 enables maintainVisibleContentPosition by
          // default; here the data swaps wholesale as the user types/clears the
          // search, so anchoring makes the list jump.
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
                No languages found
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
  emptySearch: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySearchText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
})
