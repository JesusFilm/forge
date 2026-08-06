// Pure truth table for the profile-surface gate (feat-322). Env-free so tests
// reach the policy without loading src/env.ts (jest has no EXPO_PUBLIC_* vars).

export function resolveProfileSurfaceEnabled(
  isDev: boolean,
  flagValue: string | undefined,
): boolean {
  return isDev || flagValue === "1"
}
