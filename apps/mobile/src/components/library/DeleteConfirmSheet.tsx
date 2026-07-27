import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
} from "../../lib/color"
import { formatLibraryBytes } from "../../lib/libraryDownloads"
import { feedback } from "../../styles/shared"

const SHEET_OFFSCREEN = 400
const ANIMATION_MS = 280
const SCRIM_BG = "rgba(0, 0, 0, 0.55)"
const CANCEL_BG = "rgba(255, 255, 255, 0.08)"

export interface DeleteConfirmSheetProps {
  visible: boolean
  count: number
  combinedBytes: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-screen animated delete confirmation (R13, KTD7) — a scrim + bottom card
 * rendered inline in the Library screen, NOT a formSheet route or Alert.
 * Cancel/scrim-tap/back all resolve to onCancel, returning to selection.
 */
export function DeleteConfirmSheet({
  visible,
  count,
  combinedBytes,
  onConfirm,
  onCancel,
}: DeleteConfirmSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const [mounted, setMounted] = useState(visible)
  const translateY = useRef(
    new Animated.Value(visible ? 0 : SHEET_OFFSCREEN),
  ).current
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  // State, not a ref: a ref wouldn't re-render, so a FIRST open that lands
  // before the initial async read resolves would ignore reduce-motion.
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduceMotion(value)
    })
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (visible) setMounted(true)
    const duration = reduceMotion ? 0 : ANIMATION_MS
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: visible ? 0 : SHEET_OFFSCREEN,
        duration,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
  }, [visible, translateY, opacity, reduceMotion])

  if (!mounted) return null

  return (
    <>
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.scrim, { opacity }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
      </Animated.View>
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[
          styles.card,
          { paddingBottom: insets.bottom + 16, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.grabber} />
        <Text style={[styles.title, typography.titleSmall]}>
          {`Delete ${count} video${count === 1 ? "" : "s"}?`}
        </Text>
        <Text style={[styles.body, typography.body]}>
          {`They'll be removed from your downloads and free up ${formatLibraryBytes(combinedBytes)}. You can download them again anytime.`}
        </Text>
        <Pressable
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Delete"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </>
  )
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SCRIM_BG,
    zIndex: 20,
  },
  card: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    zIndex: 21,
    backgroundColor: SURFACE_COLOR,
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    marginBottom: 16,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    textAlign: "center",
    opacity: 0.75,
  },
  deleteButton: {
    marginTop: 20,
    height: 50,
    borderRadius: 15,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 16.5,
    fontWeight: "700",
  },
  cancelButton: {
    marginTop: 8,
    height: 50,
    borderRadius: 15,
    backgroundColor: CANCEL_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16.5,
    fontWeight: "700",
  },
})
