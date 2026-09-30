import { useRef, useState, type ComponentProps } from "react"
import { Pressable, StyleSheet, Text, View, type TextStyle } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { SessionReplayView } from "@datadog/mobile-react-native-session-replay"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import {
  accountIdentity,
  useAccountDeletedNotice,
  useAuthSnapshot,
  useNewAccountNotice,
} from "./accountHooks"
import { clearAccountDeletedNotice } from "../../lib/accountDeletedNotice"
import { signInWithHostedPage } from "../../lib/authActions"
import { SIGN_IN_ERROR_MESSAGE } from "../../lib/authCopy"
import { clearNewAccountNotice } from "../../lib/newAccountNotice"
import { isSignInAvailable } from "../../lib/signInGate"
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

type SignInPhase = "idle" | "busy" | "error"

type IconName = ComponentProps<typeof Ionicons>["name"]

const NEW_ACCOUNT_MESSAGE =
  "This is a new account, so there is no watch history yet. If you expected to see yours, you may have signed in with a different email than you use on the web."
const ACCOUNT_DELETED_MESSAGE = "Your account was deleted."

function NoticeCard({
  icon,
  iconColor,
  message,
  tone,
  dismissLabel,
  onDismiss,
}: {
  icon: IconName
  iconColor: string
  message: string
  tone: "error" | "info"
  dismissLabel: string
  onDismiss: () => void
}) {
  const typography = useTypography()
  return (
    <View style={styles.noticeCard}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text
        style={[
          styles.noticeText,
          typography.caption,
          tone === "error" ? styles.noticeTextError : null,
        ]}
      >
        {message}
      </Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={13}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        style={({ pressed }) => [pressed && feedback.pressed]}
      >
        <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
      </Pressable>
    </View>
  )
}

function GuestIdentity({ nameSize }: { nameSize: TextStyle }) {
  return (
    <View style={styles.identity}>
      <View style={[styles.avatar, styles.guestAvatar]}>
        <Ionicons name="person" size={34} color={TEXT_SECONDARY} />
      </View>
      <Text style={[styles.name, nameSize]} numberOfLines={1}>
        Guest
      </Text>
    </View>
  )
}

/** The My Watch identity header: a centered avatar over the name. Guest adds
 *  the sign-in card when signed out. A tap on the signed-in name opens the
 *  Account screen, which holds Sign out and Delete account. */
