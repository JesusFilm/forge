// Profile / sign-in screen (feat-322, WATCH_THEME). Signed-out shows the
// device-authorization UX: QR + user code + waiting state. The GRANT is
// stubbed — apps/auth hasn't enabled its RFC 8628 device plugin yet, so the
// "Approve (demo)" row stands in for the phone approval and Sign in yields
// DEMO_PROFILE. The whole surface is gated by isProfileSurfaceEnabled().
// Screen scaffold (title/section/row + focus-restore) mirrors SettingsScreen.

import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { scale } from "../../lib/scale"
import {
  DEFAULT_USER_CODE_FORMAT,
  USER_CODE_SPECS,
  createPendingSession,
  DEMO_PROFILE,
  type DeviceAuthPhase,
  type UserCodeFormat,
} from "../../lib/auth/deviceAuthFlow"
import {
  loadUserCodeFormat,
  nextUserCodeFormat,
  saveUserCodeFormat,
} from "../../lib/auth/userCodeFormatPreference"
import { createFocusMemory, type FocusMemory } from "../home/focusMemory"
import { useFocusVisual } from "../focus/useFocusVisual"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SignInQr } from "./SignInQr"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const ICON_SIZE = Math.round(scale(26))

export function ProfileScreen() {
  // Both RFC 8628 code formats ship behind a switch so the choice can be made
  // from real screens (see the flow designs). The stored preference is read
  // once on mount; until it lands the screen shows the default format.
  const [codeFormat, setCodeFormat] = useState<UserCodeFormat>(
    DEFAULT_USER_CODE_FORMAT,
  )

  // Entering the screen signed-out starts a sign-in session immediately —
  // the QR is the screen's whole point, so there is no separate "start" press.
  const [phase, setPhase] = useState<DeviceAuthPhase>(() => ({
    kind: "pending",
    session: createPendingSession({ nowMs: Date.now(), random: Math.random }),
  }))

  // Apply the persisted format on mount, re-minting the code so the screen and
  // the preference can't disagree. Skipped when it already matches, so the
  // code doesn't churn on every visit.
  useEffect(() => {
    let cancelled = false
    void loadUserCodeFormat().then((stored) => {
      if (cancelled || stored === DEFAULT_USER_CODE_FORMAT) return
      setCodeFormat(stored)
      setPhase((current) =>
        current.kind === "pending"
          ? {
              kind: "pending",
              session: createPendingSession({
                nowMs: Date.now(),
                random: Math.random,
                format: stored,
              }),
            }
          : current,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  const handleNewCode = useCallback(() => {
    setPhase({
      kind: "pending",
      session: createPendingSession({
        nowMs: Date.now(),
        random: Math.random,
        format: codeFormat,
      }),
    })
  }, [codeFormat])

  // Flip letters <-> numbers, mint a fresh code in the new shape, and persist
  // the choice. Best-effort storage: a write failure still switches the screen.
  const handleToggleCodeFormat = useCallback(() => {
    const next = nextUserCodeFormat(codeFormat)
    setCodeFormat(next)
    setPhase({
      kind: "pending",
      session: createPendingSession({
        nowMs: Date.now(),
        random: Math.random,
        format: next,
      }),
    })
    void saveUserCodeFormat(next)
  }, [codeFormat])

  // Stub for the phone-side approval; replaced by real /device/token polling
  // once the server grant exists (feat-322).
  const handleDemoApprove = useCallback(() => {
    setPhase({ kind: "signedIn", profile: DEMO_PROFILE })
  }, [])

  const handleSignOut = useCallback(() => {
    handleNewCode()
  }, [handleNewCode])

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
            onPress={handleSignOut}
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
              <Text style={styles.userCode} accessibilityLabel="Sign-in code">
                {session.userCode}
              </Text>
              <Text style={styles.status}>
                Waiting for approval on your phone…
              </Text>
            </>
          ) : null}

          <View style={styles.actions}>
            <ProfileRow
              testID="profile-new-code-row"
              icon="refresh-outline"
              label="Get a new code"
              onPress={handleNewCode}
              onFocusNode={captureFocusedNode}
              hasTVPreferredFocus
            />
            {/* Demo-only stand-in for the phone approval — removed when the
                real device grant lands (the surface itself is flag-gated). */}
            <ProfileRow
              testID="profile-demo-approve-row"
              icon="checkmark-circle-outline"
              label="Approve on this device (demo)"
              onPress={handleDemoApprove}
              onFocusNode={captureFocusedNode}
            />
            {/* Pre-ship evaluation switch: both RFC 8628 formats are built so
                the choice is made from real screens. Removed with the losing
                format once the call is made — the format must be identical on
                every platform, forever. */}
            <ProfileRow
              testID="profile-code-format-row"
              icon="swap-horizontal-outline"
              label={`Code style: ${USER_CODE_SPECS[codeFormat].label}`}
              value={USER_CODE_SPECS[nextUserCodeFormat(codeFormat)].sample}
              onPress={handleToggleCodeFormat}
              onFocusNode={captureFocusedNode}
            />
          </View>
        </View>

        {session != null ? (
          <View style={styles.signInRight}>
            <SignInQr url={session.verificationUrl} />
            <Text style={styles.urlText} numberOfLines={1}>
              auth.jesusfilm.org/device
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
