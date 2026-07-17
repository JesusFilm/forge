// Settings screen (D-pad list, WATCH_THEME): Showcase Mode (start action +
// launch-only auto-start toggle) and the app-wide default audio/subtitle
// language pickers. Everything persisted on device.

import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useLanguagePrefs } from "../../contexts/LanguagePrefsContext"
import { languageDisplayName } from "../../contexts/seriesLanguageState"
import { useAllLanguages } from "../../hooks/useAllLanguages"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"
import { scale } from "../../lib/scale"
import { useShowcasePrefs } from "../../lib/showcaseMode/useShowcasePrefs"
import { createFocusMemory, type FocusMemory } from "../home/focusMemory"
import { useFocusVisual } from "../focus/useFocusVisual"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { LanguagePrefPanel } from "./LanguagePrefPanel"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export function SettingsScreen() {
  const router = useRouter()
  const { prefs, hydrated, setAutoStart } = useShowcasePrefs()
  const {
    prefs: langPrefs,
    hydrated: langHydrated,
    setAudioPref,
    setSubtitlePref,
  } = useLanguagePrefs()

  // Which default-language picker is open; the language list loads lazily on
  // first open and stays cached for the session.
  const [activePicker, setActivePicker] = useState<"audio" | "subtitle" | null>(
    null,
  )
  const {
    languages,
    loading: languagesLoading,
    error: languagesError,
    retry: retryLanguages,
  } = useAllLanguages(activePicker != null)

  const closePicker = useCallback(() => setActivePicker(null), [])
  const handleAudioSelect = useCallback(
    (language: WatchChildLanguage | null) => {
      setAudioPref(
        language ? { slug: language.slug, name: language.name } : null,
      )
      setActivePicker(null)
    },
    [setAudioPref],
  )
  const handleSubtitleSelect = useCallback(
    (language: WatchChildLanguage | null) => {
      setSubtitlePref(
        language ? { slug: language.slug, name: language.name } : null,
      )
      setActivePicker(null)
    },
    [setSubtitlePref],
  )

  // tvos#852: a stack pop drops focus to the top-left default. Remember the
  // focused row and re-focus it on re-entry (mirrors Home's focusMemory wiring).
  const focusMemoryRef = useRef<FocusMemory | null>(null)
  if (focusMemoryRef.current == null) {
    focusMemoryRef.current = createFocusMemory()
  }
  const captureFocusedNode = useCallback((node: ViewType | null) => {
    focusMemoryRef.current?.capture(node)
  }, [])

  // Restore only on genuine re-entry — a prior blur proves it; first mount
  // belongs to Start Showcase's hasTVPreferredFocus. rAF defers past the
  // pop's commit so the target node is mounted before we focus it.
  const hasBlurredRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      let raf: number | null = null
      if (hasBlurredRef.current) {
        raf = requestAnimationFrame(() => {
          focusMemoryRef.current?.restore()
        })
      }
      return () => {
        if (raf != null) cancelAnimationFrame(raf)
        hasBlurredRef.current = true
      }
    }, []),
  )

  const handleStartPress = useCallback(() => {
    router.push("/showcase")
  }, [router])

  const handleAutoStartPress = useCallback(() => {
    setAutoStart(!prefs.autoStart)
  }, [prefs.autoStart, setAutoStart])

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Showcase Mode</Text>
        <Text style={styles.sectionNote}>
          Plays films back to back, unattended. Any button on the remote stops
          the reel and brings you back here. Auto-start only runs when the app
          opens — stopping the reel never turns it off.
        </Text>

        <SettingsRow
          testID="settings-start-showcase-row"
          icon="play-circle-outline"
          label="Start Showcase"
          onPress={handleStartPress}
          onFocusNode={captureFocusedNode}
          hasTVPreferredFocus
        />
        <SettingsRow
          testID="settings-auto-start-row"
          icon="power-outline"
          label="Auto-start when the app opens"
          // Until the read resolves, the row would otherwise claim "Off" and a
          // press would write that guess back over a stored On.
          checked={prefs.autoStart}
          disabled={!hydrated}
          onPress={handleAutoStartPress}
          onFocusNode={captureFocusedNode}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Playback Languages</Text>
        <Text style={styles.sectionNote}>
          Every video starts in these languages when they’re available;
          otherwise the app picks automatically. Subtitles stay off unless a
          language is set here or turned on for a video.
        </Text>

        <SettingsRow
          testID="settings-audio-language-row"
          icon="globe-outline"
          label="Audio language"
          value={
            langPrefs.audio ? languageDisplayName(langPrefs.audio) : "Automatic"
          }
          valueActive={langPrefs.audio != null}
          disabled={!langHydrated}
          onPress={() => setActivePicker("audio")}
          onFocusNode={captureFocusedNode}
        />
        <SettingsRow
          testID="settings-subtitle-language-row"
          icon="text-outline"
          label="Subtitle language"
          value={
            langPrefs.subtitle ? languageDisplayName(langPrefs.subtitle) : "Off"
          }
          valueActive={langPrefs.subtitle != null}
          disabled={!langHydrated}
          onPress={() => setActivePicker("subtitle")}
          onFocusNode={captureFocusedNode}
        />
      </View>

      <LanguagePrefPanel
        visible={activePicker === "audio"}
        title="Audio Language"
        subtitle="Videos start in this language when available"
        clearLabel="Automatic"
        languages={languages}
        loading={languagesLoading}
        error={languagesError}
        onRetry={retryLanguages}
        activeSlug={langPrefs.audio?.slug ?? null}
        onSelect={handleAudioSelect}
        onClose={closePicker}
      />
      <LanguagePrefPanel
        visible={activePicker === "subtitle"}
        title="Subtitle Language"
        subtitle="Show subtitles in this language when available"
        clearLabel="Off"
        languages={languages}
        loading={languagesLoading}
        error={languagesError}
        onRetry={retryLanguages}
        activeSlug={langPrefs.subtitle?.slug ?? null}
        onSelect={handleSubtitleSelect}
        onClose={closePicker}
      />
    </View>
  )
}

