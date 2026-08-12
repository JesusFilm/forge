import { useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { decidePostReauth } from "../../lib/accountDeletion"
import { deleteAccount, signInWithHostedPage } from "../../lib/authActions"
import { getAuthSession } from "../../lib/authSession"
import { TEXT_PRIMARY, TEXT_SECONDARY, WARNING_COLOR } from "../../lib/color"
import { feedback } from "../../styles/shared"

const DANGER = "#ef4444"
/** Placeholder until the team names a deletion-support address. */
const SUPPORT_EMAIL = "help@jesusfilm.org"

/** Strict deletion aborts on any failed side effect, so "nothing was
 *  changed" is literal — and a retry may not clear it, hence support. */
export const DELETE_FAILED_MESSAGE = `Deleting your account failed — nothing was changed. Please try again. If it keeps failing, contact ${SUPPORT_EMAIL}.`
/** R2: the deletion never ran on this branch, so the copy must stay
 *  distinct from DELETE_FAILED_MESSAGE. */
export const REAUTH_FAILED_MESSAGE =
  "Signing in did not work, so your account was not deleted. Please try again."
export const REAUTH_PROMPT_MESSAGE =
  "For security, sign in again first. Deletion then continues automatically."
/** AE7: non-destructive — a different subject signed in, nothing ran. */
export const WRONG_ACCOUNT_MESSAGE =
  "A different account signed in, so nothing was deleted. To delete the original account, sign in with it and try again."
/** A client abort cannot tell whether the server finished the delete, so the
 *  copy must not claim either outcome — a reopen reveals the true state. */
export const DELETE_UNCONFIRMED_MESSAGE =
  "We could not confirm whether your account was deleted. Reopen the app to check. If you are still signed in, nothing changed and you can try again."

/** KTD5 machine: confirm → busy → (idle | needsReauth | error);
 *  needsReauth → sheetOpen → (busy retry | wrongAccount | needsReauth). */
type FlowState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "busy" }
  | {
      phase: "needsReauth"
      capturedUserId: string | null
      signInFailed: boolean
    }
  | { phase: "sheetOpen"; capturedUserId: string | null }
  | { phase: "wrongAccount"; capturedUserId: string | null }
  | { phase: "error" }
  | { phase: "unconfirmed" }

function signedInUserId(): string | null {
  const snapshot = getAuthSession().getSnapshot()
  return snapshot.status === "signedIn" ? snapshot.user.id : null
}

/**
 * In-app account deletion (U7, App Store 5.1.1(v)). No verification email
 * exists platform-wide (auth-owner direction), so intent is verified by a
 * FRESH session: a stale one routes to SSO re-auth, then the deletion
 * auto-retries — but only for the SAME subject (KTD5). Deletion also
 * erases the account's admin-side watch data server-side (KTD12); locally
 * the signed-out transition clears everything.
 */
