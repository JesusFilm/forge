import { LoginPageClient } from "@/app/login/login-page-client"
import {
  firstParam,
  getEnabledProviders,
  isOAuthAuthorizeRequest,
  resolveConsumerCallbackURL,
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
  if (!isOAuthAuthorizeRequest(params)) {
    const consumerCallbackURL = resolveConsumerCallbackURL(params)
    if (!consumerCallbackURL) redirect("https://www.jesusfilm.org")

    return (
      <LoginPageClient
        consumerCallbackURL={consumerCallbackURL}
        enabledProviders={getEnabledProviders()}
        flow="signup"
        oauthQuery=""
        requestingAppName="Jesus Film"
      />
    )
  }

  return (
    <LoginPageClient
      enabledProviders={getEnabledProviders()}
      flow="signup"
      oauthQuery={toOAuthQuery(params)}
      requestingAppName={await resolveRequestingAppName(
        firstParam(params.client_id),
      )}
    />
  )
}
