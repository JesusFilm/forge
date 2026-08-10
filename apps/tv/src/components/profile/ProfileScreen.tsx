// Profile / sign-in screen (feat-322, WATCH_THEME). Signed-out shows the
// device-authorization UX: QR + user code + waiting state. The whole surface is
// gated by isProfileSurfaceEnabled(). Screen scaffold (title/section/row +
// focus-restore) mirrors SettingsScreen.
//
// This screen owns NO grant logic. Both scaffolds it once carried are gone
// (plan U4.5): the local code minter (the server mints now) and the
// letters/numbers evaluation switch (the format is a server-side decision,
// identical on every platform forever). The phase is supplied by the real
// device-grant wiring — apps/tv has no render harness, so anything decided in
// here would be untestable by construction.

import { useFocusEffect } from "expo-router"
import { useCallback, useMemo, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import {
  displayVerificationUrl,
  type DeviceAuthPhase,
} from "../../lib/auth/deviceAuthFlow"
import { createFocusMemory, type FocusMemory } from "../home/focusMemory"
import { useFocusVisual } from "../focus/useFocusVisual"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SignInQr } from "./SignInQr"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export type ProfileScreenProps = {
  /** Supplied by the device-grant wiring. Defaults to signed-out so the screen
   *  renders standalone; it never mints a session itself. */
  phase?: DeviceAuthPhase
  /** R6: an expired or stale code is replaced in place. */
  onRequestNewCode?: () => void
  onSignOut?: () => void
}

export function ProfileScreen({
  phase = { kind: "signedOut" },
  onRequestNewCode,
  onSignOut,
}: ProfileScreenProps = {}) {
  // tvos#852: a stack pop drops focus to the top-left default. Remember the
  // focused row and re-focus it on re-entry (mirrors SettingsScreen's wiring).
  const focusMemoryRef = useRef<FocusMemory | null>(null)
  if (focusMemoryRef.current == null) {
    focusMemoryRef.current = createFocusMemory()
  }
  const captureFocusedNode = useCallback((node: ViewType | null) => {
    focusMemoryRef.current?.capture(node)
  }, [])
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

  if (phase.kind === "signedIn") {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Account</Text>
          <Text style={styles.sectionNote}>
            Signed in on this TV. Your watch experience will sync with your
            Jesus Film account.
          </Text>

          <ProfileRow
            testID="profile-name-row"
            icon="person-outline"
            label={phase.profile.name}
            value="Name"
            onFocusNode={captureFocusedNode}
            hasTVPreferredFocus
          />
          <ProfileRow
            testID="profile-email-row"
            icon="mail-outline"
            label={phase.profile.email}
            value="Email"
            onFocusNode={captureFocusedNode}
          />
          <ProfileRow
            testID="profile-sign-out-row"
            icon="log-out-outline"
            label="Sign out"
            onPress={onSignOut}
            onFocusNode={captureFocusedNode}
          />
        </View>
      </View>
    )
  }

  const session = phase.kind === "pending" ? phase.session : null

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Sign in</Text>

      <View style={styles.signInBody}>
        <View style={styles.signInLeft}>
          <Text style={styles.sectionNote}>
            Scan the code with your phone camera and approve this TV, or visit
            the address below and enter the code. New sign-ups can create an
            account on the same page.
          </Text>

          {session != null ? (
            <>
              {/* accessibilityLabel is generic on purpose: RUM taps action
                  names from it, and the code must never become telemetry. */}
              <Text style={styles.userCode} accessibilityLabel="Sign-in code">
                {session.userCode}
              </Text>
              <Text style={styles.status}>
                Waiting for approval on your phone…
              </Text>
            </>
          ) : (
            <Text style={styles.status}>Preparing your sign-in code…</Text>
          )}

          <View style={styles.actions}>
            <ProfileRow
              testID="profile-new-code-row"
              icon="refresh-outline"
              label="Get a new code"
              onPress={onRequestNewCode}
              onFocusNode={captureFocusedNode}
              hasTVPreferredFocus
            />
          </View>
        </View>

        {session != null ? (
          <View style={styles.signInRight}>
            <SignInQr url={session.verificationUrl} />
            <Text style={styles.urlText} numberOfLines={1}>
              {displayVerificationUrl(session.verificationUrl)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

type ProfileRowProps = {
  /** Stable id for D-pad sim automation (mirrors SettingsScreen's pattern). */
  testID: string
  icon: IconName
  label: string
  /** Trailing dim caption (e.g. "Name" / "Email") for display rows. */
  value?: string
  /** Omitted = display-only row (still focusable for D-pad continuity). */
  onPress?: () => void
  onFocusNode?: (node: ViewType | null) => void
  hasTVPreferredFocus?: boolean
}

function ProfileRow({
  testID,
  icon,
  label,
  value,
  onPress,
  onFocusNode,
  hasTVPreferredFocus,
}: ProfileRowProps) {
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
        outputRange: [WATCH_THEME.text50, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const animatedRow = useMemo(
    () => ({ backgroundColor: bg, transform }),
    [bg, transform],
  )

  return (
    <Pressable
      ref={setRef}
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocusNode?.(localRef.current)
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value != null ? `${value}: ${label}` : label}
    >
      <Animated.View style={[styles.row, animatedRow]}>
        <AnimatedFocusIcon name={icon} progress={progress} size={ICON_SIZE} />
        <Animated.Text
          style={[styles.rowLabel, { color: ink }]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
        {value != null ? (
          <Animated.Text style={[styles.rowValue, { color: valueInk }]}>
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

  // ── Signed-out: copy + code + actions left, QR right ────────────────
  signInBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: scale(96),
    marginTop: scale(48),
  },
  signInLeft: {
    flex: 1,
    maxWidth: scale(820),
    // Same optical-edge trick as `section`: content carries 20 padding, rows
    // bleed their focus fill 20 past it.
    marginLeft: -scale(20),
  },
  signInRight: {
    alignItems: "center",
  },
  userCode: {
    fontFamily: "System",
    fontSize: Math.round(scale(72)),
    fontWeight: "800",
    letterSpacing: scale(6),
    color: WATCH_THEME.text,
    marginTop: scale(36),
    paddingHorizontal: scale(20),
    fontVariant: ["tabular-nums"],
  },
  status: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "500",
    color: WATCH_THEME.text62,
    marginTop: scale(14),
    paddingHorizontal: scale(20),
  },
  actions: {
    marginTop: scale(40),
  },
  urlText: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
    color: WATCH_THEME.text74,
    marginTop: scale(20),
  },

  // ── Signed-in: settings-style section ───────────────────────────────
  section: {
    marginTop: scale(48),
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

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    height: scale(72),
    paddingHorizontal: scale(20),
    borderRadius: scale(14),
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
  },
})