export function DeleteAccountFlow() {
  const [state, setState] = useState<FlowState>({ phase: "idle" })
  // Busy guards as refs: press handlers can fire twice off one stale
  // render, so phase checks alone cannot make the second call a no-op.
  const deleteInFlight = useRef(false)
  const reauthInFlight = useRef(false)
  // The re-auth callback fires the irreversible delete on an id match; gate it
  // on the flow still being mounted so a signed-out flip mid-sheet cannot
  // delete silently off-screen. Setup restores the flag because StrictMode
  // remounts the SAME instance (setup→cleanup→setup) — clearing without
  // restoring would wedge it after a dev remount.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const runDelete = () => {
    if (deleteInFlight.current) return
    deleteInFlight.current = true
    setState({ phase: "busy" })
    void deleteAccount().then(
      (outcome) => {
        deleteInFlight.current = false
        if (outcome.status === "deleted") {
          // The signed-out transition has already cleared local state; the
          // account section re-renders to the signed-out CTA.
          setState({ phase: "idle" })
        } else if (outcome.status === "fresh-session-required") {
          // KTD5: capture WHO must re-authenticate now — the session is
          // stale, but the snapshot still holds the user.
          setState({
            phase: "needsReauth",
            capturedUserId: signedInUserId(),
            signInFailed: false,
          })
        } else if (outcome.status === "unconfirmed") {
          // The request aborted; the server may or may not have finished.
          setState({ phase: "unconfirmed" })
        } else {
          setState({ phase: "error" })
        }
      },
      // Release the latch on rejection too — deleteAccount is contracted to
      // resolve, but a rejection must never leave the button inert forever.
      () => {
        deleteInFlight.current = false
        setState({ phase: "error" })
      },
    )
  }

  const runReauth = (capturedUserId: string | null) => {
    if (reauthInFlight.current) return
    reauthInFlight.current = true
    setState({ phase: "sheetOpen", capturedUserId })
    // On success the refreshed user is committed to the session store
    // BEFORE this promise resolves (U2), so the snapshot read is settled.
    void signInWithHostedPage().then(
      (outcome) => {
        reauthInFlight.current = false
        const next = decidePostReauth({
          capturedUserId,
          outcome: outcome.status,
          signedInUserId: signedInUserId(),
        })
        if (next === "retry-deletion") {
          // Only auto-delete if the flow is still mounted: an abandoned sheet
          // (a signed-out flip unmounts this panel) must not delete silently.
          if (alive.current) runDelete()
        } else if (next === "wrong-account") {
          setState({ phase: "wrongAccount", capturedUserId })
        } else {
          setState({
            phase: "needsReauth",
            capturedUserId,
            signInFailed: next === "needs-reauth-sign-in-failed",
          })
        }
      },
      // A rejected sheet must release the latch and surface a retry, not pin
      // the panel on "Signing in…" forever.
      () => {
        reauthInFlight.current = false
        setState({ phase: "needsReauth", capturedUserId, signInFailed: true })
      },
    )
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

      {state.phase === "needsReauth" || state.phase === "sheetOpen" ? (
        <>
          <View style={styles.noticeRow}>
            {state.phase === "needsReauth" && state.signInFailed ? (
              <Ionicons name="warning" size={18} color={WARNING_COLOR} />
            ) : (
              <Ionicons
                name="shield-checkmark"
                size={18}
                color={TEXT_PRIMARY}
              />
            )}
            <Text style={styles.panelBody}>
              {state.phase === "needsReauth" && state.signInFailed
                ? REAUTH_FAILED_MESSAGE
                : REAUTH_PROMPT_MESSAGE}
            </Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => runReauth(state.capturedUserId)}
              disabled={state.phase === "sheetOpen"}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Sign in again"
            >
              <Text style={styles.cancelLabel}>
                {state.phase === "sheetOpen" ? "Signing in…" : "Sign in again"}
              </Text>
            </Pressable>
            {/* A non-destructive exit: without it the only control auto-fires
                the irreversible deletion on a same-subject sign-in. */}
            <Pressable
              onPress={() => setState({ phase: "idle" })}
              disabled={state.phase === "sheetOpen"}
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

      {state.phase === "wrongAccount" ? (
        <>
          <View style={styles.noticeRow}>
            <Ionicons name="warning" size={18} color={WARNING_COLOR} />
            <Text style={styles.panelBody}>{WRONG_ACCOUNT_MESSAGE}</Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() =>
                setState({
                  phase: "needsReauth",
                  capturedUserId: state.capturedUserId,
                  signInFailed: false,
                })
              }
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Try signing in again"
            >
              <Text style={styles.cancelLabel}>Try again</Text>
            </Pressable>
            <Pressable
              onPress={() => setState({ phase: "idle" })}
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

      {state.phase === "error" ? (
        <>
          <View style={styles.noticeRow}>
            <Ionicons name="warning" size={18} color={WARNING_COLOR} />
            <Text style={styles.panelBody}>{DELETE_FAILED_MESSAGE}</Text>
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

      {state.phase === "unconfirmed" ? (
        <>
          <View style={styles.noticeRow}>
            <Ionicons
              name="information-circle"
              size={18}
              color={TEXT_PRIMARY}
            />
            <Text style={styles.panelBody}>{DELETE_UNCONFIRMED_MESSAGE}</Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => setState({ phase: "idle" })}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && feedback.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.cancelLabel}>Close</Text>
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
