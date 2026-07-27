import {
  normalizeOrigin,
  resolveWatchCallbackURL,
} from "@forge/watch-url-policy/callbacks"

import { getAuthBaseUrl, getAuthTrustedOrigins } from "@/config/env"

function getAllowedOrigins(): string[] {
  const authBaseOrigin = normalizeOrigin(getAuthBaseUrl())
  return getAuthTrustedOrigins().filter((origin) => {
    const normalized = normalizeOrigin(origin)
    return normalized != null && normalized !== authBaseOrigin
  })
}

export function resolveWebWatchCallbackURL(
  value: string | undefined,
): string | undefined {
  return resolveWatchCallbackURL(value, getAllowedOrigins())
}
