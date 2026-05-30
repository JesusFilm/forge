import { redirect } from "next/navigation"

import { StudioAuthShell } from "@/features/shell/studio-auth-shell"
import { getManagerOAuthConfig } from "@/lib/oauth-client"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string; returnTo?: string }>
}) {
  const params = await searchParams
  const managerBaseUrl = getManagerOAuthConfig().managerBaseUrl.replace(
    /\/$/,
    "",
  )

  if (!params.error) {
    const loginUrl = new URL(`${managerBaseUrl}/api/auth/login`)
    if (params.returnTo) {
      loginUrl.searchParams.set("returnTo", params.returnTo)
    }
    redirect(loginUrl.toString() as never)
  }

  return (
    <StudioAuthShell
      title="Manager access unavailable"
      subtitle="Manager access was not granted for this account."
    >
      <div className="login-card">
        <div className="login-error" role="alert">
          {formatLoginError(params.error)}
        </div>
      </div>
    </StudioAuthShell>
  )
}

function formatLoginError(error: string | undefined) {
  if (error === "forbidden") {
    return "This account is not approved for Manager access."
  }

  return "We could not complete Manager sign-in."
}
