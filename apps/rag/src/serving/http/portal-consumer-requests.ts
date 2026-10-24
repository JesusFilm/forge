export function parseVersionRequest(
  value: unknown,
  allowReason: boolean,
): { expectedVersion: number; reason?: "routine" | "lost" } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const keys = Object.keys(body).sort().join(",")
  if (
    keys !== "expectedVersion" &&
    !(allowReason && keys === "expectedVersion,reason")
  )
    return null
  if (
    !Number.isSafeInteger(body.expectedVersion) ||
    (body.expectedVersion as number) < 1
  )
    return null
  if (
    body.reason !== undefined &&
    body.reason !== "routine" &&
    body.reason !== "lost"
  )
    return null
  return {
    expectedVersion: body.expectedVersion as number,
    reason: body.reason as "routine" | "lost" | undefined,
  }
}
