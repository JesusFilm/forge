import { redirect } from "next/navigation"
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
    if (!callbackURL) redirect("https://www.jesusfilm.org")

    return (
      <LoginPageClient
        callbackURL={callbackURL}
        enabledProviders={getEnabledProviders()}
        flow="login"
        initialEmail={firstParam(params.email)}
        initialError={parseLoginError(firstParam(params.error))}
        oauthQuery=""
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
