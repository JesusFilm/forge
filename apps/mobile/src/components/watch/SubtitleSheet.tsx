import { useCallback, useMemo, useState } from "react"
import { Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
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

function sortedSubtitles(subtitles: WatchSubtitle[]): WatchSubtitle[] {
  return [...subtitles].sort((a, b) => {
    const nameA = a.languageName.toLowerCase()
    const nameB = b.languageName.toLowerCase()
    return nameA.localeCompare(nameB)
  })
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

  const sorted = useMemo(() => sortedSubtitles(subtitles), [subtitles])
  const filtered = useMemo(() => {
    if (!query.trim()) return sorted
    const lower = query.toLowerCase()
    return sorted.filter((s) => s.languageName.toLowerCase().includes(lower))
  }, [sorted, query])

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

      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[styles.listContainer, !localToggle && styles.listDisabled]}
          pointerEvents={localToggle ? "auto" : "none"}
        >
          {filtered.map((sub) => {
            const isActive = sub.languageSlug === activeSubtitleSlug
            return (
              <Pressable
                key={sub.documentId}
                style={({ pressed }) => [
                  styles.listRow,
                  isActive && styles.listRowActive,
                  pressed && feedback.pressed,
                ]}
                onPress={() => handleSelect(sub)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={sub.languageName}
              >
                <Text
                  style={[
                    styles.listRowText,
                    typography.body,
                    isActive && styles.listRowTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {sub.languageName}
                </Text>
              </Pressable>
            )
          })}
          {filtered.length === 0 && (
            <View style={styles.emptySearch}>
              <Text style={[styles.emptySearchText, typography.body]}>
                No subtitles found
              </Text>
            </View>
          )}
        </View>
      </BottomSheetScrollView>
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
  listContainer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: 4,
  },
  listDisabled: {
    opacity: 0.5,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    borderLeftWidth: 3,
    borderLeftColor: "rgba(0, 0, 0, 0)",
  },
  listRowActive: {
    borderLeftColor: ACCENT,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  listRowText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flex: 1,
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
