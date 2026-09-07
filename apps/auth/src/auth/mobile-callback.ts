import { MOBILE_APP_SCHEME } from "@/auth/mobile-session"

// The route's web callback policy knows only watch URLs, so the Expo client's
// `forgemobile:///` callback was dropped and the sheet ended on a web page.
// Scheme check only: Better Auth still vets it against trustedOrigins.
export function resolveMobileCallbackURL(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  return url.protocol === `${MOBILE_APP_SCHEME}:` ? value : undefined
}
