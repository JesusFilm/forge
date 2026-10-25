import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import type { useFeedbackQr } from "./useFeedbackQr"

type FeedbackState = ReturnType<typeof useFeedbackQr>

export function FeedbackQrOverlay({
  feedback,
  onClose,
}: {
  feedback: FeedbackState
  onClose: () => void
}) {
  const [backFocused, setBackFocused] = useState(false)
  const [retryFocused, setRetryFocused] = useState(false)
  const unit = feedback.qr
    ? Math.max(1, Math.floor(scale(390) / (feedback.qr.modules + 8)))
    : 1
  return (
    <TVFocusGuideView
      autoFocus
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      style={styles.overlay}
    >
      <Pressable
        onPress={onClose}
        onFocus={() => setBackFocused(true)}
        onBlur={() => setBackFocused(false)}
        hasTVPreferredFocus
        accessibilityRole="button"
        accessibilityLabel="Back to player"
        style={[styles.back, backFocused && styles.focused]}
      >
        <Text style={[styles.backText, backFocused && styles.focusedText]}>
          ‹ Back
        </Text>
      </Pressable>
      <View style={styles.body}>
        <View style={styles.copy}>
          <Text style={styles.kicker}>WATCH TV · BETA</Text>
          <Text style={styles.title}>The beta testing</Text>
          <Text style={styles.description}>
            {feedback.error
              ? "Verified feedback is unavailable. Please try again."
              : feedback.loading || !feedback.qr
                ? "Verifying this TV…"
                : "Scan with your phone to report an issue or share an idea."}
          </Text>
          {feedback.error ? (
            <Pressable
              onPress={feedback.retry}
              onFocus={() => setRetryFocused(true)}
              onBlur={() => setRetryFocused(false)}
              style={[styles.retry, retryFocused && styles.focused]}
            >
              <Text
                style={[styles.backText, retryFocused && styles.focusedText]}
              >
                Try again
              </Text>
            </Pressable>
          ) : null}
        </View>
        {feedback.qr ? (
          <View>
            <View style={[styles.qr, { padding: unit * 4 }]}>
              {feedback.qr.rows.map((row, y) => (
                <View key={y} style={styles.row}>
                  {row.map((dark, x) => (
                    <View
                      key={x}
                      style={{
                        width: unit,
                        height: unit,
                        backgroundColor: dark ? "#000" : "#fff",
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
            <Text style={styles.reference}>
              Reference {feedback.verified?.referenceCode}
            </Text>
          </View>
        ) : null}
      </View>
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    backgroundColor: "#08080a",
    padding: scale(64),
  },
  back: {
    alignSelf: "flex-start",
    paddingVertical: scale(18),
    paddingHorizontal: scale(26),
    borderRadius: scale(14),
    backgroundColor: WATCH_THEME.pillGlass,
  },
  backText: {
    color: "#fff",
    fontSize: Math.round(scale(25)),
    fontWeight: "700",
  },
  focused: { backgroundColor: WATCH_THEME.focusFill },
  focusedText: { color: WATCH_THEME.focusInk },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  copy: { width: "49%" },
  kicker: {
    color: WATCH_THEME.accent,
    fontSize: Math.round(scale(20)),
    fontWeight: "800",
  },
  title: {
    color: "#fff",
    fontSize: Math.round(scale(52)),
    fontWeight: "800",
    marginTop: scale(14),
  },
  description: {
    color: "#ccc",
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(37)),
    marginTop: scale(19),
  },
  retry: {
    alignSelf: "flex-start",
    padding: scale(16),
    marginTop: scale(24),
    backgroundColor: "#333",
    borderRadius: scale(12),
  },
  qr: { backgroundColor: "#fff", borderRadius: scale(14) },
  row: { flexDirection: "row" },
  reference: {
    color: "#ccc",
    fontSize: Math.round(scale(20)),
    textAlign: "center",
    marginTop: scale(18),
  },
})
