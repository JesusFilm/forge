import { resolveWatchCallbackURL } from "@/lib/watch-callback"

export function normalizeWebReturnTo(
  value: string | null | undefined,
  input: { requestOrigin: string; allowedOrigins: string[] },
): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined

  let candidate: URL
  try {
    candidate = new URL(value, input.requestOrigin)
  } catch {
    return undefined
  }
  const resolved = resolveWatchCallbackURL(candidate.toString(), [
    input.requestOrigin,
    ...input.allowedOrigins,
  ])
  if (!resolved) return undefined

  const safe = new URL(resolved)
  return `${safe.pathname}${safe.search}${safe.hash}`
}
