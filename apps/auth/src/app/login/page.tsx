import { redirect } from "next/navigation"
import { LoginPageClient } from "@/app/login/login-page-client"
import {
  firstParam,
  getEnabledProviders,
  isOAuthAuthorizeRequest,
  parseLoginError,
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
    redirect("https://www.jesusfilm.org")
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
