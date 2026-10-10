// Product pause: keep TV sign-in implemented, but hide Profile on both platforms.
// The old build flag cannot override this decision.
export function resolveProfileSurfaceEnabled(
  _isDev: boolean,
  _flagValue: string | undefined,
): boolean {
  return false
}
