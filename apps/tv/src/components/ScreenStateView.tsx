// The one full-screen loading / error / empty state box (the review found five
// inline copies). Screens keep their shell (background, top bar, header); this
// renders the centered content and owns the text/retry treatment.

import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { scale } from "../lib/scale"
import { RetryButton } from "./RetryButton"
import { WATCH_THEME } from "./watch/watchDetailTheme"

type ScreenStateViewProps = {
  kind: "loading" | "error" | "empty"
  /** Headline for error/empty (e.g. "Something went wrong"). */
  message?: string
  /** Secondary error line (e.g. the retryable error message). */
  detail?: string | null
  /** Footer hint under the retry (e.g. "Press menu to go back"). */
  hint?: string
  onRetry?: () => void
  retryHint?: string
  /** One-shot initial focus on the retry pill (default true). */
  retryAutoFocus?: boolean
  /** Spinner + retry accent. WATCH red by default; Crimson surfaces pass
   *  COLORS.primary. */
  accent?: string
}

export function ScreenStateView({
  kind,
  message,
  detail,
  hint,
  onRetry,
  retryHint,
  retryAutoFocus = true,
  accent = WATCH_THEME.accent,
}: ScreenStateViewProps) {
  return (
    <View style={styles.centered}>
      {kind === "loading" ? (
        <ActivityIndicator size="large" color={accent} />
      ) : (
        <>
          {message != null ? (
            <Text style={kind === "error" ? styles.message : styles.empty}>
              {message}
            </Text>
          ) : null}
          {kind === "error" && detail != null ? (
            <Text style={styles.detail}>{detail}</Text>
          ) : null}
          {kind === "error" && onRetry != null ? (
            <RetryButton
              onPress={onRetry}
              accent={accent}
              accessibilityHint={retryHint}
              hasTVPreferredFocus={retryAutoFocus}
            />
          ) : null}
          {hint != null ? <Text style={styles.hint}>{hint}</Text> : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: scale(20),
    paddingHorizontal: scale(80),
  },
  message: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "bold",
    color: WATCH_THEME.text,
    textAlign: "center",
  },
  detail: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    color: WATCH_THEME.text62,
    textAlign: "center",
  },
  empty: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "500",
    color: WATCH_THEME.text62,
    textAlign: "center",
  },
  hint: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    color: WATCH_THEME.text50,
  },
})
