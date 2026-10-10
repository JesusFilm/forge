import type { Route } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { firstParam, type LoginSearchParams } from "@/app/login/login-page-data"
import { auth } from "@/auth/config"
import { normalizeUserCode } from "@/lib/device-user-code"

import { buildDeviceLoginRedirect } from "./device-login-redirect"
import { DeviceApprovalPageClient } from "./device-page-client"

// A Railway kill-switch flip must take effect without a rebuild, and the
// session read below is per-request anyway.
export const dynamic = "force-dynamic"

/**
 * Placeholder shown until `/api/auth/device/status` names the real client.
 *
 * It is deliberately a constant and NOT `resolveRequestingAppName(client_id)`
 * the way `/oauth/consent` does it. There the authorize request has already
 * validated `client_id`; here the only legitimate entry point is the RFC 8628
 * `verification_uri_complete`, which `device-grant-plugin.ts` builds as
 * `/device?user_code=…` and never gives a `client_id`. Reading one from the
 * query would let a link-crafter put any registered app's display name on an
 * approval screen for a device code belonging to someone else — the exact
 * mis-attribution this screen exists to prevent. The status lookup, keyed on
 * the code itself, is the only source allowed to name the app.
 */
const REQUESTING_APP_PLACEHOLDER = "Jesus Film on your TV"

type DevicePageProps = {
  searchParams?: Promise<LoginSearchParams>
}

export default async function DevicePage({
  searchParams,
}: DevicePageProps = {}) {
  const params = (await searchParams) ?? {}
  const userCode = normalizeUserCode(firstParam(params.user_code) ?? "")

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.email) {
    // `as Route` matches the existing typed-routes escape in login-page-client.
    redirect(buildDeviceLoginRedirect(userCode) as Route)
  }

  return (
    <DeviceApprovalPageClient
      accountEmail={session.user.email}
      fallbackAppName={REQUESTING_APP_PLACEHOLDER}
      initialUserCode={userCode}
    />
  )
}
