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

import { useTypography } from "../src/hooks/useTypography"
import {
  signInWithApple,
  signInWithGoogle,
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
  | { phase: "newAccount" }

/**
 * Sign-in formSheet (U6): native Apple (iOS) and Google sheets, with every
 * other provider reachable through the hosted auth page (F2). A cancel
 * returns quietly; a failure AFTER the provider sheet succeeded surfaces a
 * dismissible error with retry. A fresh account (e.g. a Private Relay
 * email) surfaces the R15 notice with the hosted-page path to sign into an
 * existing account instead.
 */
export default function SignInSheet() {
  const typography = useTypography()
  const router = useRouter()
  const [state, setState] = useState<SheetState>({ phase: "idle" })

  const runFlow = (method: string, flow: () => Promise<SignInOutcome>) => {
    setState({ phase: "busy", method })
    void flow().then((outcome) => {
      if (outcome.status === "success") {
        if (outcome.newAccount) {
          setState({ phase: "newAccount" })
        } else {
          router.back()
        }
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

      {state.phase === "newAccount" ? (
        <View style={styles.noticeCard}>
          <Ionicons name="information-circle" size={22} color={ACCENT} />
          <View style={styles.noticeText}>
            <Text style={[styles.noticeTitle, typography.titleSmall]}>
              New account created
            </Text>
            <Text style={styles.noticeBody}>
              No existing account matched this email, so a new one was created.
              If you meant to use an existing account, sign in with email or
              another option.
            </Text>
            <Pressable
              onPress={() => runFlow("hosted", signInWithHostedPage)}
              style={({ pressed }) => [pressed && feedback.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Sign in with a different account"
              {...{ "dd-action-name": "sign-in-switch-account" }}
            >
              <Text style={styles.noticeLink}>
                Sign in with a different account
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.noticeLink}>Done</Text>
          </Pressable>
        </View>
      ) : null}

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

      {state.phase !== "newAccount" ? (
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

          <Pressable
            onPress={() => {
              if (!busy) runFlow("google", signInWithGoogle)
            }}
            disabled={busy}
            style={({ pressed }) => [
              styles.providerButton,
              pressed && feedback.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            {...{ "dd-action-name": "sign-in-google" }}
          >
            <Ionicons name="logo-google" size={20} color={TEXT_PRIMARY} />
            <Text style={styles.providerLabel}>Continue with Google</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              if (!busy) runFlow("hosted", signInWithHostedPage)
            }}
            disabled={busy}
            style={({ pressed }) => [
              styles.providerButton,
              pressed && feedback.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Continue with email or other options"
            {...{ "dd-action-name": "sign-in-hosted" }}
          >
            <Ionicons name="mail-outline" size={20} color={TEXT_PRIMARY} />
            <Text style={styles.providerLabel}>Email or other options</Text>
          </Pressable>

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.busyText}>Signing in…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
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
  noticeCard: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    padding: 14,
  },
  noticeText: {
    flex: 1,
    gap: 6,
  },
  noticeTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  noticeBody: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
  noticeLink: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 6,
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
