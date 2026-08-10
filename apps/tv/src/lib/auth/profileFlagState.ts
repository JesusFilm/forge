// Pure truth table for the profile-surface gate (feat-322). Env-free so tests
// reach the policy without loading src/env.ts (jest has no EXPO_PUBLIC_* vars).

/**
 * Spellings accepted as "on". Both, deliberately: the first TestFlight build of
 * the sign-in surface shipped DARK because the operator set the EAS variable to
 * `true` while this gate accepted only `"1"` — an error invisible until someone
 * stands in front of a real TV. Anything else (including "false") stays off;
 * this is an opt-in gate, not a boolean parser.
 */
const ENABLED_VALUES = new Set(["1", "true"])

export function resolveProfileSurfaceEnabled(
  isDev: boolean,
  flagValue: string | undefined,
): boolean {
  return isDev || ENABLED_VALUES.has(flagValue ?? "")
}
