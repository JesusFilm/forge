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
export type LoginErrorCode = "account_not_linked" | "forbidden"

type LoginMethodId = LoginProviderId | "email"

const lastLoginMethodStorageKey = "forge.auth.lastLoginMethod"

const loginErrors = {
  account_not_linked: {
    title: "This sign-in method is not linked yet.",
    detail:
      "Sign in with the method you used before, then connect this provider from your account settings.",
  },
  forbidden: {
    title: "Access has not been approved.",
    detail:
      "Your account signed in successfully, but it is not approved for this application.",
  },
} satisfies Record<LoginErrorCode, { title: string; detail: string }>

export function LoginPageClient({
  enabledProviders,
  initialError,
}: {
  enabledProviders: LoginProviderId[]
  initialError?: LoginErrorCode
}) {
  const [error, setError] = useState<
    LoginErrorCode | "credentials" | "start" | null
  >(initialError ?? null)
  const [lastLoginMethod, setLastLoginMethod] = useState<LoginMethodId | null>(
    () => readLastLoginMethod(),
  )

  const alert =
    error === "credentials"
      ? {
          title: "Unable to sign in.",
          detail: "Check your email and password, then try again.",
        }
      : error === "start"
        ? {
            title: "Provider sign-in did not start.",
            detail: "Refresh the page and try again.",
          }
        : error
          ? loginErrors[error]
          : null

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    rememberLastLoginMethod("email")
    setLastLoginMethod("email")
    e.currentTarget.submit()
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
          <p>Use the same method you used when your account was created.</p>

          <form
            action="/api/auth/sign-in/email"
            method="post"
            onSubmit={handleSubmit}
          >
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

            {alert ? (
              <div role="alert" className="login-alert">
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
              </div>
            ) : null}

            <button className="primary-button" type="submit">
              <span>Continue</span>
              {lastLoginMethod === "email" ? <LastUsedBadge /> : null}
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
                        }),
                      })
                      const redirectUrl = await resolveSocialRedirect(res)
                      if (redirectUrl) {
                        rememberLastLoginMethod(providerId)
                        setLastLoginMethod(providerId)
                        window.location.href = redirectUrl
                      }
                    } catch {
                      setError("start")
                    }
                  }}
                >
                  <span>Continue with {providerLabels[providerId]}</span>
                  {lastLoginMethod === providerId ? <LastUsedBadge /> : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}

function LastUsedBadge() {
  return <span className="last-used-badge">Last used</span>
}

function readLastLoginMethod(): LoginMethodId | null {
  if (typeof window === "undefined") return null

  try {
    const value = window.localStorage.getItem(lastLoginMethodStorageKey)
    return isLoginMethod(value) ? value : null
  } catch {
    return null
  }
}

function rememberLastLoginMethod(method: LoginMethodId) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(lastLoginMethodStorageKey, method)
  } catch {
    // Login must still work when localStorage is unavailable.
  }
}

function isLoginMethod(value: string | null): value is LoginMethodId {
  return (
    value === "email" ||
    value === "facebook" ||
    value === "google" ||
    value === "apple" ||
    value === "okta"
  )
}
