import { getChatIdentity } from "@/auth/identity"
import { isSignInError, SIGN_IN_ERROR_PARAM } from "@/auth/sign-in-notice"
import { AppShell } from "@/components/shell/app-shell"
import { chatAuthConfigured, isSeekerChatEnabled } from "@/config/env"

/**
 * `force-dynamic` is load-bearing (feat-205, KTD1): without it Next.js folds the
 * isSeekerChatEnabled() / chatAuthConfigured() env reads AND the session-cookie
 * read into the build-time prerender, so flipping env on Railway wouldn't take
 * effect and the signed-in identity would never render. feat-207 adds the auth
 * reads here (server-side, like seekerEnabled).
 */
export const dynamic = "force-dynamic"

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams
  const authConfigured = chatAuthConfigured()
  // Identity is display-only (R4) — read only when auth is configured; anonymous
  // (null) is a valid, first-class state and never redirects (R3).
  const identity = authConfigured ? await getChatIdentity() : null
  const marker = params[SIGN_IN_ERROR_PARAM]
  const signInError = isSignInError(Array.isArray(marker) ? marker[0] : marker)

  return (
    <AppShell
      seekerEnabled={isSeekerChatEnabled()}
      authConfigured={authConfigured}
      identity={identity}
      signInError={signInError}
    />
  )
}
