const DEFAULT_MASTRA_LAUNCH_TIMEOUT_MS = 120_000

export function resolveMastraLaunchTimeoutMs(
  value: number | string | undefined,
  fallbackMs: number = DEFAULT_MASTRA_LAUNCH_TIMEOUT_MS,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }

  return fallbackMs
}
