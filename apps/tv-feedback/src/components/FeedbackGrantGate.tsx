"use client"

import { useCallback, useEffect, useState } from "react"

import { TurnstileGate } from "./TurnstileGate"

type Authorization = { referenceCode: string; expiresAt: string }

export function FeedbackGrantGate({
  required,
  children,
}: {
  required: boolean
  children: React.ReactNode
}) {
  const [secret, setSecret] = useState("")
  const [authorization, setAuthorization] = useState<Authorization | null>(null)
  const [token, setToken] = useState("")
  const [challengeAttempt, setChallengeAttempt] = useState(0)
  const [checking, setChecking] = useState(required)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [clock, setClock] = useState(Date.now())
  const onToken = useCallback((value: string) => setToken(value), [])

  useEffect(() => {
    if (!required) return
    const params = new URLSearchParams(window.location.hash.slice(1))
    const code = params.get("grant") ?? ""
    setSecret(code)
    if (code) {
      setChecking(false)
      return
    }
    void fetch("/api/feedback/claim", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok)
          setAuthorization((await response.json()) as Authorization)
      })
      .finally(() => setChecking(false))
  }, [required])
  useEffect(() => {
    if (!authorization) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [authorization])

  if (!required) return children
  if (checking)
    return (
      <main className="grant-entry">
        <h1>Checking feedback access…</h1>
      </main>
    )

  const remaining = authorization
    ? Math.max(
        0,
        Math.ceil((Date.parse(authorization.expiresAt) - clock) / 1000),
      )
    : 0
  const start = async () => {
    if (!secret || busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/feedback/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, turnstileToken: token }),
        cache: "no-store",
      })
      if (!response.ok) throw new Error("claim_failed")
      const result = (await response.json()) as Authorization
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      )
      setSecret("")
      setAuthorization(result)
      setClock(Date.now())
    } catch {
      setToken("")
      setChallengeAttempt((value) => value + 1)
      setError(
        "This QR has expired or was already used. Return to the TV for a new code.",
      )
    } finally {
      setBusy(false)
    }
  }

  if (!authorization)
    return (
      <main className="grant-entry">
        <span className="grant-eyebrow">WATCH TV · BETA</span>
        <h1>Start feedback</h1>
        <p>
          Start your 30-minute window when you are ready to add a photo or
          describe the issue. Opening this page has not used the code.
        </p>
        {secret ? (
          <>
            <TurnstileGate key={challengeAttempt} onToken={onToken} />
            <button
              type="button"
              onClick={() => void start()}
              disabled={
                busy ||
                (Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && !token)
              }
            >
              {busy ? "Checking…" : "Start feedback"}
            </button>
          </>
        ) : (
          <p>No TV feedback code found. Scan the QR shown in the Watch app.</p>
        )}
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : null}
      </main>
    )

  return (
    <div className="grant-session">
      <div
        className={`grant-countdown ${remaining <= 300 ? "warning" : ""}`}
        role="status"
      >
        Reference {authorization.referenceCode} ·{" "}
        {remaining > 0
          ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining`
          : "Time expired"}
      </div>
      {children}
      {remaining === 0 ? (
        <div className="grant-expired" role="alertdialog" aria-modal="true">
          <h2>Feedback time expired</h2>
          <p>
            Your draft remains on this page. Return to the TV for a new QR code.
          </p>
        </div>
      ) : null}
    </div>
  )
}
