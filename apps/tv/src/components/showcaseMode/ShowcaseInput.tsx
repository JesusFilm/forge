/**
 * The reel's only focusable node: turns deliberate remote presses into one exit (R12).
 * Three sources are needed because no single one sees every press — the global handler
 * never gets tvOS select, and Menu bypasses JS until enableTVMenuKey claims it.
 */

import { useCallback, useEffect, useRef } from "react"
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  // @ts-expect-error TVEventControl is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  TVEventControl,
  // @ts-expect-error useTVEventHandler is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  useTVEventHandler,
} from "react-native"

import {
  classifyRemoteEvent,
  type RemoteEventLike,
} from "../../lib/showcaseMode/exitClassification"
import { TVFocusGuideView } from "../TVFocusGuideView"

type ShowcaseInputProps = {
  /** Must be idempotent: every source below can double-deliver a single press. */
  onExit: () => void
}

export function ShowcaseInput({ onExit }: ShowcaseInputProps) {
  // Native emitters fire outside React's commit, so the handlers below read the
  // callback from a ref and register once instead of re-registering per render.
  const onExitRef = useRef(onExit)
  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  const handleTVEvent = useCallback((event: RemoteEventLike) => {
    if (classifyRemoteEvent(event) === "exit") onExitRef.current()
  }, [])
  useTVEventHandler(handleTVEvent)

  // tvOS routes Menu into 'hardwareBackPress' too, so one subscription covers Menu
  // and Android Back. Returning true consumes it — the reducer owns the exit, and
  // letting the Stack pop as well would double-pop past the origin screen.
  useEffect(() => {
    const handler = () => {
      onExitRef.current()
      return true
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", handler)
    return () => {
      try {
        sub.remove()
      } catch (e) {
        console.error("[ShowcaseInput] BackHandler cleanup failed:", e)
      }
    }
  }, [])

  // Without this claim the Menu key bypasses JS entirely and suspends the app to the
  // tvOS home screen — R12 promises Menu returns to the origin screen instead.
  // Setup restores what cleanup mutates, so a StrictMode remount re-claims.
  const menuKeyEnabledRef = useRef(false)
  useEffect(() => {
    if (!Platform.isTV) return
    try {
      TVEventControl.enableTVMenuKey()
      menuKeyEnabledRef.current = true
    } catch (e) {
      console.error("[ShowcaseInput] enableTVMenuKey failed:", e)
    }
    return () => {
      if (!menuKeyEnabledRef.current) return
      try {
        TVEventControl.disableTVMenuKey()
      } catch (e) {
        console.error("[ShowcaseInput] disableTVMenuKey failed:", e)
      }
      menuKeyEnabledRef.current = false
    }
  }, [])

  const handlePress = useCallback(() => onExitRef.current(), [])

  return (
    // Focus must not escape to the Stack screen still mounted behind the reel, or
    // UIFocusEngine targets its obscured buttons and the press never reaches us.
    <TVFocusGuideView
      style={styles.layer}
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      {/* tvOS never delivers select to the global handler (react-native-tvos#904),
          so the only way to see it is to be the focused view when it lands. */}
      <Pressable
        onPress={handlePress}
        hasTVPreferredFocus
        focusable
        accessibilityLabel="Exit showcase mode"
        accessibilityRole="button"
        collapsable={false}
        style={styles.catcher}
      />
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject },
  catcher: { ...StyleSheet.absoluteFillObject },
})