export function MyWatchHeader() {
  const typography = useTypography()
  const router = useRouter()
  const snapshot = useAuthSnapshot()
  const newAccountNotice = useNewAccountNotice()
  const accountDeleted = useAccountDeletedNotice()
  const [signInPhase, setSignInPhase] = useState<SignInPhase>("idle")
  // Ref guard, not the phase: a press can fire twice off one stale render,
  // which a state check alone cannot make a no-op (matches DeleteAccountFlow).
  const signInFlight = useRef(false)

  if (snapshot.status !== "signedIn") {
    const deletedNotice = accountDeleted ? (
      <NoticeCard
        icon="checkmark-circle"
        iconColor={TEXT_SECONDARY}
        message={ACCOUNT_DELETED_MESSAGE}
        tone="info"
        dismissLabel="Dismiss account deleted notice"
        onDismiss={clearAccountDeletedNotice}
      />
    ) : null

    if (!isSignInAvailable()) {
      // feat-543: while the gate is closed, the card is disabled and has no
      // handler. The label carries the subtitle: a label hides child text
      // from a screen reader, and a user can switch hints off.
      return (
        <View style={styles.container}>
          <GuestIdentity nameSize={typography.titleLarge} />
          <Pressable
            disabled
            style={styles.signInCard}
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Sign in, coming soon, Accounts are not available yet"
          >
            <View style={styles.signInTextBlock}>
              <Text
                style={[
                  styles.signInTitle,
                  typography.titleSmall,
                  styles.signInDimmed,
                ]}
              >
                Sign in · coming soon
              </Text>
              <Text style={[styles.signInSubtitle, typography.caption]}>
                Accounts are not available yet
              </Text>
            </View>
          </Pressable>
          {deletedNotice}
        </View>
      )
    }

    const signingIn = signInPhase === "busy"
    return (
      <View style={styles.container}>
        <GuestIdentity nameSize={typography.titleLarge} />
        <Pressable
          onPress={() => {
            if (signInFlight.current) return
            signInFlight.current = true
            setSignInPhase("busy")
            // Cancel returns quietly to the idle card (R2); success flips the
            // header via the session snapshot. Release on BOTH settlement
            // paths so a rejection can never pin the card on "Signing in…".
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
            styles.signInCard,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          {...{ "dd-action-name": "profile-sign-in" }}
        >
          <View style={styles.signInTextBlock}>
            <Text style={[styles.signInTitle, typography.titleSmall]}>
              {signingIn ? "Signing in…" : "Sign in"}
            </Text>
            <Text style={[styles.signInSubtitle, typography.caption]}>
              Keep your place across devices
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={TEXT_SECONDARY} />
        </Pressable>
        {signInPhase === "error" ? (
          <NoticeCard
            icon="warning"
            iconColor={WARNING_COLOR}
            message={SIGN_IN_ERROR_MESSAGE}
            tone="error"
            dismissLabel="Dismiss"
            onDismiss={() => setSignInPhase("idle")}
          />
        ) : null}
        {deletedNotice}
      </View>
    )
  }

  const { displayName, initial } = accountIdentity(snapshot.user)

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => router.navigate("/account")}
        style={({ pressed }) => [
          styles.accountTarget,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Account"
        {...{ "dd-action-name": "my-watch-account" }}
      >
        {/* Session Replay masks inputs, not rendered text. The name falls back
            to the email, and the initial comes from the name, so both mask. */}
        <SessionReplayView.MaskAll style={styles.identity}>
          <View style={[styles.avatar, styles.accountAvatar]}>
            {/* The circle has a fixed size, so the initial must not grow out of it. */}
            {initial ? (
              <Text
                allowFontScaling={false}
                style={[styles.avatarInitial, typography.headingScale.h2]}
              >
                {initial}
              </Text>
            ) : (
              <Ionicons name="person" size={34} color={TEXT_PRIMARY} />
            )}
          </View>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, typography.titleLarge]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <View style={styles.chevronSlot}>
              <Ionicons
                name="chevron-forward"
                size={CHEVRON_SIZE}
                color={TEXT_SECONDARY}
              />
            </View>
          </View>
        </SessionReplayView.MaskAll>
      </Pressable>
      {newAccountNotice === snapshot.user.id ? (
        // R15. Non-blocking on purpose: an interstitial on every first
        // sign-in was rejected as noise, but an unexplained empty
        // continue-watching row reads as lost history.
        <NoticeCard
          icon="information-circle"
          iconColor={ACCENT}
          message={NEW_ACCOUNT_MESSAGE}
          tone="info"
          dismissLabel="Dismiss new account notice"
          onDismiss={clearNewAccountNotice}
        />
      ) : null}
    </View>
  )
}

const AVATAR_SIZE = 72
const CHEVRON_SIZE = 22
const CHEVRON_GAP = 4

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 24,
    gap: 12,
  },
  identity: {
    alignItems: "center",
    gap: 10,
  },
  // Sized to its content, so a tap beside the name opens nothing.
  accountTarget: {
    alignSelf: "center",
    maxWidth: "100%",
    minHeight: 44,
  },
  // Equal padding on both sides keeps the name itself on the avatar's axis;
  // the chevron hangs in the right padding, inside the tap target.
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: CHEVRON_SIZE + CHEVRON_GAP,
    maxWidth: "100%",
  },
  chevronSlot: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    justifyContent: "center",
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  guestAvatar: {
    backgroundColor: SURFACE_COLOR,
  },
  accountAvatar: {
    backgroundColor: ACCENT,
  },
  avatarInitial: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  name: {
    flexShrink: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  noticeText: {
    flex: 1,
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  noticeTextError: {
    color: TEXT_PRIMARY,
  },
  signInCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
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
    marginTop: 2,
  },
  // Title only. The same dim on the subtitle gives about 2.6:1 on
  // SURFACE_COLOR, below the 4.5:1 floor; the title keeps about 4.6:1.
  signInDimmed: {
    opacity: 0.5,
  },
})
