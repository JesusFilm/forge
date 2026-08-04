import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import { deleteAccount } from "../../lib/authActions"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"

const DANGER = "#ef4444"

type FlowState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "busy" }
  | { phase: "needsReauth" }
  | { phase: "error" }

/**
 * In-app account deletion (U7, App Store 5.1.1(v)). No verification email
 * exists platform-wide (auth-owner direction), so intent is verified by a
 * FRESH session: a stale one routes to SSO re-auth, then the user retries.
 * Deletion also erases the account's admin-side watch data server-side
 * (KTD12); locally the signed-out transition clears everything.
 */
export function DeleteAccountFlow() {
  const router = useRouter()
  const [state, setState] = useState<FlowState>({ phase: "idle" })

  const runDelete = () => {
    setState({ phase: "busy" })
    void deleteAccount().then((outcome) => {
      if (outcome.status === "deleted") {
        // The signed-out transition has already cleared local state; the
        // account section re-renders to the signed-out CTA.
        setState({ phase: "idle" })
      } else if (outcome.status === "fresh-session-required") {
        setState({ phase: "needsReauth" })
      } else {
        setState({ phase: "error" })
      }
    })
  }

  if (state.phase === "idle") {
    return (
      <Pressable
        onPress={() => setState({ phase: "confirm" })}
        style={({ pressed }) => [styles.entryRow, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Delete account"
        {...{ "dd-action-name": "delete-account-entry" }}
      >
        <Text style={styles.entryLabel}>Delete account</Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.panel}>
      {state.phase === "confirm" || state.phase === "busy" ? (
        <>
          <Text style={styles.panelTitle}>Delete this account?</Text>
          <Text style={styles.panelBody}>
            This permanently deletes your Jesus Film account everywhere —
            including your watch history and saved progress. This cannot be
            undone.
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              onPress={runDelete}
              disabled={state.phase === "busy"}
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Permanently delete account"
              {...{ "dd-action-name": "delete-account-confirm" }}
            >
              <Text style={styles.dangerLabel}>
                {state.phase === "busy" ? "Deleting…" : "Delete permanently"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setState({ phase: "idle" })}
              disabled={state.phase === "busy"}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel deletion"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {state.phase === "needsReauth" ? (
        <>
          <View style={styles.noticeRow}>
            <Ionicons name="shield-checkmark" size={18} color={TEXT_PRIMARY} />
            <Text style={styles.panelBody}>
              For security, sign in again first — then come back and delete your
              account.
            </Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => {
                setState({ phase: "idle" })
                router.push("/sign-in")
              }}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Sign in again"
            >
              <Text style={styles.cancelLabel}>Sign in again</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {state.phase === "error" ? (
        <>
          <View style={styles.noticeRow}>
            <Ionicons name="warning" size={18} color="#fbbf24" />
            <Text style={styles.panelBody}>
              Deleting your account failed — nothing was changed. Please try
              again.
            </Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => setState({ phase: "confirm" })}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Try deleting again"
            >
              <Text style={styles.cancelLabel}>Try again</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  entryRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  entryLabel: {
    color: DANGER,
    fontFamily: "System",
    fontSize: 14,
  },
  panel: {
    gap: 10,
    paddingTop: 4,
  },
  panelTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "700",
  },
  panelBody: {
    flex: 1,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 18,
  },
  noticeRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  dangerButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: DANGER,
  },
  dangerLabel: {
    color: "#ffffff",
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "700",
  },
  cancelButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  cancelLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
  },
})
