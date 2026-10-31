// SYNC: mirrors apps/tv/src/lib/auth/profileFlagState.ts (feat-322). The rule
// for the mobile sign-in gate (feat-543). It reads no env, so tests reach the
// rule without loading src/env.ts.

// Both spellings, deliberately: the first TV TestFlight build shipped dark
// because EAS held `true` while the gate accepted only "1". Every other value
// stays off. This is an opt-in gate, not a boolean parser.
const ENABLED_VALUES = new Set(["1", "true"])

export function resolveSignInAvailable(
  isDev: boolean,
  flagValue: string | undefined,
): boolean {
  return isDev || ENABLED_VALUES.has(flagValue ?? "")
}
