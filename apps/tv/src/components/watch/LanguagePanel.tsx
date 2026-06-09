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
// A published dub with no playable stream (`hls == null` / empty) renders as a
// DISABLED, non-selectable row: visually muted and NOT focusable, so the viewer
// can't pick an unplayable language. The annotation lives in panelState.ts
// (unit-tested there — jest-expo can't load this .tsx). The Close affordance is
// always focusable so the viewer is never trapped.

import { useMemo } from "react"
import { Modal, ScrollView, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { annotateVariantRows } from "./panelState"
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

          <ScrollView contentContainerStyle={watchMenuStyles.listContent}>
            {rows.map((row) => {
              const name =
                row.variant.languageName ??
                row.variant.languageSlug ??
                row.variant.slug
              return (
                <WatchOptionRow
                  key={`variant-${row.variant.documentId ?? ""}-${row.index}`}
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
            })}
          </ScrollView>

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
