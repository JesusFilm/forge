import { Suspense } from "react"
import { StudioAuthShell } from "@/features/shell/studio-auth-shell"
import { LoginForm } from "@/app/login/login-form"

export default function LoginPage() {
  return (
    <StudioAuthShell
      title="Sign in"
      subtitle="Manage coverage, enrichment jobs, review flows, and automations."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </StudioAuthShell>
  )
}
