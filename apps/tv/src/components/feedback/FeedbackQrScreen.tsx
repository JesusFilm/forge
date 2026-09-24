import Constants from "expo-constants"
import { useRouter } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { useEffect, useMemo, useState } from "react"
import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import qrcode from "qrcode-generator"

import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { feedbackUrl } from "../../lib/feedbackUrl"
import {
  attestAppleFeedbackGrant,
  attestFeedbackGrant,
} from "../../../modules/tv-feedback-integrity"
import { scale } from "../../lib/scale"
import { NEAR_BLACK, WATCH_THEME } from "../watch/watchDetailTheme"

const SIDE = scale(520)
const CACHE_KEY = "watch-feedback-verified-qr"

type VerifiedQr = {
  feedbackUrl: string
  referenceCode: string
  expiresAt: string
  serverTime: string
}

async function requestJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`feedback_${response.status}`)
  return response.json() as Promise<T>
}

export function FeedbackQrScreen() {
  const router = useRouter()
  const { nativePlayerVariant, androidPlayerVariant } = useWatchPreferences()
  const [verified, setVerified] = useState<VerifiedQr | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const contextUrl = feedbackUrl(process.env.EXPO_PUBLIC_TV_FEEDBACK_URL, {
    platform: Platform.OS === "ios" ? "apple-tv" : "android-tv",
    appVersion: Constants.expoConfig?.version,
    build:
      Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber
        : String(Constants.expoConfig?.android?.versionCode ?? ""),
    screen: "settings",
    player:
      Platform.OS === "ios"
        ? nativePlayerVariant
        : androidPlayerVariant === "native"
          ? "native-android"
          : "react-native",
  })
  const url = verified?.feedbackUrl ?? null

  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_TV_FEEDBACK_URL
    const project = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER
    if (!base || (Platform.OS === "android" && !project)) {
      setLoading(false)
      setError(true)
      return
    }
    let active = true
    const origin = new URL(base).origin
    const load = async () => {
      if (active) {
        setLoading(true)
        setError(false)
      }
      try {
        const cached = await SecureStore.getItemAsync(CACHE_KEY)
        if (cached) {
          const value = JSON.parse(cached) as VerifiedQr
          const secret = new URL(value.feedbackUrl).hash.replace(/^#grant=/, "")
          if (Date.parse(value.expiresAt) > Date.now() && secret) {
            const status = await requestJson<{ active: boolean }>(
              `${origin}/api/feedback/tv/status`,
              { secret },
            )
            if (status.active) {
              if (active) setVerified(value)
              return
            }
          }
        }
        const challenge = await requestJson<{
          challengeId: string
          nonce: string
          utcDay: string
        }>(`${origin}/api/feedback/tv/challenge`, {})
        const attestation =
          Platform.OS === "android"
            ? await attestFeedbackGrant(
                challenge.challengeId,
                challenge.nonce,
                challenge.utcDay,
                project ?? "",
              )
            : await attestAppleFeedbackGrant(
                challenge.challengeId,
                challenge.nonce,
                challenge.utcDay,
              )
        const grant = await requestJson<VerifiedQr>(
          `${origin}/api/feedback/tv/${Platform.OS === "android" ? "grants" : "apple-grants"}`,
          { challengeId: challenge.challengeId, ...attestation },
        )
        if (contextUrl) {
          const link = new URL(grant.feedbackUrl)
          link.search = new URL(contextUrl).search
          grant.feedbackUrl = link.toString()
        }
        await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(grant))
        if (active) setVerified(grant)
      } catch {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [retry])
  useEffect(() => {
    if (!verified) return
    const remaining = Date.parse(verified.expiresAt) - Date.now()
    const timer = setTimeout(
      () => {
        setVerified(null)
        setRetry((value) => value + 1)
      },
      Math.max(1000, remaining),
    )
    return () => clearTimeout(timer)
  }, [verified])
  const qr = useMemo(() => {
    if (!url) return null
    const code = qrcode(0, "L")
    code.addData(url)
    code.make()
    const modules = code.getModuleCount()
    const unit = Math.max(1, Math.floor(SIDE / (modules + 8)))
    return {
      rows: Array.from({ length: modules }, (_, row) =>
        Array.from({ length: modules }, (_, col) => code.isDark(row, col)),
      ),
      unit,
    }
  }, [url])

  return (
    <View style={styles.screen}>
      <Pressable
        testID="feedback-back"
        accessibilityRole="button"
        accessibilityLabel="Back to Settings"
        onPress={() => router.back()}
        hasTVPreferredFocus
        style={styles.back}
      >
        <Text style={styles.backLabel}>‹ Back</Text>
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>WATCH TV · BETA</Text>
        <Text style={styles.title}>Send feedback</Text>
        <Text style={styles.description}>
          Scan with your phone to report a problem, suggest an idea, or share
          what worked well. Add a photo or video if it helps explain what you
          saw.
        </Text>
        {qr ? (
          <>
            <View style={[styles.qr, { padding: qr.unit * 4 }]}>
              {qr.rows.map((row, y) => (
                <View key={y} style={styles.row}>
                  {row.map((dark, x) => (
                    <View
                      key={x}
                      style={{
                        width: qr.unit,
                        height: qr.unit,
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
            onPress={() => setRetry((value) => value + 1)}
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
