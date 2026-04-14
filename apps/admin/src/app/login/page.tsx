// Functional placeholder — replaced in Unit 12 with Stitch-designed UI.
// This exists so Phase 1 end-to-end wiring (auth routes, BA sign-in) can be
// validated without blocking on design.
//
// Email/password submits via fetch (BA expects JSON). SSO buttons redirect
// to Better Auth's OAuth initiation endpoint (GET with provider + callbackURL).
//
// No Firebase SDK is loaded client-side. Firebase users migrate transparently
// via the server-side fallback in Unit 5.

"use client"

import { ArrowRight, Facebook, Lock, Shield, UserCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { useAdminI18n } from "@/i18n/client"

const providers = [
  { id: "facebook", icon: Facebook },
  { id: "google", icon: Shield },
  { id: "apple", icon: UserCircle2 },
  { id: "okta", icon: Lock },
] as const

export default function LoginPage() {
  const router = useRouter()
  const { messages } = useAdminI18n()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    })

    if (res.ok) {
      router.push("/dashboard")
      return
    }

    setLoading(false)
    setError(messages.login.errors.invalidCredentials)
  }

  async function resolveSocialRedirect(
    res: Response,
  ): Promise<string | undefined> {
    const contentType = res.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const body = await res.text()
      if (body.trim()) {
        try {
          const data = JSON.parse(body) as { url?: string }
          if (data.url) {
            return data.url
          }
        } catch {
          // Ignore malformed JSON and fall through to redirect fallback.
        }
      }
    }

    if (res.redirected && res.url) {
      return res.url
    }

    return undefined
  }

  return (
    <main className="flex min-h-screen w-full bg-[var(--color-bg)] text-[var(--color-text-primary)]">
      <section className="hidden w-[45%] flex-col justify-between border-r border-[var(--color-hairline)] px-12 py-12 lg:flex">
        <div>
          <div className="mb-24 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--color-brand)] text-white">
              <Shield className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <span className="text-lg font-semibold uppercase tracking-[-0.02em] text-[var(--color-brand)]">
              {messages.login.brandName}
            </span>
          </div>
          <h1 className="max-w-md text-5xl font-semibold leading-[1.05] tracking-[-0.03em]">
            {messages.login.hero}
          </h1>
        </div>
        <div className="space-y-4">
          <div>
            <div className="label-text mb-1">
              {messages.login.labels.architecture}
            </div>
            <div className="mono-meta text-[var(--color-text-disabled)]">
              {messages.login.values.architecture}
            </div>
          </div>
          <div>
            <div className="label-text mb-1">
              {messages.login.labels.nodeStatus}
            </div>
            <div className="mono-meta text-[var(--color-success)]">
              {messages.login.values.nodeStatus}
            </div>
          </div>
        </div>
      </section>

      <section className="relative flex flex-1 items-center justify-center bg-[var(--color-surface)] p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(#fff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 w-full max-w-[420px] rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] p-8 md:p-10">
          <header className="mb-8">
            <span className="label-text mb-2 block">
              {messages.login.labels.signIn}
            </span>
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">
              {messages.login.labels.welcomeBack}
            </h2>
          </header>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="label-text block px-0.5 text-[var(--color-text-secondary)]"
              >
                {messages.login.labels.emailIdentity}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder={messages.login.placeholders.email}
                className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-transparent px-3 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-soft)]"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-end justify-between">
                <label
                  htmlFor="password"
                  className="label-text block px-0.5 text-[var(--color-text-secondary)]"
                >
                  {messages.login.labels.keySecret}
                </label>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder={messages.login.placeholders.password}
                className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-transparent px-3 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-soft)]"
              />
            </div>

            {error ? (
              <p className="text-[12px] text-[var(--color-danger)]">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading
                ? messages.login.actions.signingIn
                : messages.login.actions.continue}
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--color-hairline)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[var(--color-bg)] px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-disabled)]">
                {messages.login.labels.divider}
              </span>
            </div>
          </div>

          <div className="grid gap-3">
            {providers.map((provider) => {
              const Icon = provider.icon
              const providerLabel = messages.login.providers[provider.id]
              return (
                <button
                  key={provider.id}
                  type="button"
                  className="flex h-10 items-center justify-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-transparent text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/auth/sign-in/social", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          provider: provider.id,
                          callbackURL: "/dashboard",
                        }),
                      })

                      const redirectUrl = await resolveSocialRedirect(res)
                      if (redirectUrl) {
                        window.location.href = redirectUrl
                      }
                    } catch {
                      setError(messages.login.errors.invalidCredentials)
                    }
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  {messages.login.actions.continueWith.replace(
                    "{provider}",
                    providerLabel,
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-10 border-t border-[var(--color-hairline)] pt-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                {messages.login.labels.legacyAccount}
              </span>
              <div className="h-px flex-1 bg-[var(--color-hairline-soft)]" />
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              {messages.login.legacyDescription}
            </p>
          </div>
        </div>

        <div className="absolute bottom-6 right-8 hidden gap-8 md:flex">
          <div className="text-right">
            <div className="font-mono text-[10px] text-[var(--color-text-disabled)]">
              {messages.login.labels.secureChannel}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-text-muted)]">
              {messages.login.values.secureChannel}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] text-[var(--color-text-disabled)]">
              {messages.login.labels.region}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-text-muted)]">
              {messages.login.values.region}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
