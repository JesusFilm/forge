"use client"

import Image from "next/image"
import { useState, type FormEvent } from "react"

const providerLabels = {
  facebook: "Facebook",
  google: "Google",
  apple: "Apple",
  okta: "Okta",
} as const

export type LoginProviderId = keyof typeof providerLabels

export function LoginPageClient({
  callbackURL,
  enabledProviders,
  initialError,
}: {
  callbackURL: string
  enabledProviders: LoginProviderId[]
  initialError?: "forbidden"
}) {
  const [error, setError] = useState(
    initialError === "forbidden"
      ? "You do not have access to this application."
      : "",
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const form = new FormData(e.currentTarget)
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          callbackURL,
        }),
      })

      if (res.ok) {
        window.location.assign(callbackURL)
        return
      }
    } catch {
      // Keep transport details out of the sign-in UI.
    }

    setLoading(false)
    setError("Invalid email or password.")
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
          if (data.url) return data.url
        } catch {
          return undefined
        }
      }
    }

    return res.redirected && res.url ? res.url : undefined
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-copy">
          <Image
            src="/images/jesus-film-logo-full.svg"
            alt="Jesus Film Project"
            width={139}
            height={36}
            className="login-logo"
            priority
          />
          <h1>Sign in to continue.</h1>
          <p>Secure access for approved applications.</p>
        </div>

        <div className="login-form">
          <Image
            src="/images/jesus-film-logo-full.svg"
            alt="Jesus Film Project"
            width={139}
            height={36}
            className="login-logo"
            priority
          />
          <h2>Sign in</h2>
          <p>Enter your account details.</p>

          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            {error ? (
              <p role="alert" className="error">
                {error}
              </p>
            ) : null}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Signing in" : "Continue"}
            </button>
          </form>

          {enabledProviders.length > 0 ? (
            <>
              <div className="divider" />
              {enabledProviders.map((providerId) => (
                <button
                  key={providerId}
                  className="provider-button"
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/auth/sign-in/social", {
                        method: "POST",
                        credentials: "include",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          provider: providerId,
                          callbackURL,
                        }),
                      })
                      const redirectUrl = await resolveSocialRedirect(res)
                      if (redirectUrl) {
                        window.location.href = redirectUrl
                      }
                    } catch {
                      setError("Unable to start provider sign-in.")
                    }
                  }}
                >
                  Continue with {providerLabels[providerId]}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}
