"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react"
import {
  providerLabels,
  type LoginMethodId,
  type LoginProviderId,
} from "@/auth/login-methods"
import { WatchFilmCollageBackground } from "./watch-film-collage-background"

export type LoginErrorCode = "account_not_linked" | "credentials" | "forbidden"

type LoginStep = "email" | "password"

const providerIds = Object.keys(providerLabels) as LoginProviderId[]
const lastLoginMethodCookieName = "forge_auth_last_login_method"

const loginErrors = {
  account_not_linked: {
    title: "This login method is not linked yet.",
    detail:
      "Log in with the method you used before, then connect this provider from your account settings.",
  },
  forbidden: {
    title: "Access has not been approved.",
    detail:
      "Your account signed in successfully, but it is not approved for this application.",
  },
} satisfies Record<
  Exclude<LoginErrorCode, "credentials">,
  { title: string; detail: string }
>

export function LoginPageClient({
  enabledProviders,
  flow = "login",
  initialEmail,
  initialError,
  oauthQuery,
  requestingAppName,
}: {
  enabledProviders: LoginProviderId[]
  flow?: "login" | "signup"
  initialEmail?: string
  initialError?: LoginErrorCode
  oauthQuery: string
  requestingAppName?: string | null
}) {
  const [error, setError] = useState<
    LoginErrorCode | "credentials" | "lookup" | "start" | null
  >(initialError ?? null)
  const [email, setEmail] = useState(initialEmail ?? "")
  const [step, setStep] = useState<LoginStep>(
    initialEmail && initialError === "credentials" ? "password" : "email",
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const isRedirectingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const lastLoginMethod = useSyncExternalStore(
    subscribeToCookieSnapshot,
    readLastLoginMethod,
    getServerLastLoginMethod,
  )

  const alert =
    error === "credentials"
      ? {
          title: "Invalid email or password.",
          detail: "Check your email and password, then try again.",
        }
      : error === "start"
        ? {
            title: "Provider login did not start.",
            detail: "Refresh the page and try again.",
          }
        : error === "lookup"
          ? {
              title: "We could not check that email.",
              detail: "Refresh the page and try again.",
            }
          : error
            ? loginErrors[error]
            : null
  const isBusy = isSubmitting || isRedirecting

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (step === "password") {
      return
    }

    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const res = await fetch("/api/auth/login-method", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          oauth_query: oauthQuery,
        }),
      })

      if (!res.ok) {
        setError("lookup")
        return
      }

      const data = (await res.json()) as
        | { method: "password" }
        | { method: "provider"; provider: LoginProviderId }

      if (data.method === "provider") {
        const started = await startSocialSignIn(data.provider)
        if (started) return
        return
      }

      setStep("password")
      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLInputElement>("#password")?.focus()
      })
    } catch {
      setError("lookup")
    } finally {
      if (!isRedirectingRef.current) setIsSubmitting(false)
    }
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

  async function startSocialSignIn(providerId: LoginProviderId) {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          oauth_query: oauthQuery,
          provider: providerId,
        }),
      })
      const redirectUrl = await resolveSocialRedirect(res)
      if (redirectUrl) {
        isRedirectingRef.current = true
        setIsRedirecting(true)
        window.location.href = redirectUrl
        return true
      }

      setError("start")
    } catch {
      setError("start")
    }
    isRedirectingRef.current = false
    setIsRedirecting(false)
    setIsSubmitting(false)
    return false
  }

  return (
    <main className="font-apercu relative grid min-h-screen grid-cols-1 overflow-hidden bg-[#0c0a09] max-[820px]:block max-[820px]:overflow-y-auto">
      <WatchFilmCollageBackground />
      <div className="relative z-10 m-auto grid w-[min(calc(100%_-_32px),980px)] gap-4 py-8 max-[820px]:mx-auto max-[820px]:-mt-[188px] max-[820px]:w-full max-[820px]:max-w-[480px] max-[820px]:gap-0 max-[820px]:py-0">
        <section className="grid min-h-[620px] w-full grid-cols-[minmax(0,1fr)_minmax(320px,420px)] overflow-hidden rounded-md border border-white/8 bg-[rgba(20,17,15,0.72)] shadow-[0_28px_90px_rgba(0,0,0,0.68)] backdrop-blur-[5px] max-[820px]:min-h-0 max-[820px]:grid-cols-1 max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:!bg-transparent max-[820px]:shadow-none max-[820px]:backdrop-blur-none">
          <div className="grid min-h-[560px] content-end gap-[22px] border-r border-white/8 p-12 text-[#f5f5f4] max-[820px]:min-h-0 max-[820px]:content-start max-[820px]:gap-5 max-[820px]:border-b-0 max-[820px]:border-r-0 max-[820px]:p-7 max-[820px]:pt-0">
            <Image
              src="/images/jesus-film-logo-brandpad-cropped.png"
              alt="Jesus Film Project"
              width={799}
              height={272}
              className="h-auto w-[178px]"
            />
            <div className="grid gap-2 max-[820px]:mt-6">
              <h1 className="m-0 max-w-[560px] text-[clamp(36px,6.4vw,68px)] font-bold leading-[0.94] tracking-[-0.03em] max-[820px]:text-[34px] max-[820px]:leading-[0.98]">
                {flow === "signup" ? "Create your account." : "Welcome."}
              </h1>
              <p className="font-noto-serif m-0 max-w-[440px] text-[15px] leading-6 text-[#d6d3d1]">
                {flow === "signup" ? "Sign up" : "Log in"} to Jesus Film One
                {requestingAppName
                  ? ` to continue to ${requestingAppName}.`
                  : " to continue."}
              </p>
            </div>
          </div>

          <div className="bg-[rgba(12,10,9,0.84)] p-12 text-[#f5f5f4] max-[820px]:!bg-transparent max-[820px]:p-7">
            <h2 className="mb-2 mt-0 text-2xl font-bold">
              {flow === "signup" ? "Sign up" : "Log in"}
            </h2>

            {flow === "signup" ? (
              <p className="font-noto-serif mb-0 mt-3 text-[13px] leading-5 text-[#d6d3d1]">
                By continuing, you agree to our{" "}
                <a
                  className="font-apercu font-bold text-[#f5f5f4] underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white"
                  href="https://www.jesusfilm.org/terms/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Terms of Use
                </a>{" "}
                and{" "}
                <a
                  className="font-apercu font-bold text-[#f5f5f4] underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white"
                  href="https://www.jesusfilm.org/privacy/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Privacy Policy
                </a>
                .
              </p>
            ) : null}

            <div className="mt-5 grid gap-3">
              {providerIds.map((providerId) => {
                const enabled = enabledProviders.includes(providerId)

                return (
                  <button
                    key={providerId}
                    className="relative flex h-[46px] w-full cursor-pointer items-center justify-start gap-3 rounded border border-white/10 bg-transparent px-4 text-left font-medium leading-none text-[#f5f5f4] transition-[background-color,border-color,box-shadow] duration-150 hover:border-white/25 hover:bg-white/[0.04] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.04)] focus-visible:border-[#ef3340] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.18)] disabled:cursor-not-allowed disabled:border-white/5 disabled:text-[#78716c] disabled:opacity-70"
                    disabled={!enabled || isBusy}
                    type="button"
                    onClick={() => void startSocialSignIn(providerId)}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center leading-none">
                      <ProviderLogo providerId={providerId} />
                    </span>
                    <span className="leading-none">
                      Continue with {providerLabels[providerId]}
                    </span>
                    {lastLoginMethod === providerId ? <LastUsedBadge /> : null}
                  </button>
                )
              })}
            </div>

            <div className="my-7 flex items-center gap-4 text-xs font-bold uppercase tracking-[0.08em] text-[#a8a29e]">
              <span className="h-px flex-1 bg-white/10" />
              <span>OR</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <form
              ref={formRef}
              action="/api/auth/sign-in/email"
              method="post"
              onSubmit={handleSubmit}
            >
              <input type="hidden" name="oauth_query" value={oauthQuery} />
              <div className="grid gap-1.5">
                <label
                  className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#d6d3d1]"
                  htmlFor="email"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (step === "password") setStep("email")
                  }}
                  className="h-[42px] w-full rounded border border-white/10 bg-transparent px-3 text-[#f5f5f4] outline-none focus:border-[#ef3340] focus:shadow-[0_0_0_3px_rgba(239,51,64,0.12)]"
                  required
                />
              </div>

              {step === "password" ? (
                <div className="mt-4 grid gap-1.5">
                  <label
                    className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#d6d3d1]"
                    htmlFor="password"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    className="h-[42px] w-full rounded border border-white/10 bg-transparent px-3 text-[#f5f5f4] outline-none focus:border-[#ef3340] focus:shadow-[0_0_0_3px_rgba(239,51,64,0.12)]"
                    required
                  />
                </div>
              ) : null}

              {alert ? (
                <div
                  role="alert"
                  className="mt-[18px] border-l-[3px] border-l-[#ef3340] bg-[rgba(239,51,64,0.1)] px-3.5 py-3"
                >
                  <strong className="block text-[13px] leading-[1.35] text-red-200">
                    {alert.title}
                  </strong>
                  <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                    {alert.detail}
                  </p>
                </div>
              ) : null}

              <button
                className="relative mt-5 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2.5 rounded border-0 bg-[#ef3340] font-bold text-white transition-[background-color,box-shadow] duration-150 hover:bg-[#d91f2b] hover:shadow-[0_10px_26px_rgba(239,51,64,0.22)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.24)] disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isBusy}
                type="submit"
              >
                <span className="min-w-0">
                  {step === "password" ? "Log in" : "Continue"}
                </span>
                {isBusy ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-4 size-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                  />
                ) : null}
                {lastLoginMethod === "email" ? <LastUsedBadge /> : null}
              </button>
            </form>

            <p className="font-noto-serif mb-0 mt-6 text-center text-[13px] leading-5 text-[#a8a29e]">
              {flow === "signup"
                ? "Already have an account?"
                : "Don't have an account?"}{" "}
              <Link
                className="font-apercu font-bold text-[#f5f5f4] underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white"
                href={
                  `${
                    flow === "signup" ? "/login" : "/signup"
                  }?${oauthQuery}` as Route
                }
              >
                {flow === "signup" ? "Log in" : "Sign up"}
              </Link>
            </p>
          </div>
        </section>

        <nav
          aria-label="Legal"
          className="flex items-center justify-center gap-4 text-[13px] font-bold leading-none text-[#d6d3d1] max-[820px]:pb-6"
        >
          <a
            className="underline decoration-white/35 underline-offset-4 transition-colors duration-150 hover:text-[#f5f5f4] hover:decoration-white/80"
            href="https://www.jesusfilm.org/terms/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Terms of Use
          </a>
          <span aria-hidden="true" className="text-white/30">
            |
          </span>
          <a
            className="underline decoration-white/35 underline-offset-4 transition-colors duration-150 hover:text-[#f5f5f4] hover:decoration-white/80"
            href="https://www.jesusfilm.org/privacy/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Privacy Policy
          </a>
        </nav>
      </div>
    </main>
  )
}

