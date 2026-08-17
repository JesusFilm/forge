// Resume / Start over chooser (QoL). Opens from the details Play pill when a
// saved position exists — the Netflix-familiar pattern, scoped to the one
// place a forced resume surprised people. Modal + focus-trap + WatchOptionRow,
// the LanguagePanel/SubtitlePanel visual language; Resume is the default
// (preferred focus), so remote-mashing lands on the least surprising choice.

import { Modal, Text, View } from "react-native"

import { TVFocusGuideView } from "../TVFocusGuideView"
import { formatResumeLabel } from "./detailsHelpers"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

export function ResumeChoicePanel({
  visible,
  resumeAtSeconds,
  onResume,
  onStartOver,
  onClose,
}: {
  visible: boolean
  resumeAtSeconds: number
  onResume: () => void
  onStartOver: () => void
  onClose: () => void
}) {
  if (!visible) return null
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={watchMenuStyles.scrim}>
        <TVFocusGuideView
          autoFocus
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          style={watchMenuStyles.panel}
        >
          <Text style={watchMenuStyles.title} accessibilityRole="header">
            Keep watching?
          </Text>
          <WatchOptionRow
            icon="play"
            label={formatResumeLabel(resumeAtSeconds)}
            selected
            hasTVPreferredFocus
            onPress={onResume}
            accessibilityLabel={formatResumeLabel(resumeAtSeconds)}
          />
          <WatchOptionRow
            icon="refresh"
            label="Start over"
            onPress={onStartOver}
            accessibilityLabel="Start over from the beginning"
          />
          {/* Dismiss stays focusable in every state (never trap the viewer). */}
          <WatchOptionRow
            icon="close"
            label="Cancel"
            onPress={onClose}
            accessibilityLabel="Cancel"
          />
        </TVFocusGuideView>
      </View>
    </Modal>
  )
}
