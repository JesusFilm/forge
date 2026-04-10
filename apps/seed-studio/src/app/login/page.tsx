import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">
            Seed Studio
          </h1>
          <p className="text-sm text-neutral-500">
            Enter the password to access the experience creator
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