function ProviderLogo({ providerId }: { providerId: LoginProviderId }) {
  const opticalOffset =
    providerId === "google" ||
    providerId === "facebook" ||
    providerId === "okta"
      ? "-translate-y-px"
      : ""

  if (providerId === "google") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={`block size-5 ${opticalOffset}`}
        height={20}
        src="/images/providers/google.svg"
        unoptimized
        width={20}
      />
    )
  }

  if (providerId === "facebook") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={`block size-5 ${opticalOffset}`}
        height={20}
        src="/images/providers/facebook.svg"
        unoptimized
        width={20}
      />
    )
  }

  if (providerId === "apple") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="block h-5 w-[16px]"
        height={20}
        src="/images/providers/apple.svg"
        unoptimized
        width={18}
      />
    )
  }

  return (
    <Image
      alt=""
      aria-hidden="true"
      className={`block size-5 ${opticalOffset}`}
      height={20}
      src="/images/providers/okta.svg"
      unoptimized
      width={20}
    />
  )
}

function LastUsedBadge() {
  return (
    <span className="absolute -right-[5px] -top-[7.5px] inline-flex h-[15px] items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-[#14110f] px-1.5 text-[8px] font-bold uppercase leading-none tracking-[0.04em] text-[#d6d3d1] shadow-[0_4px_12px_rgba(0,0,0,0.32)]">
      <span className="translate-y-px">Last used</span>
    </span>
  )
}

function readLastLoginMethod(): LoginMethodId | null {
  if (typeof document === "undefined") return null

  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${lastLoginMethodCookieName}=`))
  const value = cookie ? decodeURIComponent(cookie.split("=")[1] ?? "") : null
  return isLoginMethod(value) ? value : null
}

function getServerLastLoginMethod() {
  return null
}

function subscribeToCookieSnapshot() {
  return () => {}
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
