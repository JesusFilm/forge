import { useState } from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as AppleAuthentication from "expo-apple-authentication"
import { useRouter } from "expo-router"

import { EmailAuthForm } from "../src/components/auth/EmailAuthForm"
import { useTypography } from "../src/hooks/useTypography"
import {
  signInWithApple,
  signInWithHostedPage,
  type SignInOutcome,
} from "../src/lib/authActions"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../src/lib/color"
import { CARD_BORDER_RADIUS, feedback } from "../src/styles/shared"

type SheetState =
  | { phase: "idle" }
  | { phase: "busy"; method: string }
  | { phase: "error" }

/**
 * Sign-in formSheet (U6): native Apple (iOS) and email/password sheets.
 *
 * Native Google is DISABLED pending provisioning — the google-signin config
 * plugin is not registered in app.json and no OAuth client ids exist, so the
 * button would fail when tapped. `signInWithGoogle` is kept intact in
 * authActions; restoring is this button plus that config. Google itself stays
 * reachable meanwhile through the hosted page, which offers it (R2).
 *
 * Success dismisses immediately so the signed-in Profile is the confirmation.
 * A cancel returns quietly; a failure AFTER the provider sheet succeeded
 * surfaces a dismissible error with retry.
 */
export default function SignInSheet() {
  const typography = useTypography()
  const router = useRouter()
  const [state, setState] = useState<SheetState>({ phase: "idle" })
  const [showEmail, setShowEmail] = useState(false)

  const runFlow = (method: string, flow: () => Promise<SignInOutcome>) => {
    setState({ phase: "busy", method })
    void flow().then((outcome) => {
      if (outcome.status === "success") {
        router.back()
      } else if (outcome.status === "cancelled") {
        setState({ phase: "idle" })
      } else {
        setState({ phase: "error" })
      }
    })
  }

  const busy = state.phase === "busy"

  return (
    <View style={styles.container}>
      <Text style={[styles.title, typography.heading]}>Sign in</Text>
      <Text style={styles.subtitle}>
        Use the same Jesus Film account across web and mobile.
      </Text>

      {state.phase === "error" ? (
        <View style={styles.errorCard}>
          <Ionicons name="warning" size={20} color="#fbbf24" />
          <Text style={styles.errorText}>
            Something went wrong finishing sign-in. You are not signed in yet —
            please try again.
          </Text>
          <Pressable
            onPress={() => setState({ phase: "idle" })}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Ionicons name="close" size={20} color={TEXT_SECONDARY} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.buttons}>
        {Platform.OS === "ios" ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
            }
            buttonStyle={
              AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            }
            cornerRadius={CARD_BORDER_RADIUS}
            style={styles.appleButton}
            onPress={() => {
              if (!busy) runFlow("apple", signInWithApple)
            }}
          />
        ) : null}

        {showEmail ? (
          <EmailAuthForm onSignedIn={() => router.back()} />
        ) : (
          <Pressable
            onPress={() => {
              if (!busy) setShowEmail(true)
            }}
            disabled={busy}
            style={({ pressed }) => [
              styles.providerButton,
              pressed && feedback.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Continue with email"
            {...{ "dd-action-name": "sign-in-email" }}
          >
            <Ionicons name="mail-outline" size={20} color={TEXT_PRIMARY} />
            <Text style={styles.providerLabel}>Continue with email</Text>
          </Pressable>
        )}

        {/* Facebook has no native sheet (a deliberate scope boundary), so it
            stays reachable only through the hosted page. */}
        <Pressable
          onPress={() => {
            if (!busy) runFlow("hosted", signInWithHostedPage)
          }}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel="More sign-in options"
          {...{ "dd-action-name": "sign-in-hosted" }}
        >
          <Text style={styles.moreOptionsLabel}>More sign-in options</Text>
        </Pressable>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.busyText}>Signing in…</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  moreOptionsLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
    paddingVertical: 8,
    textAlign: "center",
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 12,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
    marginBottom: 8,
  },
  buttons: {
    gap: 12,
  },
  appleButton: {
    height: 48,
  },
  providerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 48,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
  },
  providerLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 8,
  },
  busyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
})
