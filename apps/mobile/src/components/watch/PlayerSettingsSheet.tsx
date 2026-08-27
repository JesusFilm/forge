import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  BG_COLOR,
  BLACK,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { setCastPlaybackRateLogged } from "../../lib/cast/castAdapter"
import {
  PLAYBACK_SPEEDS,
  getPlayerSettingsStore,
  type PlaybackSpeed,
} from "../../lib/miniPlayer/playerSettings"
import {
  QUALITY_TIERS,
  supportsQualityConstraint,
  type QualityTier,
} from "../../lib/streamQuality"
import { feedback } from "../../styles/shared"

function speedLabel(speed: PlaybackSpeed): string {
  return speed === 1 ? "Normal" : `${speed}×`
}

const QUALITY_LABELS: Record<QualityTier, string> = {
  auto: "Auto",
  low: "Low (480p)",
  high: "High (720p)",
  highest: "Highest (1080p)",
}

type SheetBody = "root" | "speed" | "quality"

// The scrim FADES while the panel SLIDES. RN's Modal `animationType="slide"`
// translates its whole subtree, scrim included, which reads as a dark sheet
// dragged up the screen with a hard moving edge instead of the room dimming.
const ENTER_MS = 240
const EXIT_MS = 180

const BODY_TITLES: Record<SheetBody, string> = {
  root: "Settings",
  speed: "Playback speed",
  quality: "Quality",
}

export type PlayerSettingsSheetProps = {
  onClose: () => void
  /** R10: while a cast session is active the sheet offers speed only. */
  castActive: boolean
  /** R9/R11 at the point of use: the quality row exists only for a
   *  constrainable (Mux http(s)) stream — offline file:// and non-Mux hide it. */
  streamingUrl: string | null
}

/** Two-level player settings sheet (R2, KTD5): component-state RN Modal in
 *  the chrome layer, because a routed form sheet cannot present over the
 *  fullscreen player. A pick writes the store; the sheet stays open (R3). */
export function PlayerSettingsSheet({
  onClose,
  castActive,
  streamingUrl,
}: PlayerSettingsSheetProps) {
  const store = getPlayerSettingsStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const insets = useSafeAreaInsets()
  const [body, setBody] = useState<SheetBody>("root")

  // 0 = dismissed, 1 = presented. Drives BOTH the scrim's opacity and the
  // panel's offset, so they share one clock while animating differently.
  const progress = useRef(new Animated.Value(0)).current
  const [panelHeight, setPanelHeight] = useState(0)
  const closingRef = useRef(false)

  // Presenting waits for the panel's measured height: its offset is expressed
  // in points, so animating before the layout lands would slide it the wrong
  // distance. The panel stays parked offscreen until then, one frame at most.
  useEffect(() => {
    if (panelHeight === 0 || closingRef.current) return
    Animated.timing(progress, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [panelHeight, progress])

  // The host unmounts this component on `onClose`, so the exit has to finish
  // BEFORE that call. The timer — not the animation callback — is what fires
  // it: a native-driver completion never arrives under jest, and an animation
  // interrupted on-device would otherwise strand the sheet open forever.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
    closeTimerRef.current = setTimeout(onClose, EXIT_MS)
  }, [onClose, progress])

  // An unmount from any OTHER path (route pop, player handover) would leave the
  // timer above pending and fire onClose into a torn-down tree.
  useEffect(
    () => () => {
      if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current)
    },
    [],
  )

  const qualityAvailable =
    !castActive && supportsQualityConstraint(streamingUrl)

  // Decision 5: a cast flip mid-submenu snaps back to the root list. Adjusted
  // during render (not an effect) so the stale submenu never paints a frame.
  const [prevCastActive, setPrevCastActive] = useState(castActive)
  if (prevCastActive !== castActive) {
    setPrevCastActive(castActive)
    if (body !== "root") setBody("root")
  }
  if (body === "quality" && !qualityAvailable) setBody("root")

  const rootRow = (title: string, value: string, onPress: () => void) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && feedback.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={styles.rowValue}>
        <Text style={styles.rowValueText}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={TEXT_SECONDARY} />
      </View>
    </Pressable>
  )

  const optionRow = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
      style={({ pressed }) => [styles.row, pressed && feedback.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <View style={styles.checkSlot}>
        {selected && (
          <Ionicons name="checkmark" size={18} color={TEXT_PRIMARY} />
        )}
      </View>
      <Text style={styles.rowTitle}>{label}</Text>
    </Pressable>
  )

  let listRows
  if (body === "speed") {
    listRows = PLAYBACK_SPEEDS.map((speed) =>
      optionRow(
        `speed-${speed}`,
        speedLabel(speed),
        snapshot.speed === speed,
        () => {
          // AE4: the store stays the single truth; while casting the pick ALSO
          // goes to the receiver (fire-and-forget, logged in the facade).
          store.setSpeed(speed)
          if (castActive) setCastPlaybackRateLogged(speed)
        },
      ),
    )
  } else if (body === "quality") {
    listRows = QUALITY_TIERS.map((tier) =>
      optionRow(
        `quality-${tier}`,
        QUALITY_LABELS[tier],
        snapshot.qualityTier === tier,
        () => store.setQualityTier(tier),
      ),
    )
  } else {
    listRows = (
      <>
        {rootRow("Playback speed", speedLabel(snapshot.speed), () =>
          setBody("speed"),
        )}
        {qualityAvailable &&
          rootRow("Quality", QUALITY_LABELS[snapshot.qualityTier], () =>
            setBody("quality"),
          )}
      </>
    )
  }

  return (
    <Modal
      visible
      transparent
      // "none": this component owns both animations so they can differ.
      animationType="none"
      statusBarTranslucent
      // Fullscreen locks the app to landscape while the Modal's default is
      // portrait-only; UIKit aborts a presentation with no common orientation.
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[styles.scrim, { opacity: progress }]}
        />
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss settings"
        />
        <Animated.View
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
          style={[
            styles.panel,
            { paddingBottom: Math.max(insets.bottom, 12) },
            {
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    // Parked a full panel-height down until measured, so the
                    // unmeasured first frame is offscreen rather than in place.
                    outputRange: [panelHeight || 9999, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.header}>
            {body !== "root" ? (
              <Pressable
                style={styles.headerButton}
                onPress={() => setBody("root")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
              </Pressable>
            ) : (
              <View style={styles.headerButton} />
            )}
            <Text style={styles.headerTitle}>{BODY_TITLES[body]}</Text>
            <Pressable
              style={styles.headerButton}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={TEXT_PRIMARY} />
            </Pressable>
          </View>
          {listRows}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  // Carries the dimming so its opacity can animate independently of the panel.
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: hexToRgba(BLACK, 0.5),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  // The app's hard-coded dark surface — the sheet must not follow the system
  // appearance the player chrome ignores.
  panel: {
    backgroundColor: BG_COLOR,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowTitle: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
  },
  rowValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowValueText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
  },
  checkSlot: {
    width: 24,
    alignItems: "center",
  },
})
