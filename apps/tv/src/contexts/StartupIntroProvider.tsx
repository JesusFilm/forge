import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native"
import { useVideoPlayer } from "expo-video"

import { TVFocusGuideView } from "../components/TVFocusGuideView"
import { LogoAnimation } from "../components/LogoAnimation"
import { useWatchPreferences } from "./WatchPreferencesProvider"
import {
  createStartupIntroSession,
  STARTUP_INTRO_TIMEOUT_MS,
} from "../lib/startupIntro"

// Process-local: navigation, provider remounts and warm resumes do not re-arm it.
const launchIntro = createStartupIntroSession()
const StartupIntroContext = createContext(false)

export const useStartupIntroActive = () => useContext(StartupIntroContext)

export function StartupIntroProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(
    () => Platform.isTV && launchIntro.isActive(),
  )
  const onFinished = useCallback(() => setActive(false), [])

  return (
    <StartupIntroContext.Provider value={active}>
      <View style={styles.root}>
        <View
          style={styles.root}
          pointerEvents={active ? "none" : "auto"}
          accessibilityElementsHidden={active}
          importantForAccessibility={active ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        {active && <StartupIntro onFinished={onFinished} />}
      </View>
    </StartupIntroContext.Provider>
  )
}

function StartupIntro({ onFinished }: { onFinished: () => void }) {
  const { startupAnimationId, hydrated } = useWatchPreferences()
  const player = useVideoPlayer(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../assets/startup-audio-logo.wav"),
    (p) => {
      p.loop = false
      p.audioMixingMode = "doNotMix"
    },
  )
  const finish = useCallback(() => {
    if (launchIntro.finish(() => player.pause())) onFinished()
  }, [player, onFinished])

  useEffect(() => {
    if (!hydrated) return
    const ended = player.addListener("playToEnd", finish)
    const status = player.addListener("statusChange", ({ status }) => {
      if (status === "error") finish()
    })
    const lifecycle = AppState.addEventListener("change", (state) => {
      if (state === "background") finish()
    })
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      finish()
      return true
    })
    const timeout = setTimeout(finish, STARTUP_INTRO_TIMEOUT_MS)
    if (player.status === "error" || AppState.currentState === "background")
      finish()
    else player.play()
    return () => {
      clearTimeout(timeout)
      ended.remove()
      status.remove()
      lifecycle.remove()
      back.remove()
      try {
        player.pause()
      } catch {
        // Expo may release its shared player before this cleanup runs.
      }
    }
  }, [hydrated, player, finish])

  return (
    <TVFocusGuideView
      style={styles.overlay}
      autoFocus
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      <Pressable
        style={styles.skip}
        hasTVPreferredFocus
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel="Skip Watch intro"
      >
        <LogoAnimation id={startupAnimationId} active={hydrated} startup />
      </Pressable>
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#161311",
    zIndex: 1000,
  },
  skip: { flex: 1, alignItems: "center", justifyContent: "center" },
})
