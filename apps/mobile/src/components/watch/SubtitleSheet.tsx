import { useCallback, useEffect, useRef, useState } from "react"
import { StyleSheet, Switch, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { SearchableListSheet } from "../sheets/SearchableListSheet"
import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import type { WatchSubtitle } from "../../lib/normalizeVideo"

const getSelectionId = (s: WatchSubtitle) => s.languageSlug
const getKey = (s: WatchSubtitle) => s.documentId
const getPrimaryLabel = (s: WatchSubtitle) => s.languageName
const getSearchValues = (s: WatchSubtitle) => [s.languageName]

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
  const typography = useTypography()
  const [localToggle, setLocalToggle] = useState(subtitleEnabled)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel the deferred close on unmount so it can't fire router.back() after
  // the sheet was already dismissed (which would pop the watch screen).
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const handleToggle = useCallback(
    (value: boolean) => {
      setLocalToggle(value)
      onSubtitleChange(value, activeSubtitleSlug, false)
    },
    [onSubtitleChange, activeSubtitleSlug],
  )

  const handleSelect = useCallback(
    (sub: WatchSubtitle) => {
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

  const toggleRow = (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, typography.titleSmall]}>Subtitles</Text>
      <Switch
        value={localToggle}
        onValueChange={handleToggle}
        trackColor={{ false: SURFACE_COLOR, true: ACCENT }}
        thumbColor="#ffffff"
        accessibilityRole="switch"
        accessibilityLabel="Enable subtitles"
      />
    </View>
  )

  return (
    <SearchableListSheet
      rows={subtitles}
      activeId={activeSubtitleSlug}
      getSelectionId={getSelectionId}
      getKey={getKey}
      getPrimaryLabel={getPrimaryLabel}
      getSearchValues={getSearchValues}
      onSelect={handleSelect}
      searchPlaceholder="Search subtitles..."
      searchAccessibilityLabel="Search subtitles"
      emptySearchMessage="No subtitles found"
      headerTop={toggleRow}
    />
  )
}

const styles = StyleSheet.create({
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
})
