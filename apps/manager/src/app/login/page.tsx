import { redirect } from "next/navigation"
import { LogOut } from "lucide-react"

import { StudioAuthShell } from "@/features/shell/studio-auth-shell"
import { isLocalMockManagerLoginEnabled } from "@/lib/mock-manager-login"
import { getManagerBaseUrl } from "@/lib/oauth-client"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string; returnTo?: string }>
}) {
  const params = await searchParams
  const managerBaseUrl = getManagerBaseUrl()

  if (!params.error) {
    const loginPath = isLocalMockManagerLoginEnabled()
      ? "/api/auth/mock-login"
      : "/api/auth/login"
    const loginUrl = new URL(`${managerBaseUrl}${loginPath}`)
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
        <a
          className="login-button login-button-secondary"
          href="/api/auth/logout"
        >
          <LogOut className="login-button-icon" aria-hidden="true" />
          Sign out and try another account
        </a>
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
