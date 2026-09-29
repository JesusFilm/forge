/** /account: the signed-in viewer's identity, Sign out, and Delete account
 *  (R17, App Store 5.1.1(v)). The signed-in My Watch header opens it. */
import { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { SessionReplayView } from "@datadog/mobile-react-native-session-replay"
import { useRouter } from "expo-router"

import { DeleteAccountFlow } from "../src/components/profile/DeleteAccountFlow"
import {
  accountIdentity,
  useAuthSnapshot,
} from "../src/components/profile/accountHooks"
import { ScreenTopBar, leaveToMyWatch } from "../src/components/ui/ScreenTopBar"
import { useMiniPlayerBottomClearance } from "../src/hooks/useMiniPlayerBottomClearance"
import { useTypography } from "../src/hooks/useTypography"
import { signOut } from "../src/lib/authActions"
import type { AuthSessionSnapshot, AuthUser } from "../src/lib/authSession"
import {
  ACCENT,
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../src/lib/color"
import { WINDOW_EDGE_MARGIN } from "../src/lib/miniPlayer/layout"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  feedback,
} from "../src/styles/shared"

/** KTD9: the session reads signed out until the stored session loads, so only
 *  a signed-in to signed-out change leaves. The previous status is state, not
 *  a ref: no effect cleanup touches it, so a StrictMode remount stays correct. */
function useLeaveOnSignOut(status: AuthSessionSnapshot["status"]): boolean {
  const router = useRouter()
  const [previous, setPrevious] = useState(status)
  const [leaving, setLeaving] = useState(false)
  if (status !== previous) {
    setPrevious(status)
    if (previous === "signedIn" && status === "signedOut") setLeaving(true)
  }
  useEffect(() => {
    if (leaving) leaveToMyWatch(router)
  }, [leaving, router])
  return leaving
}

function Identity({ user }: { user: AuthUser }) {
  const typography = useTypography()
  const { name, displayName, initial } = accountIdentity(user)
  const email = user.email

  // Session Replay masks inputs, not rendered text. The name falls back to
  // the email, and the initial comes from the name, so all three mask.
  return (
    <SessionReplayView.MaskAll style={styles.identity}>
      <View style={styles.avatar}>
        {initial ? (
          <Text style={styles.avatarInitial}>{initial}</Text>
        ) : (
          <Ionicons name="person" size={32} color={TEXT_PRIMARY} />
        )}
      </View>
      <View style={styles.identityText}>
        <Text style={[styles.name, typography.titleLarge]} numberOfLines={1}>
          {displayName}
        </Text>
        {name && email ? (
          <Text style={styles.email} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
    </SessionReplayView.MaskAll>
  )
}

function SignOutButton() {
  const typography = useTypography()
  const [signingOut, setSigningOut] = useState(false)
  // Ref guard, not the state: two taps can land off one stale render.
  const flight = useRef(false)

  const handlePress = () => {
    if (flight.current) return
    flight.current = true
    setSigningOut(true)
    // Release on both paths: .finally() would re-throw a rejection unhandled.
    const release = () => {
      flight.current = false
      setSigningOut(false)
    }
    void signOut().then(release, release)
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={signingOut}
      style={({ pressed }) => [
        styles.signOutButton,
        signingOut && styles.signOutBusy,
        pressed && feedback.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      accessibilityState={{ disabled: signingOut, busy: signingOut }}
      {...{ "dd-action-name": "profile-sign-out" }}
    >
      <Text style={[styles.signOutLabel, typography.body]}>
        {signingOut ? "Signing out…" : "Sign out"}
      </Text>
    </Pressable>
  )
}

export default function AccountScreen() {
  const typography = useTypography()
  const snapshot = useAuthSnapshot()
  const leaving = useLeaveOnSignOut(snapshot.status)
  const bottomPad = useMiniPlayerBottomClearance() + WINDOW_EDGE_MARGIN

  return (
    <View style={styles.screen}>
      <ScreenTopBar title="Account" showBack />
      {snapshot.status === "signedIn" ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
        >
          <Identity user={snapshot.user} />
          <View style={styles.actions}>
            <SignOutButton />
            <DeleteAccountFlow />
          </View>
        </ScrollView>
      ) : leaving ? null : (
        <Text style={[styles.notSignedIn, typography.body]}>
          You are not signed in
        </Text>
      )}
    </View>
  )
}

const AVATAR_SIZE = 64

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  content: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT,
  },
  avatarInitial: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 28,
    fontWeight: "700",
  },
  identityText: {
    flex: 1,
  },
  name: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  email: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 15,
    marginTop: 2,
  },
  actions: {
    marginTop: 32,
    gap: 12,
  },
  signOutButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: CARD_BORDER_RADIUS,
    backgroundColor: SURFACE_COLOR,
  },
  signOutBusy: {
    opacity: 0.6,
  },
  signOutLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  notSignedIn: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
  },
})
