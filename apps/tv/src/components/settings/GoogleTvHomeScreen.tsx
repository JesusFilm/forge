import { useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import {
  getGoogleTvHomeModule,
  type GoogleTvHomeResult,
} from "../../../modules/google-tv-home"
import {
  isGoogleTvContinuationEnabled,
  publishGoogleTvDiscoveryPreview,
  setGoogleTvContinuationEnabled,
} from "../../lib/googleTvHomeSync"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { WATCH_THEME } from "../watch/watchDetailTheme"

export function GoogleTvHomeScreen() {
  const router = useRouter()
  const [result, setResult] = useState<GoogleTvHomeResult | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  async function run(action: () => Promise<GoogleTvHomeResult | undefined>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const response = await action()
      const sharing = await isGoogleTvContinuationEnabled()
      if (mounted.current) {
        setEnabled(sharing)
        setResult(
          response ?? {
            status: "unavailable",
            environment: "production",
            count: 0,
            message: "This feature requires an Android TV native build.",
          },
        )
      }
    } catch {
      if (mounted.current)
        setResult({
          status: "error",
          environment: "production",
          count: 0,
          message: "The update was not confirmed. Please retry.",
        })
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void run(async () => getGoogleTvHomeModule()?.getStatus(true))
    return () => {
      mounted.current = false
    }
  }, [])
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Google TV Home</Text>
      <Text style={styles.description}>
        Continue watching from your TV’s Home screen. Google controls placement
        and availability.
      </Text>
      <Text style={styles.privacy}>
        For adult viewers. Enabling shares unfinished film titles, artwork and
        progress with the system Home screen on this TV only. No cross-device
        history sync or account sign-in is enabled.
      </Text>
      <View style={styles.actions}>
        <FocusableCard
          hasTVPreferredFocus
          style={styles.button}
          accessibilityLabel="I am an adult, enable Continue Watching on this TV"
          onPress={() => {
            void run(() => setGoogleTvContinuationEnabled(true))
          }}
        >
          <Text style={styles.buttonText}>
            {busy
              ? "Please wait…"
              : enabled
                ? "Update Continue Watching"
                : "I’m an adult · Enable on this TV"}
          </Text>
        </FocusableCard>
        <FocusableCard
          style={styles.button}
          accessibilityLabel="Turn off sharing and remove Continue Watching"
          onPress={() => {
            void run(() => setGoogleTvContinuationEnabled(false))
          }}
        >
          <Text style={styles.buttonText}>Turn off and remove</Text>
        </FocusableCard>
      </View>
      <Text style={styles.status}>{result?.message ?? "Checking access…"}</Text>
      <Text style={styles.description}>
        Discovery themes: Cinematic Spotlight · Discover the Collection · A
        Moment of Hope · Choose Your Journey
      </Text>
      <Text style={styles.privacy}>
        Production discovery is paused pending approved identity and Google
        access. Supported films rotate at most daily; Continue Watching stays
        separate.
      </Text>
      {result?.environment === "verification" && (
        <View style={styles.actions}>
          <FocusableCard
            style={styles.button}
            accessibilityLabel="Adult verification only, publish discovery to Google test app"
            onPress={() => {
              void run(publishGoogleTvDiscoveryPreview)
            }}
          >
            <Text style={styles.buttonText}>
              Adult test · Preview discovery
            </Text>
          </FocusableCard>
          <FocusableCard
            style={styles.button}
            accessibilityLabel="Remove verification discovery content"
            onPress={() => {
              void run(async () => getGoogleTvHomeModule()?.remove(false))
            }}
          >
            <Text style={styles.buttonText}>Remove preview</Text>
          </FocusableCard>
        </View>
      )}
      <Text style={styles.privacy}>
        {result?.environment === "verification"
          ? "VERIFICATION BUILD — acceptance in Google’s test app does not prove launcher visibility. Preview sends your recommendation videos and a test-only Google identity, never account tokens."
          : "PRODUCTION SERVICE — Google approval and availability checks apply."}
      </Text>
      <FocusableCard
        style={styles.button}
        accessibilityLabel="Back to Settings"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/settings")
        }
      >
        <Text style={styles.buttonText}>Back</Text>
      </FocusableCard>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WATCH_THEME.below },
  content: {
    paddingHorizontal: scale(110),
    paddingVertical: scale(70),
    gap: scale(25),
  },
  title: { color: WATCH_THEME.text, fontSize: scale(48), fontWeight: "700" },
  description: {
    color: WATCH_THEME.text82,
    fontSize: scale(27),
    lineHeight: scale(38),
  },
  privacy: {
    color: WATCH_THEME.text82,
    fontSize: scale(24),
    lineHeight: scale(34),
  },
  status: {
    color: WATCH_THEME.text,
    fontSize: scale(27),
    lineHeight: scale(38),
  },
  actions: { flexDirection: "row", gap: scale(30) },
  button: {
    minHeight: scale(78),
    paddingHorizontal: scale(30),
    paddingVertical: scale(18),
    borderRadius: scale(14),
    backgroundColor: "#29292d",
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  buttonText: {
    color: WATCH_THEME.text,
    fontSize: scale(25),
    fontWeight: "600",
  },
})
