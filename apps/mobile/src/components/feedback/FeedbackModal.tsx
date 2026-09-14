import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
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
import { BG_COLOR, BLACK, hexToRgba } from "../../lib/color"
import { FeedbackSheetContent } from "./FeedbackSheetContent"
import type { FeedbackSheetContext } from "./feedbackFlow"

// The scrim FADES while the panel SLIDES, as in PlayerSettingsSheet: RN's
// Modal `animationType="slide"` would translate the scrim with the panel.
const ENTER_MS = 240
const EXIT_MS = 180

export type FeedbackModalProps = {
  /** KD2/KD8: the player door always has a kind, and usually a video. */
  context: FeedbackSheetContext
  /** Called once the exit animation has run; the host unmounts on it. */
  onClose: () => void
}

/**
 * The player door's host for the feedback form (KTD4): a component-state RN
 * Modal, because a routed form sheet cannot present over the fullscreen
 * player. The form body is shared with the Profile route; this component owns
 * only the presentation, the R19 dismissal lock, and the R11 suppression.
 */
export function FeedbackModal({ context, onClose }: FeedbackModalProps) {
  const insets = useSafeAreaInsets()
  const reduceMotion = useReduceMotion()
  // This component exists only while presented, so the flag is constant.
  useNonRouteSheetSuppression(true, "feedbackModal")

  // R19: set while a submission is in flight. A ref, not state: nothing here
  // renders off it, and a stable `close` keeps the form's own effects from
  // re-arming on every lock change.
  const dismissLockedRef = useRef(false)
  const handleDismissLockedChange = useCallback((locked: boolean) => {
    dismissLockedRef.current = locked
  }, [])

  // 0 = dismissed, 1 = presented. Drives BOTH the scrim's opacity and the
  // panel's offset, so they share one clock while animating differently.
  const progress = useRef(new Animated.Value(0)).current
  const [panelHeight, setPanelHeight] = useState(0)
  const closingRef = useRef(false)

  // Presenting waits for the panel's measured height: its offset is expressed
  // in points, so animating before the layout lands would slide it the wrong
  // distance. The panel stays parked offscreen until then, one frame at most.
  useEffect(() => {
    if (panelHeight === 0 || closingRef.current) return
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [panelHeight, progress, reduceMotion])

  // The host unmounts on `onClose`, so the exit must finish first. A timer
  // fires it, not the animation callback: a native-driver completion never
  // arrives under jest, and an interrupted animation would strand the sheet.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback(() => {
    if (dismissLockedRef.current || closingRef.current) return
    closingRef.current = true
    const exitMs = reduceMotion ? 0 : EXIT_MS
    Animated.timing(progress, {
      toValue: 0,
      duration: exitMs,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
    closeTimerRef.current = setTimeout(onClose, exitMs)
  }, [onClose, progress, reduceMotion])

  // An unmount from any OTHER path (route pop, player handover) would leave the
  // timer above pending and fire onClose into a torn-down tree.
  useEffect(
    () => () => {
      if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current)
    },
    [],
  )

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
            onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
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
