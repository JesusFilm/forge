// On-page dub picker (R8, R13). VIRTUALIZED: JESUS has ~2,259 Animated rows, so
// getItemLayout + initialScrollIndex open AT the active dub (lets hasTVPreferredFocus
// land — tvOS ignores it on unmounted rows). Unplayable dubs (`hls` null/empty) render
// DISABLED + non-focusable (panelState.ts); Close stays focusable so nobody's trapped.

import { useMemo } from "react"
import { FlatList, Modal, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { annotateVariantRows } from "./panelState"
import { useVariantList } from "./useVariantList"
import { WatchOptionRow } from "./WatchOptionRow"
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

  // Shared virtualized-list wiring: scroll-to-active on every open + one-shot
  // preferred focus (see useVariantList).
  const {
    listRef,
    renderRow,
    keyExtractor,
    getItemLayout,
    initialScrollIndex,
  } = useVariantList({
    rows,
    onSelect: setActiveVariantIndex,
    onClose,
    visible,
  })

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
            ref={listRef}
            data={rows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            initialScrollIndex={initialScrollIndex}
            initialNumToRender={14}
            windowSize={7}
            showsVerticalScrollIndicator={false}
            style={watchMenuStyles.list}
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
