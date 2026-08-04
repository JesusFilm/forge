import { useEffect, useState, useSyncExternalStore } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import { getAuthSession } from "../../lib/authSession"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  SIGN_IN_PROMPT_COPY,
  SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
  markSignInPromptShown,
  serializePromptDismissal,
  shouldShowSignInPrompt,
} from "../../lib/watchProgress/signInPrompt"
import { feedback } from "../../styles/shared"

/**
 * The contextual sign-in nudge (R17/KTD13): renders once per session when
 * the trigger armed (signed-out mid-video stop past the threshold) and the
 * device-local dismissal cooldown allows. Never blocks playback (R12) —
 * it's a dismissible banner in the detail body, not an overlay.
 */
export function SignInPrompt() {
  const router = useRouter()
  const session = useSyncExternalStore(
    (onStoreChange) => getAuthSession().subscribe(onStoreChange),
    () => getAuthSession().getSnapshot(),
  )
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (visible) return
    let cancelled = false
    void AsyncStorage.getItem(SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY)
      .catch(() => null)
      .then((dismissedAtRaw) => {
        if (cancelled) return
        if (
          shouldShowSignInPrompt({
            signedIn: session.status === "signedIn",
            dismissedAtRaw,
            nowMs: Date.now(),
          })
        ) {
          markSignInPromptShown()
          setVisible(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session, visible])

  // Signing in mid-display hides it.
  if (!visible || session.status === "signedIn") return null

  const dismiss = () => {
    setVisible(false)
    void AsyncStorage.setItem(
      SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
      serializePromptDismissal(Date.now()),
    ).catch(() => {})
  }

  return (
    <View style={styles.banner}>
      <Ionicons name="bookmark-outline" size={20} color={ACCENT} />
      <Text style={styles.copy}>{SIGN_IN_PROMPT_COPY}</Text>
      <Pressable
        onPress={() => {
          setVisible(false)
          router.push("/sign-in")
        }}
        style={({ pressed }) => [
          styles.signInButton,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        {...{ "dd-action-name": "signin-prompt-accept" }}
      >
        <Text style={styles.signInLabel}>Sign in</Text>
      </Pressable>
      <Pressable
        onPress={dismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        {...{ "dd-action-name": "signin-prompt-dismiss" }}
      >
        <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: SURFACE_COLOR,
  },
  copy: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
  signInButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  signInLabel: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "700",
  },
})
