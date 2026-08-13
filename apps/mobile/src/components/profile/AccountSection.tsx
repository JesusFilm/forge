import { useRef, useState, useSyncExternalStore } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { SessionReplayView } from "@datadog/mobile-react-native-session-replay"

import { useTypography } from "../../hooks/useTypography"
import { DeleteAccountFlow } from "./DeleteAccountFlow"
import { signInWithHostedPage, signOut } from "../../lib/authActions"
import { SIGN_IN_ERROR_MESSAGE } from "../../lib/authCopy"
import { getAuthSession } from "../../lib/authSession"
import {
  clearNewAccountNotice,
  getNewAccountNotice,
  subscribeToNewAccountNotice,
} from "../../lib/newAccountNotice"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "../../lib/color"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  feedback,
} from "../../styles/shared"

function useNewAccountNotice() {
  return useSyncExternalStore(subscribeToNewAccountNotice, getNewAccountNotice)
}

function useAuthSnapshot() {
  return useSyncExternalStore(
    (onStoreChange) => getAuthSession().subscribe(onStoreChange),
    () => getAuthSession().getSnapshot(),
  )
}

type SignInPhase = "idle" | "busy" | "error"

/**
 * Profile-tab account section: signed-out CTA opening the hosted auth
 * sheet directly (R2); signed-in identity + sign out. Sign-out revokes at
 * auth then clears local state (R4); the progress lifecycle reacts to the
 * session transition (store/snapshot/queue reset).
 */
export function AccountSection() {
  const typography = useTypography()
  const snapshot = useAuthSnapshot()
  const newAccountNotice = useNewAccountNotice()
  const [signingOut, setSigningOut] = useState(false)
  const [signInPhase, setSignInPhase] = useState<SignInPhase>("idle")
  // Ref guard, not the phase: a press can fire twice off one stale render,
  // which a state check alone cannot make a no-op (matches DeleteAccountFlow).
  const signInFlight = useRef(false)

  if (snapshot.status !== "signedIn") {
    const signingIn = signInPhase === "busy"
    return (
      <View style={styles.container}>
        {signInPhase === "error" ? (
          <View style={styles.errorCard}>
            <Ionicons name="warning" size={20} color={WARNING_COLOR} />
            <Text style={styles.errorText}>{SIGN_IN_ERROR_MESSAGE}</Text>
            <Pressable
              onPress={() => setSignInPhase("idle")}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [pressed && feedback.pressed]}
            >
              <Ionicons name="close" size={20} color={TEXT_SECONDARY} />
            </Pressable>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            if (signInFlight.current) return
            signInFlight.current = true
            setSignInPhase("busy")
            // Cancel returns quietly to the idle CTA (R2); success flips the
            // section via the session snapshot. Release on BOTH settlement
            // paths so a rejection can never pin the CTA on "Signing in…".
            void signInWithHostedPage().then(
              (outcome) => {
                signInFlight.current = false
                setSignInPhase(outcome.status === "error" ? "error" : "idle")
              },
              () => {
                signInFlight.current = false
                setSignInPhase("error")
              },
            )
          }}
          disabled={signingIn}
          style={({ pressed }) => [
            styles.signInCta,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          {...{ "dd-action-name": "profile-sign-in" }}
        >
          <Ionicons name="person-circle-outline" size={28} color={ACCENT} />
          <View style={styles.signInTextBlock}>
            <Text style={[styles.signInTitle, typography.titleSmall]}>
              {signingIn ? "Signing in…" : "Sign in"}
            </Text>
            <Text style={styles.signInSubtitle}>
              Keep your place across devices
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={TEXT_SECONDARY} />
        </Pressable>
      </View>
    )
  }

  const displayName =
    snapshot.user.name?.trim() || snapshot.user.email || "Signed in"

  return (
    <View style={styles.container}>
      {newAccountNotice === snapshot.user.id ? (
        // R15. Non-blocking on purpose: an interstitial on every first
        // sign-in was rejected as noise, but an unexplained empty
        // continue-watching row reads as lost history.
        <View style={styles.noticeCard}>
          <Ionicons name="information-circle" size={18} color={ACCENT} />
          <Text style={styles.noticeText}>
            This is a new account, so there is no watch history yet. If you
            expected to see yours, you may have signed in with a different email
            than you use on the web.
          </Text>
          <Pressable
            onPress={clearNewAccountNotice}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss new account notice"
            style={({ pressed }) => [pressed && feedback.pressed]}
          >
            <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.accountCard}>
        <View style={styles.identityRow}>
          <Ionicons name="person-circle" size={36} color={ACCENT} />
          {/* Session Replay masks INPUTS, not rendered text, so without this
              the account email is captured verbatim into recordings — the one
              thing rumUserFromSession deliberately never sends. Wraps both
              lines: displayName falls back to the email when there is no name. */}
          <SessionReplayView.MaskAll style={styles.identityText}>
            <Text
              style={[styles.identityName, typography.titleSmall]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {snapshot.user.email && snapshot.user.name ? (
              <Text style={styles.identityEmail} numberOfLines={1}>
                {snapshot.user.email}
              </Text>
            ) : null}
          </SessionReplayView.MaskAll>
        </View>
        <Pressable
          onPress={() => {
            if (signingOut) return
            setSigningOut(true)
            void signOut().finally(() => setSigningOut(false))
          }}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          {...{ "dd-action-name": "profile-sign-out" }}
        >
          <Text style={styles.signOutLabel}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
        <DeleteAccountFlow />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  noticeText: {
    flex: 1,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
  container: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 24,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
  signInCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  signInTextBlock: {
    flex: 1,
  },
  signInTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  signInSubtitle: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    marginTop: 2,
  },
  accountCard: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 16,
    gap: 14,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  identityText: {
    flex: 1,
  },
  identityName: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  identityEmail: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    marginTop: 2,
  },
  signOutButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  signOutLabel: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
})
