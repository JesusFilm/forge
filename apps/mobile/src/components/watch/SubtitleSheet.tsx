import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Pressable,
  StyleSheet,
  Switch,
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
  // isUserSelection distinguishes a deliberate row pick (true → persist the
  // language) from a bare on/off toggle (false → don't overwrite the preference
  // with the optimistic/reconciled active slug).
  onSubtitleChange: (
    enabled: boolean,
    slug: string | null,
    isUserSelection: boolean,
  ) => void
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
  const { height: windowHeight } = useWindowDimensions()
  const typography = useTypography()
  const [query, setQuery] = useState("")
  const [localToggle, setLocalToggle] = useState(subtitleEnabled)
  // FlashList needs an explicit height inside the formSheet (content root is
  // unbounded). Derived from the native detent index — see useSheetListHeight.
  const listHeight = useSheetListHeight(windowHeight)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Debounce selection so a fast double-tap (first arms the 300ms deferred close,
  // second takes the immediate-close branch) can't fire router.back() twice and
  // pop the watch screen. A timestamp auto-expires so it can't dead-lock taps.
  const lastSelectRef = useRef(0)

  // Cancel the deferred close on unmount so it can't fire router.back() after
  // the sheet was already dismissed (which would pop the watch screen).
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

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
      setLocalToggle(value)
      onSubtitleChange(value, activeSubtitleSlug, false)
    },
    [onSubtitleChange, activeSubtitleSlug],
  )

  const handleSelect = useCallback(
    (sub: WatchSubtitle) => {
      const now = Date.now()
      if (now - lastSelectRef.current < 500) return
      lastSelectRef.current = now
      onSubtitleChange(true, sub.languageSlug, true)
      if (!localToggle) {
        // Let the switch animate to ON before dismissing.
        setLocalToggle(true)
        closeTimer.current = setTimeout(onClose, 300)
      } else {
        onClose()
      }
    },
    [onSubtitleChange, onClose, localToggle],
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

  const header = (
    <View style={styles.header}>
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
        <TextInput
          style={[styles.searchInput, typography.body]}
          placeholder="Search subtitles..."
          placeholderTextColor={TEXT_SECONDARY}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search subtitles"
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

      {activeSubtitle && (
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
  header: {
    paddingTop: 36,
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
