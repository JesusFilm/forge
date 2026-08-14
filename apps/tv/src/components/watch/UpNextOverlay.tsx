// Up Next countdown, shown when playback reaches the end and a next episode
// exists — the couch-binge staple. Owns its own ticking timer; the HOST owns
// what "play" and "cancel" do (navigation lives with the route, not here).
//
// Focus: "Play now" takes preferred focus so a bare Select continues the
// binge; "Not now" dismisses to wherever the normal end-of-playback path
// goes. Both rows stay focusable in every state — never trap the viewer.

import { useEffect, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { TVFocusGuideView } from "../TVFocusGuideView"
import { hexToRgba } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

/** Long enough to read the title, short enough that the couch never waits.
 *  Netflix sits at ~5–10s; the low end punishes remote-fumbling. */
export const UP_NEXT_COUNTDOWN_SECONDS = 8

export function UpNextOverlay({
  title,
  onPlayNow,
  onCancel,
}: {
  title: string | null
  /** Fires on Select of "Play now" AND on countdown expiry. */
  onPlayNow: () => void
  /** Fires on "Not now" — the host runs its normal end-of-playback path. */
  onCancel: () => void
}) {
  const [remaining, setRemaining] = useState(UP_NEXT_COUNTDOWN_SECONDS)

  // The expiry callback rides a ref so the 1Hz interval never re-registers
  // (re-registering resets the cadence and can skip a tick under load).
  const onPlayNowRef = useRef(onPlayNow)
  onPlayNowRef.current = onPlayNow
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          clearInterval(id)
          onPlayNowRef.current()
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <View style={styles.scrim}>
      <TVFocusGuideView
        autoFocus
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        style={watchMenuStyles.panel}
      >
        <Text style={styles.kicker}>Up next in {remaining}…</Text>
        {title != null ? (
          <Text
            style={watchMenuStyles.title}
            numberOfLines={2}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : null}
        <WatchOptionRow
          icon="play"
          label="Play now"
          selected
          hasTVPreferredFocus
          onPress={onPlayNow}
          accessibilityLabel={title != null ? `Play ${title} now` : "Play now"}
        />
        <WatchOptionRow
          icon="close"
          label="Not now"
          onPress={onCancel}
          accessibilityLabel="Not now"
        />
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Above the player chrome, below nothing — same layer approach as the
  // in-player menu scrim, dimmer because the video underneath has ended.
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: hexToRgba("#000000", 0.7),
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  kicker: {
    color: "rgba(255,255,255,0.65)",
    fontFamily: "System",
    fontSize: scale(14),
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: scale(20),
    paddingTop: scale(16),
  },
})
