import { useState, useSyncExternalStore } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import { DeleteAccountFlow } from "./DeleteAccountFlow"
import { signOut } from "../../lib/authActions"
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

/**
 * Profile-tab account section (U6): signed-out CTA opening the sign-in
 * sheet; signed-in identity + sign out. Sign-out revokes at auth then
 * clears local state (R4); the progress lifecycle reacts to the session
 * transition (store/snapshot/queue reset).
 */
export function AccountSection() {
  const typography = useTypography()
  const router = useRouter()
  const snapshot = useAuthSnapshot()
  const newAccountNotice = useNewAccountNotice()
  const [signingOut, setSigningOut] = useState(false)

  if (snapshot.status !== "signedIn") {
    return (
      <View style={styles.container}>
        <Pressable
          onPress={() => router.push("/sign-in")}
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
              Sign in
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
          <View style={styles.identityText}>
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
          </View>
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
