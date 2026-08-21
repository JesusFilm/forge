import type { Metadata } from "next"

import { getChatIdentity } from "@/auth/identity"
import { isSignInError, SIGN_IN_ERROR_PARAM } from "@/auth/sign-in-notice"
import { AppShell } from "@/components/shell/app-shell"
import { chatAuthConfigured } from "@/config/env"
import { toConversationId } from "@/lib/conversation-id"
import { deepLinkShell, resolveDeepLinkEntry } from "@/lib/deep-link-entry"
import { resolveSeekerGate } from "@/lib/seeker-gate"

/**
 * `/c/<id>` deep-link entry (feat-209): mirrors page.tsx's resolution order
 * (force-dynamic, auth config → identity → seeker gate → signin marker), then
 * maps the pure KTD5 resolver onto AppShell. Deliberately THIN — no logic
 * beyond the mapping; `deepLinkShell` owns the kind → props decision (it is
 * unit tested, this component is not), and the browser matrix proves the
 * shell behavior.
 *
 * Privacy (KTD9, scoped claim — never the absolute one): chat's application
 * logs and the POST-shaped history proxies still never carry thread ids, but
 * this deep-link GET necessarily puts the id in the request path, so every
 * `/c/<id>` open (and any RSC traverse request) lands in Cloudflare and
 * Railway HTTP access logs — an accepted residual (platform retention is
 * outside the feat-336 window and feat-337 erasure; a thread id is not a
 * capability, ownership is enforced server-side per resource).
 */

// force-dynamic is load-bearing for the same KTD1 reasons as page.tsx: the
// env, session-cookie, and gate reads must never fold into a prerender.
export const dynamic = "force-dynamic"

// noindex, and deliberately NO generateMetadata / thread titles in the head —
// browser history must reveal that chat was used, never what was said.
export const metadata: Metadata = { robots: { index: false, follow: false } }

type ConversationPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ConversationPage({
  params,
  searchParams,
}: ConversationPageProps) {
  const { id } = await params
  const query = await searchParams
  // null = malformed segment; the canonical LOWERCASE id is the only form
  // ever passed on — the raw segment is never reflected into a prop or href.
  const canonicalId = toConversationId(id)
  const authConfigured = chatAuthConfigured()
  const identity = authConfigured ? await getChatIdentity() : null
  const gate = await resolveSeekerGate(identity, { surface: "page" })
  const marker = query[SIGN_IN_ERROR_PARAM]
  const signInError = isSignInError(Array.isArray(marker) ? marker[0] : marker)

  const entry = resolveDeepLinkEntry({
    idValid: canonicalId !== null,
    authConfigured,
    identity,
    seekerEnabled: gate.seekerEnabled,
  })
  // The ONE producer of the shell props: `seekerEnabled` is true on exactly
  // the two granted kinds, and a `deniedScreen` shell is never granted — so
  // the URL-sync/hydration layer cannot mount under a denial pane.
  const shell = deepLinkShell(entry.kind)

  return (
    <AppShell
      seekerEnabled={shell.seekerEnabled}
      authConfigured={authConfigured}
      identity={identity}
      signInError={signInError}
      // Malformed segments resolve to null and are never reflected into a
      // prop or href — feat-399's shell gets no id at all.
      initialConversationId={canonicalId ?? undefined}
      deniedScreen={shell.deniedScreen}
      deepLinkUnresolvable={shell.deepLinkUnresolvable}
    />
  )
}
