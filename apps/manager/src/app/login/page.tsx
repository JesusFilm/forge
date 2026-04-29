import { Suspense } from "react"
import { StudioAuthShell } from "@/features/shell/studio-auth-shell"
import { LoginForm } from "@/app/login/login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>
}) {
  const params = await searchParams

  return (
    <StudioAuthShell
      title="Sign in"
      subtitle="Manage coverage, enrichment jobs, review flows, and automations."
    >
      <Suspense>
        <LoginForm expired={params.expired === "1"} />
      </Suspense>
    </StudioAuthShell>
  )
}
