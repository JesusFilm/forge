import { useCallback, useRef } from "react"
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useNonRouteSheetSuppression } from "../../hooks/useNonRouteSheetSuppression"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useSlideUpSheet } from "../../hooks/useSlideUpSheet"
import { BG_COLOR, BLACK, hexToRgba } from "../../lib/color"
import { FeedbackSheetContent } from "./FeedbackSheetContent"
import type { FeedbackSheetContext } from "./feedbackFlow"

export type FeedbackModalProps = {
  /** KD2/KD8: the player door always has a kind, and usually a video. */
  context: FeedbackSheetContext
  /** Called once the exit animation has run; the host unmounts on it. */
  onClose: () => void
}

/** Player door host for the feedback form (KTD4): a component-state Modal,
 * since a routed sheet can't cover the fullscreen player. Shares the form body
 * with the Profile route; owns only presentation, the R19 lock, R11 suppression. */
export function FeedbackModal({ context, onClose }: FeedbackModalProps) {
  const insets = useSafeAreaInsets()
  const reduceMotion = useReduceMotion()
  // This component exists only while presented, so the flag is constant.
  useNonRouteSheetSuppression(true, "feedbackModal")

  // R19: a ref, not state, so `close` stays stable and the form's own effects
  // do not re-arm on every lock change.
  const dismissLockedRef = useRef(false)
  const handleDismissLockedChange = useCallback((locked: boolean) => {
    dismissLockedRef.current = locked
  }, [])

  const {
    progress,
    panelHeight,
    onPanelLayout,
    close: runExit,
  } = useSlideUpSheet(onClose, { reduceMotion })
  const close = useCallback(() => {
    if (dismissLockedRef.current) return
    runExit()
  }, [runExit])

  return (
    <Modal
      visible
      transparent
      // "none": this component owns both animations so they can differ.
      animationType="none"
      statusBarTranslucent
      // Fullscreen locks the app to landscape while the Modal's default is
      // portrait-only; UIKit aborts a presentation with no common orientation.
      supportedOrientations={["portrait", "landscape"]}
      // R19: the Android back button lands here, and `close` refuses it while
      // a submission is in flight.
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[styles.scrim, { opacity: progress }]}
        />
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss feedback"
        />
        {/* AE13: the keyboard shrinks this box, the panel takes a share of what
            is left, and the form's own ScrollView scrolls inside that share —
            so in landscape the message field and Send both stay reachable. */}
        <KeyboardAvoidingView
          style={styles.keyboardRoom}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <Animated.View
            onLayout={onPanelLayout}
            style={[
              styles.panel,
              {
                paddingBottom: Math.max(insets.bottom, 12),
                paddingLeft: insets.left,
                paddingRight: insets.right,
              },
              {
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      // Parked a full panel-height down until measured, so the
                      // unmeasured first frame is offscreen rather than in place.
                      outputRange: [panelHeight || 9999, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <FeedbackSheetContent
              context={context}
              onClose={close}
              onDismissLockedChange={handleDismissLockedChange}
            />
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  // Carries the dimming so its opacity can animate independently of the panel.
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: hexToRgba(BLACK, 0.5),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  keyboardRoom: {
    flex: 1,
    justifyContent: "flex-end",
  },
  // The app's hard-coded dark surface — the sheet must not follow the system
  // appearance the player chrome ignores. A percentage, not a measured
  // height, so the panel shrinks with the room the keyboard leaves.
  panel: {
    height: "92%",
    backgroundColor: BG_COLOR,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 4,
    overflow: "hidden",
  },
})
