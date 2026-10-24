import { redirect } from "next/navigation"
import { isDeviceLoginContinuation } from "@/app/device/device-login-redirect"
import { LoginPageClient } from "@/app/login/login-page-client"
import {
  firstParam,
  getEnabledProviders,
  isOAuthAuthorizeRequest,
  parseLoginError,
  resolveConsumerCallbackURL,
  resolveRequestingAppName,
  toOAuthQuery,
  type LoginSearchParams,
} from "@/app/login/login-page-data"

type LoginPageProps = {
  searchParams?: Promise<LoginSearchParams>
}

export default async function LoginPage({ searchParams }: LoginPageProps = {}) {
  const params = (await searchParams) ?? {}
  if (!isOAuthAuthorizeRequest(params)) {
    const callbackURL = resolveConsumerCallbackURL(params)
    // The `/device` approval page cannot ride `callbackURL` — web-callback.ts
    // filters auth's own origin out of the allowed callback origins — so its
    // signed-out hop arrives carrying `user_code` instead.
    if (!callbackURL && !isDeviceLoginContinuation(params)) {
      redirect("https://www.jesusfilm.org")
    }

    return (
      <LoginPageClient
        callbackURL={callbackURL}
        enabledProviders={getEnabledProviders()}
        flow="login"
        initialEmail={firstParam(params.email)}
        initialError={parseLoginError(firstParam(params.error))}
        oauthQuery={callbackURL ? "" : toOAuthQuery(params)}
        requestingAppName="Jesus Film"
      />
    )
  }

  return (
    <LoginPageClient
      enabledProviders={getEnabledProviders()}
      flow="login"
      initialEmail={firstParam(params.email)}
      initialError={parseLoginError(firstParam(params.error))}
      oauthQuery={toOAuthQuery(params)}
      requestingAppName={await resolveRequestingAppName(
        firstParam(params.client_id),
      )}
    />
  )
}
