"use client"

import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  LogIn,
  ShieldAlert,
  UserPlus,
} from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useAdminI18n } from "@/i18n/client"

export function AccessRequestPageClient({
  accessStatus,
  accountEmail,
  accountName,
}: {
  accessStatus?: "approved" | "pending" | "available" | "unavailable"
  accountEmail?: string
  accountName?: string
}) {
  const { messages } = useAdminI18n()
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [requestingAccess, setRequestingAccess] = useState(false)
  const displayAccount = accountEmail ?? accountName
  const status = accessStatus ?? "unavailable"

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

  function continueWithAuth() {
    window.location.assign(buildAdminLoginUrl(window.location.origin))
  }

  function signInAgain() {
    window.location.assign(
      buildAdminLoginUrl(window.location.origin, { prompt: "login" }),
    )
  }

  function tryDifferentAccount() {
    window.location.assign(
      buildAdminLoginUrl(window.location.origin, { prompt: "login" }),
    )
  }

  function checkStatus() {
    window.location.reload()
  }

  const StatusIcon =
    status === "approved"
      ? CheckCircle2
      : status === "pending"
        ? Clock3
        : status === "available"
          ? UserPlus
          : ShieldAlert

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--color-surface)] p-6 text-[var(--color-text-primary)]">
      <section className="relative flex w-full max-w-[460px] items-center justify-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(#fff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] p-8 text-center md:p-10">
          <header className="mb-7 flex flex-col items-center">
            <Image
              src="/images/jesus-film-logo-full.svg"
              alt={messages.login.brandName}
              width={139}
              height={36}
              className="mb-8 h-8 w-auto"
              priority
            />
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-warning-border)] text-[var(--color-warning)]">
              <StatusIcon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {messages.login.access.title}
            </h1>
            <p className="mt-3 max-w-[320px] text-[13px] leading-5 text-[var(--color-text-muted)]">
              {messages.login.access[status]}
            </p>
          </header>

          {displayAccount ? (
            <div className="mb-5 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3 text-left">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                {messages.login.access.accountLabel}
              </p>
              <p className="mt-1 truncate text-[13px] text-[var(--color-text-secondary)]">
                {displayAccount}
              </p>
            </div>
          ) : null}

          {notice ? (
            <p
              role="status"
              className="mb-5 rounded-sm border border-[var(--color-success-border)] bg-[color-mix(in_oklab,var(--color-success)_10%,var(--color-bg))] px-3 py-2 text-[12px] leading-5 text-[var(--color-success)]"
            >
              {notice}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-sm border border-[var(--color-danger-border)] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-bg))] px-3 py-2 text-[12px] leading-5 text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="grid gap-2">
            {status === "available" ? (
              <button
                type="button"
                disabled={requestingAccess || Boolean(notice)}
                onClick={requestAccess}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                {requestingAccess
                  ? messages.login.actions.requestingAccess
                  : messages.login.actions.requestAccess}
              </button>
            ) : status === "approved" ? (
              <button
                type="button"
                onClick={continueWithAuth}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
              >
                <LogIn className="h-4 w-4" strokeWidth={1.5} />
                {messages.login.actions.continueToAdmin}
              </button>
            ) : status === "pending" ? (
              <button
                type="button"
                onClick={checkStatus}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] text-[13px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
              >
                {messages.login.actions.checkAccessStatus}
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                type="button"
                onClick={signInAgain}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
              >
                {messages.login.actions.signInAgain}
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
            <button
              type="button"
              onClick={tryDifferentAccount}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] text-[13px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
            >
              {messages.login.actions.tryDifferentAccount}
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

export function buildAdminLoginUrl(
  origin: string,
  options: { prompt?: "login" | "select_account" } = {},
) {
  const params = new URLSearchParams({
    returnTo: `${origin}/dashboard`,
  })
  if (options.prompt) {
    params.set("prompt", options.prompt)
  }

  return `/api/auth/login?${params.toString()}`
}
