// On-page dub picker (R8, R13). VIRTUALIZED: JESUS's ~2,259 Animated rows, so
// getItemLayout + initialScrollIndex open AT the active dub (lets hasTVPreferredFocus land
// — tvOS ignores it on unmounted rows). Unplayable dubs render DISABLED (panelState.ts).

import { useMemo } from "react"
import { FlatList, Modal, Platform, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { annotateVariantRows, type DetailsDataState } from "./panelState"
import { PanelLoading } from "./PanelLoading"
import { useVariantList } from "./useVariantList"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

export function LanguagePanel({
  visible,
  onClose,
  dataState,
  onRetry,
}: {
  visible: boolean
  onClose: () => void
  dataState?: DetailsDataState
  onRetry?: () => void
}) {
  const { video, activeVariantIndex, setActiveVariantIndex } = useWatchSession()
  const prepareRows =
    (Platform.OS !== "android" || visible) &&
    (dataState == null || dataState === "ready")
  const rows = useMemo(
    () =>
      annotateVariantRows(
        video?.variants ?? [],
        activeVariantIndex,
        prepareRows,
      ),
    [video?.variants, activeVariantIndex, prepareRows],
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

          {dataState === "loading" ? (
            <PanelLoading label="Loading audio languages…" />
          ) : null}
          {dataState === "error" ? (
            <>
              <Text style={watchMenuStyles.status}>
                Couldn’t load audio languages
              </Text>
              {onRetry != null ? (
                <WatchOptionRow
                  icon="refresh-outline"
                  label="Try again"
                  onPress={onRetry}
                />
              ) : null}
            </>
          ) : null}
          {dataState === "ready" && rows.length === 0 ? (
            <Text style={watchMenuStyles.status}>
              No audio languages available
            </Text>
          ) : null}
          {(dataState == null || dataState === "ready") &&
          (Platform.OS !== "android" || visible) ? (
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
          ) : null}

          {/* Dismiss affordance stays focusable in every state so the viewer is
              never trapped (kept reachable even when all dubs are disabled). */}
          <View style={watchMenuStyles.footer}>
            <WatchOptionRow
              icon="close"
              label="Close"
              onPress={onClose}
              accessibilityLabel="Close"
              hasTVPreferredFocus={
                dataState != null &&
                (dataState !== "ready" || rows.length === 0)
              }
            />
          </View>
        </TVFocusGuideView>
      </View>
    </Modal>
  )
}
