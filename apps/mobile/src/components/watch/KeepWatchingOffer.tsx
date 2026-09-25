/**
 * The R17 offer (KTD12): start from the beginning, or resume at a later saved
 * place. The page owns the seek and the hold; this owns the labels and the
 * hide request. The copy is a working choice until product decides.
 */

import { useEffect, useState } from "react"
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BLACK, SURFACE_COLOR, TEXT_PRIMARY, hexToRgba } from "../../lib/color"
import { KEEP_WATCHING_OFFER_DURATION_MS } from "../../lib/explore/watchIntent"
import { feedback } from "../../styles/shared"

export const KEEP_WATCHING_OFFER_COPY = {
  startFromBeginning: "Start from the beginning",
  resumeAt: (time: string) => `Resume at ${time}`,
} as const

/** h:mm:ss from an hour and m:ss below it, the shape AE6 names ("1:10:00"). */
export function formatOfferPosition(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const pad = (n: number) => n.toString().padStart(2, "0")
  const hours = Math.floor(whole / 3600)
  const mins = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${mins}:${pad(secs)}`
}

/**
 * R17: "Resume at" only for a saved place later than the tap point. The
 * caller passes the resume-eligible position, which is already null for a
 * complete video (the 90% rule in `watchProgress/thresholds.ts`).
 */
export function offerResumeSeconds(
  savedSeconds: number | null,
  tapSeconds: number,
): number | null {
  if (savedSeconds == null || savedSeconds <= tapSeconds) return null
  return savedSeconds
}

export type KeepWatchingOfferProps = {
  /** The later saved place, or null to offer the beginning alone. */
  resumeAtSeconds: number | null
  /** True from the first frame. The clock starts the first time it is true. */
  clockStarted: boolean
  /** Draws nothing, but the clock keeps running (fullscreen or casting). */
  hidden: boolean
  /** A choice, as the position to seek to. */
  onChoose: (seconds: number) => void
  /** The time ran out, and no screen reader holds the offer open. */
  onExpire: () => void
}

export function KeepWatchingOffer({
  resumeAtSeconds,
  clockStarted,
  hidden,
  onChoose,
  onExpire,
}: KeepWatchingOfferProps) {
  const insets = useSafeAreaInsets()
  const screenReaderOn = useScreenReaderEnabled()
  // Latched: a pause or a rebuffer after the first frame does not stop the
  // clock, as it does not stop the progress hold's clock.
  const [clockArmed, setClockArmed] = useState(clockStarted)
  if (clockStarted && !clockArmed) setClockArmed(true)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!clockArmed) return
    const timer = setTimeout(
      () => setTimedOut(true),
      KEEP_WATCHING_OFFER_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [clockArmed])

  // PRODUCT.md: auto-hide waits while a screen reader is on. Only the offer
  // waits; the progress hold ends at its own deadline in the adapter.
  useEffect(() => {
    if (timedOut && !screenReaderOn) onExpire()
  }, [timedOut, screenReaderOn, onExpire])

  if (hidden) return null

  const resumeLabel =
    resumeAtSeconds == null
      ? null
      : KEEP_WATCHING_OFFER_COPY.resumeAt(formatOfferPosition(resumeAtSeconds))

  return (
    <View
      style={[styles.card, { bottom: insets.bottom + 16 }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={() => onChoose(0)}
        style={({ pressed }) => [styles.button, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel={KEEP_WATCHING_OFFER_COPY.startFromBeginning}
        {...{ "dd-action-name": "keep-watching-offer-start" }}
      >
        <Text style={styles.label}>
          {KEEP_WATCHING_OFFER_COPY.startFromBeginning}
        </Text>
      </Pressable>
      {resumeAtSeconds != null && resumeLabel != null && (
        <Pressable
          onPress={() => onChoose(resumeAtSeconds)}
          style={({ pressed }) => [styles.button, pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel={resumeLabel}
          {...{ "dd-action-name": "keep-watching-offer-resume" }}
        >
          <Text style={styles.label}>{resumeLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

/** False until the first read lands; an event that comes first wins over it. */
function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let live = true
    let heard = false
    const sub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (value: boolean) => {
        heard = true
        if (live) setEnabled(value)
      },
    )
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (value) => {
        if (live && !heard) setEnabled(value)
      },
      () => {},
    )
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return enabled
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: SURFACE_COLOR,
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  // Neither choice is styled as the default: the default is to keep watching
  // from the tap point, which needs no tap.
  button: {
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(TEXT_PRIMARY, 0.12),
  },
  label: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
})
