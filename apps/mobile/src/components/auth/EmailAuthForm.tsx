import { useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  lookupLoginMethod,
  signInWithEmail,
  signUpWithEmail,
  type EmailAuthOutcome,
} from "../../lib/authActions"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  EMAIL_FAILURE_MESSAGES,
  MIN_PASSWORD_LENGTH,
  canSubmitEmailForm,
  isPlausibleEmail,
  providerLabel,
  type EmailFormMode,
} from "../../lib/emailAuth"
import { CARD_BORDER_RADIUS, feedback } from "../../styles/shared"

type Step =
  | { name: "email" }
  | { name: "checking" }
  /** Auth says this address already signs in with a social provider. */
  | { name: "useProvider"; provider: string }
  | { name: "credentials"; mode: EmailFormMode }
  | { name: "submitting"; mode: EmailFormMode }

/**
 * Native email/password sign-in and sign-up (F2). This used to hand off to a
 * browser sheet, which contradicted the native-sheets Key Decision — the
 * fields live in the app now. Every rule lives in `emailAuth.ts`; this only
 * renders and dispatches.
 *
 * The address is checked against auth's login-method endpoint first, so
 * someone whose account is a Google or Apple identity is sent to that button
 * instead of creating a second account against the same email.
 */
export function EmailAuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>({ name: "email" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const busy = step.name === "checking" || step.name === "submitting"

  const continueFromEmail = () => {
    if (busy || !isPlausibleEmail(email)) return
    setError(null)
    setStep({ name: "checking" })
    void lookupLoginMethod(email).then((method) => {
      setStep(
        method.kind === "provider"
          ? { name: "useProvider", provider: method.provider }
          : { name: "credentials", mode: "sign-in" },
      )
    })
  }

  const submit = (mode: EmailFormMode) => {
    if (!canSubmitEmailForm({ mode, email, password, busy })) return
    setError(null)
    setStep({ name: "submitting", mode })
    const attempt: Promise<EmailAuthOutcome> =
      mode === "sign-up"
        ? signUpWithEmail(email, password)
        : signInWithEmail(email, password)
    void attempt.then((outcome) => {
      if (outcome.status === "success") {
        onSignedIn()
        return
      }
      setError(EMAIL_FAILURE_MESSAGES[outcome.reason])
      // Land back on the mode the person chose so the fix is one tap away:
      // a taken email means sign in, a wrong password means try again.
      setStep({
        name: "credentials",
        mode: outcome.reason === "email-taken" ? "sign-in" : mode,
      })
    })
  }

  if (step.name === "useProvider") {
    return (
      <View style={styles.card}>
        <Ionicons name="information-circle" size={20} color={ACCENT} />
        <Text style={styles.noticeText}>
          {`That email already signs in with ${providerLabel(step.provider)}. Use the ${providerLabel(step.provider)} button above to keep one account.`}
        </Text>
        <Pressable
          onPress={() => setStep({ name: "email" })}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Use a different email"
          style={({ pressed }) => [pressed && feedback.pressed]}
        >
          <Text style={styles.linkLabel}>Use a different email</Text>
        </Pressable>
      </View>
    )
  }

  const mode =
    step.name === "credentials" || step.name === "submitting" ? step.mode : null

  return (
    <View style={styles.form}>
      <TextInput
        value={email}
        onChangeText={setEmail}
        editable={!busy}
        placeholder="Email"
        placeholderTextColor={TEXT_SECONDARY}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        style={styles.input}
        accessibilityLabel="Email"
        onSubmitEditing={continueFromEmail}
        returnKeyType={mode ? "next" : "go"}
      />

      {mode ? (
        <TextInput
          value={password}
          onChangeText={setPassword}
          editable={!busy}
          placeholder={
            mode === "sign-up"
              ? `Password (${MIN_PASSWORD_LENGTH}+ characters)`
              : "Password"
          }
          placeholderTextColor={TEXT_SECONDARY}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={
            mode === "sign-up" ? "new-password" : "current-password"
          }
          textContentType={mode === "sign-up" ? "newPassword" : "password"}
          style={styles.input}
          accessibilityLabel="Password"
          onSubmitEditing={() => submit(mode)}
          returnKeyType="go"
          autoFocus
        />
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        onPress={() => (mode ? submit(mode) : continueFromEmail())}
        disabled={
          mode
            ? !canSubmitEmailForm({ mode, email, password, busy })
            : busy || !isPlausibleEmail(email)
        }
        style={({ pressed }) => [
          styles.submitButton,
          (mode
            ? !canSubmitEmailForm({ mode, email, password, busy })
            : busy || !isPlausibleEmail(email)) && styles.submitDisabled,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          mode === "sign-up"
            ? "Create account"
            : mode === "sign-in"
              ? "Sign in"
              : "Continue with this email"
        }
        {...{ "dd-action-name": `email-${mode ?? "continue"}` }}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.submitLabel}>
            {mode === "sign-up"
              ? "Create account"
              : mode === "sign-in"
                ? "Sign in"
                : "Continue"}
          </Text>
        )}
      </Pressable>

      {mode ? (
        <Pressable
          onPress={() => {
            setError(null)
            setStep({
              name: "credentials",
              mode: mode === "sign-in" ? "sign-up" : "sign-in",
            })
          }}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            mode === "sign-in" ? "Create an account instead" : "Sign in instead"
          }
          style={({ pressed }) => [pressed && feedback.pressed]}
        >
          <Text style={styles.linkLabel}>
            {mode === "sign-in"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
  },
  input: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: CARD_BORDER_RADIUS,
    justifyContent: "center",
    minHeight: 48,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitLabel: {
    color: "#000",
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
  linkLabel: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 14,
    paddingVertical: 6,
    textAlign: "center",
  },
  errorText: {
    color: "#fca5a5",
    fontFamily: "System",
    fontSize: 13,
  },
  card: {
    alignItems: "flex-start",
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    gap: 8,
    padding: 14,
  },
  noticeText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 14,
    lineHeight: 19,
  },
})
