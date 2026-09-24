import { useLocalSearchParams, useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { NEAR_BLACK, WATCH_THEME } from "../watch/watchDetailTheme"
import { useFeedbackQr } from "./useFeedbackQr"

const SIDE = scale(520)
export function FeedbackQrScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    screen?: string
    player?: string
    filmTitle?: string
    timestamp?: string
  }>()
  const { verified, loading, error, url, qr, retry } = useFeedbackQr(true, {
    screen: params.screen ?? "settings",
    player: params.player,
    filmTitle: params.filmTitle,
    timestamp: params.timestamp,
  })
  const unit = qr ? Math.max(1, Math.floor(SIDE / (qr.modules + 8))) : 1

  return (
    <View style={styles.screen}>
      <Pressable
        testID="feedback-back"
        accessibilityRole="button"
        accessibilityLabel="Back to previous screen"
        onPress={() => router.back()}
        hasTVPreferredFocus
        style={styles.back}
      >
        <Text style={styles.backLabel}>‹ Back</Text>
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>WATCH TV · BETA</Text>
        <Text style={styles.title}>The beta testing</Text>
        <Text style={styles.description}>
          Scan with your phone to report a problem, suggest an idea, or share
          what worked well. Add a photo or video if it helps explain what you
          saw.
        </Text>
        {qr ? (
          <>
            <View style={[styles.qr, { padding: unit * 4 }]}>
              {qr.rows.map((row, y) => (
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
            <Text style={styles.url}>{url?.split("#")[0]}</Text>
            {verified ? (
              <Text style={styles.reference}>
                Reference {verified.referenceCode} · Expires{" "}
                {new Date(verified.expiresAt).toLocaleString()}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.url}>
            {loading
              ? "Verifying this TV…"
              : error
                ? "Verified feedback is unavailable. Please try again later."
                : "Feedback is not available in this build."}
          </Text>
        )}
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: NEAR_BLACK,
    paddingHorizontal: scale(80),
    paddingTop: scale(56),
  },
  back: {
    alignSelf: "flex-start",
    borderRadius: scale(13),
    paddingVertical: scale(14),
    paddingHorizontal: scale(23),
    backgroundColor: "#2b2929",
  },
  backLabel: {
    color: "#fff",
    fontSize: Math.round(scale(24)),
    fontWeight: "700",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: scale(40),
  },
  eyebrow: {
    color: WATCH_THEME.accent,
    fontWeight: "800",
    fontSize: Math.round(scale(20)),
    letterSpacing: scale(3),
  },
  title: {
    color: "#fff",
    fontSize: Math.round(scale(54)),
    fontWeight: "800",
    marginTop: scale(13),
  },
  description: {
    color: "#c5c0bf",
    textAlign: "center",
    maxWidth: scale(840),
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(37)),
    marginTop: scale(16),
    marginBottom: scale(34),
  },
  qr: { backgroundColor: "#fff", borderRadius: scale(15) },
  row: { flexDirection: "row" },
  url: {
    color: "#fff",
    fontSize: Math.round(scale(23)),
    fontWeight: "700",
    marginTop: scale(23),
    maxWidth: scale(1000),
    textAlign: "center",
  },
  reference: {
    color: "#c5c0bf",
    fontSize: Math.round(scale(20)),
    marginTop: scale(12),
  },
  retry: {
    marginTop: scale(25),
    paddingHorizontal: scale(22),
    paddingVertical: scale(14),
    backgroundColor: "#333",
    borderRadius: scale(12),
  },
  retryText: {
    color: "#fff",
    fontSize: Math.round(scale(22)),
    fontWeight: "700",
  },
})
