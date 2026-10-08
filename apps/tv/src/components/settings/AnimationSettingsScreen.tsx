import { useFocusEffect, usePathname, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TVEventControl,
  View,
} from "react-native"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import {
  LOGO_ANIMATIONS,
  LOGO_PREVIEW_DURATION_MS,
  type LogoAnimationId,
} from "../../lib/logoAnimations"
import { scale } from "../../lib/scale"
import { LogoAnimation } from "../LogoAnimation"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SettingsRow } from "./SettingsScreen"

export function AnimationSettingsScreen() {
  const router = useRouter()
  const focused = usePathname() === "/settings/animations"
  const {
    startupAnimationId,
    loadingAnimationId,
    setStartupAnimationId,
    setLoadingAnimationId,
    restartAppForPreview,
    hydrated,
  } = useWatchPreferences()
  const [target, setTarget] = useState<"startup" | "loading">("startup")
  const [previewRevision, setPreviewRevision] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
  const selected =
    target === "startup" ? startupAnimationId : loadingAnimationId
  const option = LOGO_ANIMATIONS.find((item) => item.id === selected)!
  const leaveAnimations = useCallback(() => {
    setPreviewing(false)
    setPreviewRevision(0)
    router.dismissTo("/settings")
  }, [router])
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener("hardwareBackPress", () => {
        leaveAnimations()
        return true
      })
      if (Platform.OS === "ios" && Platform.isTV)
        TVEventControl.enableTVMenuKey()
      return () => {
        back.remove()
        if (Platform.OS === "ios" && Platform.isTV)
          TVEventControl.disableTVMenuKey()
      }
    }, [leaveAnimations]),
  )
  useEffect(() => {
    setPreviewing(false)
    if (!focused || previewRevision === 0) return
    setPreviewing(true)
    const timer = setTimeout(
      () => setPreviewing(false),
      LOGO_PREVIEW_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [previewRevision, selected, target, focused])
  const choose = (id: LogoAnimationId) => {
    if (target === "startup") setStartupAnimationId(id)
    else setLoadingAnimationId(id)
    setPreviewRevision((revision) => revision + 1)
  }
  const restart = async () => {
    setRestartFailed(false)
    setRestarting(true)
    try {
      await restartAppForPreview()
    } catch {
      setRestartFailed(true)
    } finally {
      setRestarting(false)
    }
  }
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Animations</Text>
      <View style={styles.columns}>
        <ScrollView style={styles.options} contentContainerStyle={styles.list}>
          <SettingsRow
            testID="animations-back"
            icon="chevron-back"
            label="Back to Settings"
            onPress={leaveAnimations}
          />
          <SettingsRow
            testID="animations-startup"
            icon="play-outline"
            label="Startup"
            selected={target === "startup"}
            onPress={() => {
              setTarget("startup")
              setPreviewRevision(0)
            }}
            hasTVPreferredFocus
          />
          <SettingsRow
            testID="animations-loading"
            icon="hourglass-outline"
            label="Loading"
            selected={target === "loading"}
            onPress={() => {
              setTarget("loading")
              setPreviewRevision(0)
            }}
          />
          <Text style={styles.label}>
            {target === "startup" ? "Startup effect" : "Loading effect"}
          </Text>
          {LOGO_ANIMATIONS.map((item) => (
            <SettingsRow
              key={item.id}
              testID={`animation-${target}-${item.id}`}
              icon="sparkles-outline"
              label={`${item.id}  ${item.name}`}
              selected={selected === item.id}
              disabled={!hydrated}
              onPress={() => choose(item.id)}
            />
          ))}
        </ScrollView>
        <TVFocusGuideView style={styles.preview} autoFocus>
          <Text style={styles.label}>
            {target === "startup" ? "Startup preview" : "Loading preview"}
          </Text>
          <LogoAnimation
            key={`${target}-${selected}-${previewRevision}`}
            id={selected}
            active={focused && previewing}
            size={480}
          />
          <Text style={styles.name}>
            {option.id} · {option.name}
          </Text>
          <Text style={styles.note}>
            {previewing
              ? "Playing silent preview…"
              : "Select an effect to save and preview it."}
          </Text>
          <View style={styles.actions}>
            <SettingsRow
              testID="animations-preview"
              icon="play-circle-outline"
              label="Preview again"
              disabled={!hydrated}
              onPress={() => setPreviewRevision((revision) => revision + 1)}
            />
            {target === "startup" && (
              <SettingsRow
                testID="animations-restart"
                icon="refresh-outline"
                label={restarting ? "Restarting…" : "Restart app & preview"}
                disabled={!hydrated || restarting}
                onPress={() => void restart()}
              />
            )}
          </View>
          {restartFailed && (
            <Text style={styles.error}>
              Could not restart Watch. Please try again.
            </Text>
          )}
          <Text style={styles.note}>
            Startup plays once on a fresh launch.{"\n"}Loading plays only while
            work is pending.
          </Text>
        </TVFocusGuideView>
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: scale(60),
    paddingHorizontal: scale(70),
    backgroundColor: WATCH_THEME.below,
  },
  title: {
    fontSize: Math.round(scale(44)),
    color: WATCH_THEME.text,
    fontWeight: "700",
    marginBottom: scale(24),
  },
  columns: { flex: 1, flexDirection: "row", gap: scale(65) },
  options: { flex: 1 },
  list: { paddingBottom: scale(80) },
  preview: { flex: 1, alignItems: "center", paddingTop: scale(30) },
  actions: { width: "100%", maxWidth: scale(650) },
  error: {
    color: WATCH_THEME.accent,
    fontSize: Math.round(scale(21)),
    marginTop: scale(16),
  },
  label: {
    fontSize: Math.round(scale(25)),
    color: WATCH_THEME.text82,
    marginTop: scale(18),
    marginBottom: scale(12),
  },
  name: {
    fontSize: Math.round(scale(28)),
    color: WATCH_THEME.text,
    fontWeight: "600",
  },
  note: {
    fontSize: Math.round(scale(21)),
    color: WATCH_THEME.text62,
    textAlign: "center",
    marginVertical: scale(24),
    lineHeight: Math.round(scale(31)),
  },
})