type SettingsRowProps = {
  /** Stable id for D-pad sim automation (mirrors HomeCard's testID pattern). */
  testID: string
  icon: IconName
  label: string
  /** Toggle row when set (switch role + trailing On/Off); action row otherwise. */
  checked?: boolean
  /** Trailing current-value text on a picker row (mutually exclusive with checked). */
  value?: string
  /** Accent the value at rest (a stored choice, vs the dimmed default). */
  valueActive?: boolean
  /** Inert while prefs hydrate — focusable stays true so the D-pad path is stable. */
  disabled?: boolean
  onPress: () => void
  /** Reports this row's node on focus so the screen can re-focus it after a pop. */
  onFocusNode?: (node: ViewType | null) => void
  hasTVPreferredFocus?: boolean
}

function SettingsRow({
  testID,
  icon,
  label,
  checked,
  value,
  valueActive = false,
  disabled = false,
  onPress,
  onFocusNode,
  hasTVPreferredFocus,
}: SettingsRowProps) {
  // nativeDriver: false — the fill/ink interpolations below are colors, which
  // the native driver cannot animate.
  const { setFocused, progress, transform } = useFocusVisual("option", {
    nativeDriver: false,
  })
  const localRef = useRef<ViewType | null>(null)
  const setRef = useCallback((node: ViewType | null) => {
    localRef.current = node
  }, [])

  const bg = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,1)"],
      }),
    [progress],
  )
  const ink = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const valueInk = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [
          checked === true || valueActive
            ? WATCH_THEME.accent
            : WATCH_THEME.text50,
          WATCH_THEME.focusInk,
        ],
      }),
    [progress, checked, valueActive],
  )
  const animatedRow = useMemo(
    () => ({ backgroundColor: bg, transform }),
    [bg, transform],
  )

  return (
    <Pressable
      ref={setRef}
      onPress={onPress}
      disabled={disabled}
      onFocus={() => {
        setFocused(true)
        onFocusNode?.(localRef.current)
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      testID={testID}
      accessibilityRole={checked == null ? "button" : "switch"}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      accessibilityValue={value != null ? { text: value } : undefined}
    >
      <Animated.View
        style={[styles.row, disabled && styles.rowDisabled, animatedRow]}
      >
        <AnimatedFocusIcon name={icon} progress={progress} size={ICON_SIZE} />
        <Animated.Text style={[styles.rowLabel, { color: ink }]}>
          {label}
        </Animated.Text>
        {checked != null ? (
          <Animated.Text style={[styles.rowValue, { color: valueInk }]}>
            {checked ? "On" : "Off"}
          </Animated.Text>
        ) : value != null ? (
          <Animated.Text
            style={[styles.rowValue, { color: valueInk }]}
            numberOfLines={1}
          >
            {value}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
    paddingHorizontal: scale(80),
    paddingTop: scale(78),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(48)),
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
  section: {
    marginTop: scale(48),
    // Rows bleed past the section's text block by their own padding, so the
    // heading and the resting row labels still share one optical left edge.
    marginHorizontal: -scale(20),
  },
  sectionHeading: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "600",
    color: WATCH_THEME.text82,
    paddingHorizontal: scale(20),
  },
  sectionNote: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "400",
    lineHeight: Math.round(scale(30)),
    color: WATCH_THEME.text50,
    maxWidth: scale(760),
    paddingHorizontal: scale(20),
    marginTop: scale(10),
    marginBottom: scale(22),
  },

  // Design `.menu-item`: gap 16, padding 20, radius 14, transparent at rest.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    height: scale(72),
    paddingHorizontal: scale(20),
    borderRadius: scale(14),
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowLabel: {
    flex: 1,
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "500",
  },
  rowValue: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
    // Long language names truncate rather than crowd the label out.
    maxWidth: scale(420),
  },
})
