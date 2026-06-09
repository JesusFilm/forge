// On-page language (audio dub) picker for the details screen (R8, R13).
//
// Styled to the Claude Design handoff ("Forge TV Video Page" → Audio Language
// sheet): a translucent, hairline-bordered sheet centred over a dimmed backdrop,
// a header with a dimmed sub-line, and a focus-trapping TVFocusGuideView wrapping
// a list of dubs (WatchOptionRow). Each row carries a leading globe glyph, the
// language name (+ native name), and a red check on the active dub; focus inverts
// the row to a white fill (tvOS HIG). Selecting a playable dub sets the session's
// activeVariantIndex and dismisses.
//
// The list is a VIRTUALIZED FlatList, not a ScrollView: a video like the JESUS
// film carries ~2,259 dubs, and every WatchOptionRow mounts Animated values —
// mounting all rows froze the sheet open. Rows are fixed-height
// (WATCH_OPTION_ROW_HEIGHT), so getItemLayout + initialScrollIndex open the
// sheet AT the active dub with its row mounted — which is also what lets
// hasTVPreferredFocus land (tvOS ignores preferred focus on unmounted rows).
//
// A published dub with no playable stream (`hls == null` / empty) renders as a
// DISABLED, non-selectable row: visually muted and NOT focusable, so the viewer
// can't pick an unplayable language. The annotation lives in panelState.ts
// (unit-tested there — jest-expo can't load this .tsx). The Close affordance is
// always focusable so the viewer is never trapped.

import { useCallback, useMemo } from "react"
import { FlatList, Modal, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { annotateVariantRows, type AnnotatedVariantRow } from "./panelState"
import { WATCH_OPTION_ROW_HEIGHT, WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

export function LanguagePanel({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const { video, activeVariantIndex, setActiveVariantIndex } = useWatchSession()
  const rows = useMemo(
    () => annotateVariantRows(video?.variants ?? [], activeVariantIndex),
    [video?.variants, activeVariantIndex],
  )
  // Display position of the active dub in the sorted list — the sheet opens
  // scrolled here so the checked row is visible and takes initial focus.
  const activeDisplayIndex = useMemo(
    () => rows.findIndex((row) => row.active),
    [rows],
  )

  const renderRow = useCallback(
    ({ item: row }: { item: AnnotatedVariantRow }) => {
      const name =
        row.variant.languageName ?? row.variant.languageSlug ?? row.variant.slug
      return (
        <WatchOptionRow
          icon="globe-outline"
          label={name}
          note={row.variant.languageNameNative}
          selected={row.active}
          disabled={row.disabled}
          hasTVPreferredFocus={row.active}
          onPress={() => {
            setActiveVariantIndex(row.index)
            onClose()
          }}
          accessibilityLabel={name}
        />
      )
    },
    [setActiveVariantIndex, onClose],
  )

  const keyExtractor = useCallback(
    (row: AnnotatedVariantRow) =>
      `variant-${row.variant.documentId ?? ""}-${row.index}`,
    [],
  )

  // Fixed-height rows → exact offsets without measuring (required for
  // initialScrollIndex on a virtualized list).
  const getItemLayout = useCallback(
    (
      _data: ArrayLike<AnnotatedVariantRow> | null | undefined,
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
              Audio Language
            </Text>
            <Text style={watchMenuStyles.subtitle}>
              Choose the spoken language
            </Text>
          </View>

          <FlatList
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
            contentContainerStyle={watchMenuStyles.listContent}
          />

          {/* Dismiss affordance stays focusable in every state so the viewer is
              never trapped (kept reachable even when all dubs are disabled). */}
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
