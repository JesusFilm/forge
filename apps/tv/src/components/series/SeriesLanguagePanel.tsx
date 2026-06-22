// Series-screen language picker (U4): lists the child-dub language UNION
// (record.languages), not the series' own dubs — the choice sets the dub an
// opened episode starts in. Rows are NEVER trailer-playability-disabled (AE9):
// a language with no trailer dub is still a valid episode language. Same
// virtualization as LanguagePanel (fixed-height rows + one-shot focusArmed,
// since tvOS ignores preferred focus on unmounted rows); SCREEN owns closing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Modal, Text, View } from "react-native"

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

export function SeriesLanguagePanel({
  visible,
  languages,
  activeSlug,
  onSelect,
  onClose,
}: {
  visible: boolean
  /** The series' language union (normalizeSeries' record.languages). */
  languages: WatchChildLanguage[]
  /**
   * Slug marked active (check + initial scroll/focus target). Screen passes
   * its selection, falling back to the trailer dub's language so first open
   * lands on what currently plays.
   */
  activeSlug: string | null
  /** Reports the chosen slug; the screen persists it and closes the panel. */
  onSelect: (slug: string) => void
  onClose: () => void
}) {
  const rows = useMemo(
    () => buildLanguageRows(languages, activeSlug),
    [languages, activeSlug],
  )
  const activeDisplayIndex = useMemo(
    () => rows.findIndex((row) => row.active),
    [rows],
  )

  const listRef = useRef<FlatList<SeriesLanguageRow>>(null)

  // One-shot preferred focus + scroll-to-active per open — useVariantList's two
  // virtualization behaviors, re-implemented here since that hook is typed to
  // dub rows. Modal keeps this subtree mounted, so reopening must re-arm.
  const [focusArmed, setFocusArmed] = useState(true)
  const disarmFocus = useCallback(() => {
    setFocusArmed((armed) => (armed ? false : armed))
  }, [])

  useEffect(() => {
    if (!visible) return
    setFocusArmed(true)
    if (activeDisplayIndex > 0) {
      listRef.current?.scrollToIndex({
        index: activeDisplayIndex,
        animated: false,
      })
    } else {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    // Intentionally keyed on `visible` only (not activeDisplayIndex):
    // selection closes the panel, and re-scrolling a still-open panel under
    // the user would jank.
  }, [visible])

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
          onPress={() => onSelect(row.language.slug)}
          accessibilityLabel={name}
        />
      )
    },
    [onSelect, focusArmed, disarmFocus],
  )

  const keyExtractor = useCallback(
    (row: SeriesLanguageRow) => `series-language-${row.language.slug}`,
    [],
  )

  // Fixed-height rows → exact offsets without measuring (the heading sits
  // outside the list, so no header offset).
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
              Language
            </Text>
            <Text style={watchMenuStyles.subtitle}>
              Episodes play in this language
            </Text>
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
            style={watchMenuStyles.list}
            contentContainerStyle={watchMenuStyles.listContent}
          />

          {/* Dismiss affordance stays focusable in every state so the viewer
              is never trapped (even when the language union is empty). */}
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
