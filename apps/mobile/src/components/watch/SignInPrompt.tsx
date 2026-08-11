import { useEffect, useState, useSyncExternalStore } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import Ionicons from "@expo/vector-icons/Ionicons"

import { signInWithHostedPage } from "../../lib/authActions"
import { SIGN_IN_ERROR_MESSAGE } from "../../lib/authCopy"
import { getAuthSession } from "../../lib/authSession"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "../../lib/color"
import {
  SIGN_IN_PROMPT_COPY,
  SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
  isSignInPromptArmed,
  markSignInPromptShown,
  rearmSignInPromptAfterCancel,
  serializePromptDismissal,
  shouldShowSignInPrompt,
  subscribeToSignInPrompt,
} from "../../lib/watchProgress/signInPrompt"
import { feedback } from "../../styles/shared"

type PromptPhase = "idle" | "busy" | "error"

/**
 * The contextual sign-in nudge (R17/KTD13): renders once per session when
 * the trigger armed (signed-out mid-video stop past the threshold) and the
 * device-local dismissal cooldown allows. Never blocks playback (R12) —
 * it's a dismissible banner in the detail body, not an overlay.
 *
 * Accepting opens the hosted auth sheet directly (R2). A cancel re-arms the
 * session shot so the banner can return; only an explicit dismiss persists
 * the cooldown.
 */
export function SignInPrompt() {
  const session = useSyncExternalStore(
    (onStoreChange) => getAuthSession().subscribe(onStoreChange),
    () => getAuthSession().getSnapshot(),
  )
  // The arming stop happens in the player's subtree, so this subscription is
  // what lets the prompt appear on the CURRENT screen rather than a later one.
  const armed = useSyncExternalStore(
    subscribeToSignInPrompt,
    isSignInPromptArmed,
  )
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<PromptPhase>("idle")

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
  }, [session, visible, armed])

  // Signing in mid-display hides it.
  if (!visible || session.status === "signedIn") return null

  const busy = phase === "busy"

  const accept = () => {
    if (busy) return
    setPhase("busy")
    void signInWithHostedPage().then((outcome) => {
      if (outcome.status === "cancelled") {
        // Quiet return (R2): the banner stays put, and the session gets its
        // shot back so a later remount can show it again.
        rearmSignInPromptAfterCancel()
        setPhase("idle")
      } else if (outcome.status === "error") {
        setPhase("error")
      } else {
        setPhase("idle")
      }
    })
  }

  const dismiss = () => {
    // Re-burn the session shot (a cancel may have re-armed it) — the async
    // cooldown write below must not race the effect into a re-show.
    markSignInPromptShown()
    setVisible(false)
    void AsyncStorage.setItem(
      SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
      serializePromptDismissal(Date.now()),
    ).catch(() => {})
  }

  if (phase === "error") {
    return (
      <View style={styles.banner}>
        <Ionicons name="warning" size={20} color={WARNING_COLOR} />
        <Text style={styles.copy}>{SIGN_IN_ERROR_MESSAGE}</Text>
        <Pressable
          onPress={() => setPhase("idle")}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={({ pressed }) => [pressed && feedback.pressed]}
        >
          <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.banner}>
      <Ionicons name="bookmark-outline" size={20} color={ACCENT} />
      <Text style={styles.copy}>{SIGN_IN_PROMPT_COPY}</Text>
      <Pressable
        onPress={accept}
        disabled={busy}
        style={({ pressed }) => [
          styles.signInButton,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        {...{ "dd-action-name": "signin-prompt-accept" }}
      >
        <Text style={styles.signInLabel}>
          {busy ? "Signing in…" : "Sign in"}
        </Text>
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
