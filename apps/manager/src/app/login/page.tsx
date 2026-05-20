import { Suspense } from "react"
import { StudioAuthShell } from "@/features/shell/studio-auth-shell"
import { LoginForm } from "@/app/login/login-form"
import { getManagerOAuthConfig } from "@/lib/oauth-client"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; error?: string }>
}) {
  const params = await searchParams
  const managerBaseUrl = getManagerOAuthConfig().managerBaseUrl.replace(
    /\/$/,
    "",
  )

  return (
    <StudioAuthShell
      title="Sign in"
      subtitle="Manage coverage, enrichment jobs, review flows, and automations."
    >
      <Suspense>
        <LoginForm
          expired={params.expired === "1"}
          error={params.error}
          loginHref={`${managerBaseUrl}/api/auth/login`}
        />
      </Suspense>
    </StudioAuthShell>
  )
}
