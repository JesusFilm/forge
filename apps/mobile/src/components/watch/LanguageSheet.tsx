import { useCallback, useMemo, useState } from "react"
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchVariant } from "../../lib/normalizeVideo"

function displayName(v: WatchVariant): string {
  return v.languageName ?? "Unknown"
}

function sortByName(variants: WatchVariant[]): WatchVariant[] {
  return [...variants].sort((a, b) =>
    displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()),
  )
}

export type LanguageSheetProps = {
  variants: WatchVariant[]
  activeVariantSlug: string
  onLanguageChange: (variantSlug: string, hlsUrl: string) => void
  onClose: () => void
}

export function LanguageSheetContent({
  variants,
  activeVariantSlug,
  onLanguageChange,
  onClose,
}: LanguageSheetProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const typography = useTypography()
  const [query, setQuery] = useState("")

  const sorted = useMemo(() => sortByName(variants), [variants])
  const activeVariant = useMemo(
    () => sorted.find((v) => v.slug === activeVariantSlug) ?? null,
    [sorted, activeVariantSlug],
  )
  const filtered = useMemo(() => {
    let list = sorted
    if (query.trim()) {
      const lower = query.toLowerCase()
      list = sorted.filter(
        (v) =>
          displayName(v).toLowerCase().includes(lower) ||
          (v.languageNameNative?.toLowerCase().includes(lower) ?? false),
      )
    }
    return list.filter((v) => v.slug !== activeVariantSlug)
  }, [sorted, query, activeVariantSlug])

  const handleSelect = useCallback(
    (variant: WatchVariant) => {
      if (!variant.hls) return
      onLanguageChange(variant.slug, variant.hls)
      onClose()
    },
    [onLanguageChange, onClose],
  )

  const renderItem = useCallback(
    ({ item }: { item: WatchVariant }) => (
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
          {item.languageNameNative && (
            <Text
              style={[styles.nativeText, typography.bodySmall]}
              numberOfLines={1}
            >
              {item.languageNameNative}
            </Text>
          )}
        </View>
      </Pressable>
    ),
    [handleSelect, typography],
  )

  const keyExtractor = useCallback((item: WatchVariant) => item.documentId, [])

  // Search + current selection live in the list header so they share the
  // single scroll container — avoids sibling-overlap when the formSheet host
  // doesn't give a plain flex column a bounded height.
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
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        )}
      </View>

      {activeVariant && (
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
                {displayName(activeVariant)}
              </Text>
              {activeVariant.languageNameNative && (
                <Text
                  style={[styles.nativeText, typography.bodySmall]}
                  numberOfLines={1}
                >
                  {activeVariant.languageNameNative}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  )

  return (
    <FlatList
      style={styles.container}
      data={filtered}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      contentContainerStyle={{
        paddingHorizontal: HORIZONTAL_PADDING,
        paddingBottom: insets.bottom + windowHeight * 0.25,
      }}
      showsVerticalScrollIndicator={false}
      initialNumToRender={15}
      maxToRenderPerBatch={20}
      windowSize={5}
      ListEmptyComponent={
        <View style={styles.emptySearch}>
          <Text style={[styles.emptySearchText, typography.body]}>
            No languages found
          </Text>
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 8,
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
