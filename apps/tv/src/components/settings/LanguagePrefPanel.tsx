// Settings default-language picker: the full public language list under a
// leading clear row ("Automatic"/"Off"). Prop-driven like SeriesLanguagePanel —
// the SCREEN owns the preference write and closing; this only renders + reports.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Modal, StyleSheet, Text, View } from "react-native"

import {
  buildLanguageRows,
  languageDisplayName,
  type SeriesLanguageRow,
} from "../../contexts/seriesLanguageState"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WatchOptionRow } from "../watch/WatchOptionRow"
import { WATCH_OPTION_ROW_HEIGHT } from "../watch/watchMenuLayout"
import { watchMenuStyles } from "../watch/watchMenuStyles"

export function LanguagePrefPanel({
  visible,
  title,
  subtitle,
  clearLabel,
  languages,
  loading,
  error,
  onRetry,
  activeSlug,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  subtitle: string
  /** Label of the leading no-preference row ("Automatic" / "Off"). */
  clearLabel: string
  /** Full normalized language list; null while loading or on error. */
  languages: WatchChildLanguage[] | null
  loading: boolean
  error: boolean
  onRetry: () => void
  /** Stored preference slug; null marks the clear row selected. */
  activeSlug: string | null
  /** Reports the chosen language, or null to clear the preference. */
  onSelect: (language: WatchChildLanguage | null) => void
  onClose: () => void
}) {
  const rows = useMemo(
    () => buildLanguageRows(languages ?? [], activeSlug),
    [languages, activeSlug],
  )
  const activeDisplayIndex = useMemo(
    () => rows.findIndex((row) => row.active),
    [rows],
  )
  const bySlug = useMemo(() => {
    const map = new Map<string, WatchChildLanguage>()
    for (const language of languages ?? []) map.set(language.slug, language)
    return map
  }, [languages])

  const listRef = useRef<FlatList<SeriesLanguageRow>>(null)

  // One-shot preferred focus + scroll-to-active per open (SeriesLanguagePanel's
  // virtualization behaviors). Modal keeps this subtree mounted, so reopening
  // must re-arm.
  const [focusArmed, setFocusArmed] = useState(true)
  const disarmFocus = useCallback(() => {
    setFocusArmed((armed) => (armed ? false : armed))
  }, [])

  const scrolledForOpenRef = useRef(false)
  useEffect(() => {
    if (!visible) return
    setFocusArmed(true)
    scrolledForOpenRef.current = false
  }, [visible])

  // Scroll to the stored row once per open, as soon as rows exist. On the
  // session's FIRST open the lazy list lands after `visible`, so this must not
  // key on [visible] alone — the stored row would stay buried unscrolled.
  useEffect(() => {
    if (!visible || scrolledForOpenRef.current) return
    if (languages == null) return
    scrolledForOpenRef.current = true
    if (activeDisplayIndex > 0) {
      listRef.current?.scrollToIndex({
        index: activeDisplayIndex,
        animated: false,
      })
    } else {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    // The latch (not the deps) makes this once-per-open: re-scrolling a
    // still-open panel under the user would jank.
  }, [visible, languages, activeDisplayIndex])

  const renderRow = useCallback(
    ({ item: row }: { item: SeriesLanguageRow }) => {
      const name = languageDisplayName(row.language)
      return (
        <WatchOptionRow
          icon="globe-outline"
          label={name}
          selected={row.active}
          hasTVPreferredFocus={row.active && focusArmed}
          onFocus={disarmFocus}
          onPress={() => onSelect(bySlug.get(row.language.slug) ?? null)}
          accessibilityLabel={name}
        />
      )
    },
    [onSelect, bySlug, focusArmed, disarmFocus],
  )

  const keyExtractor = useCallback(
    (row: SeriesLanguageRow) => `language-pref-${row.language.slug}`,
    [],
  )

  // Fixed-height rows → exact offsets without measuring.
  const getItemLayout = useCallback(
    (
      _data: ArrayLike<SeriesLanguageRow> | null | undefined,
      index: number,
    ) => ({
      length: WATCH_OPTION_ROW_HEIGHT,
      offset: index * WATCH_OPTION_ROW_HEIGHT,
      index,
    }),
    [],
  )

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={watchMenuStyles.scrim}>
        <TVFocusGuideView
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          style={watchMenuStyles.panel}
        >
          <View style={watchMenuStyles.header}>
            <Text style={watchMenuStyles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={watchMenuStyles.subtitle}>{subtitle}</Text>
          </View>

          {/* Clear row — always present + focusable in every state, so the
              panel is never a trap and "no preference" is always reachable. */}
          <View style={watchMenuStyles.listContent}>
            <WatchOptionRow
              icon="remove-circle-outline"
              label={clearLabel}
              selected={activeSlug == null}
              hasTVPreferredFocus={activeSlug == null && focusArmed}
              onFocus={disarmFocus}
              onPress={() => onSelect(null)}
              accessibilityLabel={clearLabel}
            />

            {loading ? (
              <Text style={watchMenuStyles.status}>Loading languages…</Text>
            ) : null}

            {error ? (
              <>
                <Text style={watchMenuStyles.status}>
                  Couldn’t load languages
                </Text>
                <WatchOptionRow
                  icon="refresh"
                  label="Retry"
                  onPress={onRetry}
                  accessibilityLabel="Retry"
                />
              </>
            ) : null}
          </View>

          <FlatList
            ref={listRef}
            data={rows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            initialScrollIndex={
              activeDisplayIndex > 0 ? activeDisplayIndex : undefined
            }
            initialNumToRender={14}
            windowSize={7}
            showsVerticalScrollIndicator={false}
            style={[watchMenuStyles.list, styles.list]}
            contentContainerStyle={watchMenuStyles.listContent}
          />

          {/* Dismiss affordance stays focusable in every state. */}
          <View style={watchMenuStyles.footer}>
            <WatchOptionRow
              icon="close"
              label="Close"
              onPress={onClose}
              accessibilityLabel="Close"
            />
          </View>
        </TVFocusGuideView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  // The always-present clear row sits above the list, so cap one row shorter
  // than the shared 9-row menu list — at 9 the loaded panel exceeds its
  // maxHeight and the Close row clips on Android TV's taller font metrics.
  list: { maxHeight: 8 * WATCH_OPTION_ROW_HEIGHT },
})
