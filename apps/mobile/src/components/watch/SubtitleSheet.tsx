import { useCallback, useMemo, useState } from "react"
import { Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BottomSheetFlatList, BottomSheetTextInput } from "@gorhom/bottom-sheet"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchSubtitle } from "../../lib/normalizeVideo"

function sortByName(subtitles: WatchSubtitle[]): WatchSubtitle[] {
  return [...subtitles].sort((a, b) =>
    a.languageName.toLowerCase().localeCompare(b.languageName.toLowerCase()),
  )
}

export type SubtitleSheetProps = {
  subtitles: WatchSubtitle[]
  subtitleEnabled: boolean
  activeSubtitleSlug: string | null
  onSubtitleChange: (enabled: boolean, slug: string | null) => void
  onClose: () => void
}

export function SubtitleSheetContent({
  subtitles,
  subtitleEnabled,
  activeSubtitleSlug,
  onSubtitleChange,
  onClose,
}: SubtitleSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const [query, setQuery] = useState("")
  const [localToggle, setLocalToggle] = useState(subtitleEnabled)

  const sorted = useMemo(() => sortByName(subtitles), [subtitles])
  const activeSubtitle = useMemo(
    () => sorted.find((s) => s.languageSlug === activeSubtitleSlug) ?? null,
    [sorted, activeSubtitleSlug],
  )
  const filtered = useMemo(() => {
    let list = sorted
    if (query.trim()) {
      const lower = query.toLowerCase()
      list = sorted.filter((s) => s.languageName.toLowerCase().includes(lower))
    }
    return list.filter((s) => s.languageSlug !== activeSubtitleSlug)
  }, [sorted, query, activeSubtitleSlug])

  const handleToggle = useCallback(
    (value: boolean) => {
      if (!value) {
        onSubtitleChange(false, null)
        onClose()
      } else {
        setLocalToggle(true)
      }
    },
    [onSubtitleChange, onClose],
  )

  const handleSelect = useCallback(
    (sub: WatchSubtitle) => {
      onSubtitleChange(true, sub.languageSlug)
      onClose()
    },
    [onSubtitleChange, onClose],
  )

  const renderItem = useCallback(
    ({ item }: { item: WatchSubtitle }) => (
      <Pressable
        style={({ pressed }) => [styles.listRow, pressed && feedback.pressed]}
        onPress={() => handleSelect(item)}
        accessibilityRole="radio"
        accessibilityState={{ selected: false }}
        accessibilityLabel={item.languageName}
      >
        <View style={styles.nameColumn}>
          <Text style={[styles.listRowText, typography.body]} numberOfLines={1}>
            {item.languageName}
          </Text>
        </View>
      </Pressable>
    ),
    [handleSelect, typography],
  )

  const keyExtractor = useCallback((item: WatchSubtitle) => item.documentId, [])

  if (subtitles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={48}
          color={TEXT_SECONDARY}
        />
        <Text style={[styles.emptyText, typography.body]}>
          No subtitles available
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, typography.titleSmall]}>
          Subtitles
        </Text>
        <Switch
          value={localToggle}
          onValueChange={handleToggle}
          trackColor={{ false: SURFACE_COLOR, true: ACCENT }}
          thumbColor="#ffffff"
          accessibilityRole="switch"
          accessibilityLabel="Enable subtitles"
        />
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={TEXT_SECONDARY} />
        <BottomSheetTextInput
          style={[styles.searchInput, typography.body]}
          placeholder="Search subtitles..."
          placeholderTextColor={TEXT_SECONDARY}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          editable={localToggle}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        )}
      </View>

      {localToggle && activeSubtitle && (
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
                {activeSubtitle.languageName}
              </Text>
            </View>
          </View>
        </View>
      )}

      <View
        style={[!localToggle && styles.listDisabled]}
        pointerEvents={localToggle ? "auto" : "none"}
      >
        <BottomSheetFlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING,
            paddingBottom: insets.bottom + 16,
          }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={5}
          ListEmptyComponent={
            <View style={styles.emptySearch}>
              <Text style={[styles.emptySearchText, typography.body]}>
                No subtitles found
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  toggleLabel: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
    fontFamily: "System",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: HORIZONTAL_PADDING,
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
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  currentLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 6,
  },
  listDisabled: {
    opacity: 0.5,
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
