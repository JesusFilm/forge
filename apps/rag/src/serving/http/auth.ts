import { bearerTokenConfigSchema } from "../../contracts/index.js"

export type TokenScope = {
  allowedSourceKeys: string[] | "all"
}

export type TokenRegistry = ReadonlyMap<string, TokenScope>

export function parseTokenRegistry(json: string): TokenRegistry {
  const parsed = bearerTokenConfigSchema.parse(JSON.parse(json))
  return new Map(
    Object.entries(parsed).map(([token, sourceKeys]) => [
      token,
      { allowedSourceKeys: sourceKeys.includes("*") ? "all" : sourceKeys },
    ]),
  )
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

export function lookupScope(
  registry: TokenRegistry,
  authorization: string | undefined,
): TokenScope | null {
  const token = bearerToken(authorization)
  return token ? (registry.get(token) ?? null) : null
}

export function resolveScope(
  scope: TokenScope,
  requested: string[] | undefined,
): string[] | undefined {
  if (scope.allowedSourceKeys === "all") return requested
  if (!requested) return scope.allowedSourceKeys
  const allowed = new Set(scope.allowedSourceKeys)
  return requested.filter((sourceKey) => allowed.has(sourceKey))
}
