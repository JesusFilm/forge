import { isDeviceLoginContinuation } from "@/app/device/device-login-redirect"
import { LoginPageClient } from "@/app/login/login-page-client"
import {
  firstParam,
  getEnabledProviders,
  isOAuthAuthorizeRequest,
  resolveRequestingAppName,
  toOAuthQuery,
  type LoginSearchParams,
} from "@/app/login/login-page-data"
import { redirect } from "next/navigation"

type SignupPageProps = {
  searchParams?: Promise<LoginSearchParams>
}

export default async function SignupPage({
  searchParams,
}: SignupPageProps = {}) {
  const params = (await searchParams) ?? {}
  const isDeviceContinuation = isDeviceLoginContinuation(params)

  // A device approval reaches signup the same way it reaches login: carrying a
  // user code rather than an OAuth authorize request. Without this it bounces
  // to the marketing site, and a viewer with no account has nowhere to go —
  // the "Sign up" link on the login page hands them a dead end. R2 of the
  // origin requirements is explicit that new accounts happen in the same visit.
  if (!isOAuthAuthorizeRequest(params) && !isDeviceContinuation) {
    redirect("https://www.jesusfilm.org")
  }

  return (
    <LoginPageClient
      enabledProviders={getEnabledProviders()}
      flow="signup"
      oauthQuery={toOAuthQuery(params)}
      // The device lane carries no client_id, and must not: on this path the
      // query is whatever a link handed the viewer, so reading an app name
      // from it would let a crafted link name a trusted app.
      requestingAppName={
        isDeviceContinuation
          ? null
          : await resolveRequestingAppName(firstParam(params.client_id))
      }
    />
  )
}
