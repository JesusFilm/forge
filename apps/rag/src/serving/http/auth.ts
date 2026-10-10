export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

export function resolveScope(
  allowedSourceKeys: readonly string[],
  requested: string[] | undefined,
): string[] {
  if (!requested) return [...allowedSourceKeys]
  const allowed = new Set(allowedSourceKeys)
  return requested.filter((sourceKey) => allowed.has(sourceKey))
}
