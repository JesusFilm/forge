import { getChatIdentity } from "@/auth/identity"
import { isSignInError, SIGN_IN_ERROR_PARAM } from "@/auth/sign-in-notice"
import { AppShell } from "@/components/shell/app-shell"
import { chatAuthConfigured } from "@/config/env"
import { resolveSeekerGate } from "@/lib/seeker-gate"

/**
 * `force-dynamic` is load-bearing (feat-205, KTD1): without it Next.js folds
 * the chatAuthConfigured() env read, the session-cookie read, AND the seeker
 * gate resolution (env kill switch + per-user LaunchDarkly evaluation,
 * feat-233) into the build-time prerender, so flipping env on Railway wouldn't
 * take effect and the signed-in identity would never render. feat-207 adds the
 * auth reads here (server-side); feat-233 replaces the bare env-flag read with
 * the shared gate.
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
  // The shared feat-233 gate (R6): an anonymous load or unconfigured-auth
  // deploy resolves seekerEnabled=false even when SEEKER_CHAT_ENABLED=true —
  // the intended R3/R6 behavior, keeping page and route in agreement.
  const gate = await resolveSeekerGate(identity, { surface: "page" })
  const marker = params[SIGN_IN_ERROR_PARAM]
  const signInError = isSignInError(Array.isArray(marker) ? marker[0] : marker)

  return (
    <AppShell
      seekerEnabled={gate.seekerEnabled}
      authConfigured={authConfigured}
      identity={identity}
      signInError={signInError}
    />
  )
}
