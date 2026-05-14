"use client"

import { ArrowRight, Facebook, Lock, Shield, UserCircle2 } from "lucide-react"
import Image from "next/image"
import { useState, type FormEvent } from "react"
import { useAdminI18n } from "@/i18n/client"

const providerIcons = {
  facebook: Facebook,
  google: Shield,
  apple: UserCircle2,
  okta: Lock,
} as const

export type LoginProviderId = keyof typeof providerIcons

export function LoginPageClient({
  accessRequestAvailable,
  authBaseURL,
  callbackURL,
  destinationName,
  enabledProviders,
  initialError,
}: {
  accessRequestAvailable?: boolean
  authBaseURL?: string
  callbackURL?: string
  destinationName?: string
  enabledProviders: LoginProviderId[]
  initialError?: "forbidden"
}) {
  const { messages } = useAdminI18n()
  const [error, setError] = useState(
    initialError === "forbidden" ? messages.login.errors.forbidden : "",
  )
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)
  const [requestingAccess, setRequestingAccess] = useState(false)

  const authApiBase = authBaseURL ? `${authBaseURL}/api/auth` : "/api/auth"
  const resolvedDestinationName =
    destinationName ?? messages.login.destination.defaultName

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const form = new FormData(e.currentTarget)
      const resolvedCallbackURL =
        callbackURL ?? `${window.location.origin}/dashboard`
      const res = await fetch(`${authApiBase}/sign-in/email`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          callbackURL: resolvedCallbackURL,
        }),
      })

      if (res.ok) {
        window.location.assign(resolvedCallbackURL)
        return
      }
    } catch {
      // Fall through to generic credential error so the login surface does not
      // expose transport/runtime internals.
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

  async function requestAccess() {
    setError("")
    setNotice("")
    setRequestingAccess(true)

    try {
      const res = await fetch("/api/auth/request-access", {
        method: "POST",
        headers: { accept: "application/json" },
      })

      if (res.ok) {
        setNotice(messages.login.access.requested)
        return
      }
    } catch {
      // Fall through to generic request error.
    } finally {
      setRequestingAccess(false)
    }

    setError(messages.login.errors.requestAccessFailed)
  }

  function tryDifferentAccount() {
    const resolvedCallbackURL =
      callbackURL ?? `${window.location.origin}/dashboard`
    window.location.assign(
      `/api/auth/login?callbackURL=${encodeURIComponent(resolvedCallbackURL)}`,
    )
  }

  return (
    <main className="flex min-h-screen w-full bg-[var(--color-bg)] text-[var(--color-text-primary)]">
      <section className="hidden w-[45%] flex-col justify-center border-r border-[var(--color-hairline)] px-12 py-12 lg:flex">
        <div>
          <div className="mb-10">
            <Image
              src="/images/jesus-film-logo-full.svg"
              alt={messages.login.brandName}
              width={139}
              height={36}
              className="h-9 w-auto"
              priority
            />
          </div>
          <h1 className="max-w-md text-5xl font-semibold leading-[1.05]">
            {messages.login.hero}
          </h1>
          <div className="mt-10 inline-flex items-center gap-3 border-l-2 border-[var(--color-brand)] pl-4">
            <Shield
              className="h-4 w-4 text-[var(--color-brand)]"
              strokeWidth={1.75}
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              {messages.login.destination.context.replace(
                "{destination}",
                resolvedDestinationName,
              )}
            </span>
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
            <Image
              src="/images/jesus-film-logo-full.svg"
              alt={messages.login.brandName}
              width={139}
              height={36}
              className="mb-7 h-8 w-auto lg:hidden"
              priority
            />
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">
              {messages.login.labels.welcomeBack}
            </h2>
            <p className="mt-3 text-[13px] leading-5 text-[var(--color-text-muted)]">
              {messages.login.destination.helper.replace(
                "{destination}",
                resolvedDestinationName,
              )}
            </p>
          </header>

          {notice ? (
            <p
              role="status"
              className="mb-5 rounded-sm border border-[var(--color-success-border)] bg-[color-mix(in_oklab,var(--color-success)_10%,var(--color-bg))] px-3 py-2 text-[12px] leading-5 text-[var(--color-success)]"
            >
              {notice}
            </p>
          ) : null}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="label-text block px-0.5 text-[var(--color-text-secondary)]"
              >
                {messages.login.labels.emailAddress}
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
                  {messages.login.labels.password}
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
              <div role="alert" className="space-y-3">
                <p className="text-[12px] text-[var(--color-danger)]">
                  {error}
                </p>
                {accessRequestAvailable ? (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      disabled={requestingAccess}
                      onClick={requestAccess}
                      className="flex h-9 w-full items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {requestingAccess
                        ? messages.login.actions.requestingAccess
                        : messages.login.actions.requestAccess}
                    </button>
                    <button
                      type="button"
                      onClick={tryDifferentAccount}
                      className="flex h-9 w-full items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
                    >
                      {messages.login.actions.tryDifferentAccount}
                    </button>
                  </div>
                ) : null}
              </div>
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

          {enabledProviders.length > 0 ? (
            <>
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
                {enabledProviders.map((providerId) => {
                  const Icon = providerIcons[providerId]
                  const providerLabel = messages.login.providers[providerId]
                  return (
                    <button
                      key={providerId}
                      type="button"
                      className="flex h-10 items-center justify-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-transparent text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                      onClick={async () => {
                        try {
                          const resolvedCallbackURL =
                            callbackURL ?? `${window.location.origin}/dashboard`
                          const res = await fetch(
                            `${authApiBase}/sign-in/social`,
                            {
                              method: "POST",
                              credentials: "include",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                provider: providerId,
                                callbackURL: resolvedCallbackURL,
                              }),
                            },
                          )

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
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}
