/**
 * The splash cover and the tree it covers.
 *
 * The cover is a layer ABOVE a live app tree, never a gate in front of it
 * (KD1): Home mounts and fetches behind it, so the animation and the network
 * round trip overlap instead of running one after the other. Both components
 * read the SAME visibility predicate, so the cover and the accessibility
 * isolation can never disagree (KTD6).
 */

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { Animated, StyleSheet, View } from "react-native"

import { datadogLog } from "../../lib/datadog"
import { hideNativeSplashOnce } from "../../lib/splash/nativeSplash"
import {
  getSplashSession,
  type SplashSnapshot,
} from "../../lib/splash/splashSession"
import { SplashSequence } from "./SplashSequence"

/** R14: long enough to read as a hand-over, short enough not to feel like one
 *  more wait. It runs AFTER the hold, so it extends it rather than eating it. */
export const SPLASH_EXIT_FADE_MS = 350

/** Grace past the fade before the cover is removed regardless of what the
 *  animation reported. Long enough that it never races a healthy fade. */
export const SPLASH_EXIT_BACKSTOP_MS = 250

function useSplashSnapshot(): SplashSnapshot {
  const session = getSplashSession()
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}

const blockTouches = () => true

/**
 * Everything the cover hides. Android has no accessibility modal, so hiding the
 * descendants is the only way to keep the covered tree out of the accessibility
 * tree (R16). It is a no-op on iOS, where the cover's own modal flag does it.
 */
export function SplashCoveredTree({ children }: { children: ReactNode }) {
  const { visible } = useSplashSnapshot()
  return (
    <View
      style={styles.tree}
      importantForAccessibility={visible ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  )
}

/**
 * The cover is decorative, and it is the only thing in this app whose failure
 * would cost nothing to swallow. Without this boundary a throw inside it
 * reaches the app's ONE boundary and swaps the whole tree for the App Error
 * panel, so a broken animation would take the app down with it.
 */
class SplashBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    // Losing the cover IS the fallback, so nothing renders in its place. Both
    // calls are needed: the native splash outlives the React layer that owned
    // it, and the session still hides the app tree from a screen reader.
    hideNativeSplashOnce()
    try {
      getSplashSession().releaseImmediately()
    } catch {
      // A session that cannot be released must not block the app underneath.
    }
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    try {
      datadogLog.warn("splash_cover_failed", { error_message: error.message })
    } catch {
      // Never let the report be the reason the app tree stays covered.
    }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function SplashHost() {
  return (
    <SplashBoundary>
      <SplashCover />
    </SplashBoundary>
  )
}

function SplashCover() {
  const { resolved, visible, presentation, exit } = useSplashSnapshot()

  const fade = useRef(new Animated.Value(1)).current
  const [painted, setPainted] = useState(false)
  const [gone, setGone] = useState(false)

  const onFirstFrame = useCallback(() => {
    setPainted(true)
    hideNativeSplashOnce()
  }, [])

  // R2: the native splash lets go only once this layer has drawn whatever it
  // will draw. On the skip path it draws nothing, so the resolution itself
  // releases it — a held flat field would cover the destination forever (R6).
  useEffect(() => {
    if (!resolved || visible || painted) return
    hideNativeSplashOnce()
  }, [resolved, visible, painted])

  // R14: the cover cross-fades out, and unmounts only once the fade finishes.
  // The error panels get a cut — nothing may linger over a diagnostic (R5).
  useEffect(() => {
    if (visible || !painted || gone) return
    if (exit === "cut") {
      setGone(true)
      return
    }
    const animation = Animated.timing(fade, {
      toValue: 0,
      duration: SPLASH_EXIT_FADE_MS,
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) setGone(true)
    })
    // The callback is the only latch that unmounts the cover, and an animation
    // that never reports finished would leave an invisible full-screen layer
    // swallowing every touch. Nothing about the cover may depend on one signal.
    const backstop = setTimeout(
      () => setGone(true),
      SPLASH_EXIT_FADE_MS + SPLASH_EXIT_BACKSTOP_MS,
    )
    return () => {
      animation.stop()
      clearTimeout(backstop)
    }
  }, [visible, exit, painted, gone, fade])

  if (gone) return null
  if (!visible && !painted) return null

  return (
    <Animated.View
      testID="splash-host"
      accessibilityViewIsModal
      // Android applies a group's opacity to EACH CHILD unless the subtree is
      // composited offscreen first, so without this the app tree bleeds through
      // the fade and the projector layers blend against one another.
      needsOffscreenAlphaCompositing
      // The tree beneath is live and interactive. Swallow touches, or a stray
      // tap navigates a screen the person cannot see.
      onStartShouldSetResponder={blockTouches}
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
    >
      <SplashSequence
        reduceMotion={presentation === "still"}
        onFirstFrame={onFirstFrame}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tree: {
    flex: 1,
  },
})
