"use client"

import { useEffect, useState } from "react"
import type { TvContext } from "@/lib/contracts"
import { PhotoFeedbackFlow } from "./PhotoFeedbackFlow"

type Authorization = {
  referenceCode: string
  expiresAt: string
  simulator: true
}

export function SignedSimulatorGate({ tvContext }: { tvContext: TvContext }) {
  const [token, setToken] = useState("")
  const [authorization, setAuthorization] = useState<Authorization | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""
    if (value) {
      setToken(value)
      setChecking(false)
      return
    }
    void fetch("/api/feedback/simulator/claim", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok)
          setAuthorization((await response.json()) as Authorization)
      })
      .catch(() =>
        setError(
          "Could not check this session. Scan the signed simulator QR again.",
        ),
      )
      .finally(() => setChecking(false))
  }, [])
  useEffect(() => {
    if (!authorization) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [authorization])

  const start = async () => {
    if (!token || busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/feedback/simulator/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      })
      if (!response.ok) throw new Error("claim_failed")
      setAuthorization((await response.json()) as Authorization)
      setClock(Date.now())
      // Retain the bearer only in this component's memory for another explicit
      // report. It never enters a query, storage, logs or the form submission.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      )
    } catch {
      setError(
        "The simulator link is invalid, expired or unavailable. Ask the developer for a new signed QR.",
      )
    } finally {
      setBusy(false)
    }
  }
  if (checking)
    return (
      <main className="grant-entry">
        <h1>Checking simulator feedback…</h1>
      </main>
    )
  if (!authorization)
    return (
      <main className="grant-entry">
        <span className="grant-eyebrow">WATCH TV · SIMULATOR TEST</span>
        <h1>Start a simulator report</h1>
        <p>
          This signed link opens a single-report session for up to 30 minutes.
          Your photo and note will be sent to TV Beta Feedback in Linear when
          you submit.
        </p>
        <p>
          Use the link again for another report while it is valid. Simulator
          reports have no daily count limit; file and upload limits still apply.
        </p>
        {token ? (
          <button type="button" disabled={busy} onClick={() => void start()}>
            {busy ? "Checking…" : "Start simulator feedback"}
          </button>
        ) : (
          <p>Scan a valid signed simulator QR to start a new report.</p>
        )}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    )
  const remaining = Math.max(
    0,
    Math.ceil((Date.parse(authorization.expiresAt) - clock) / 1000),
  )
  return (
    <div className="grant-session">
      <div
        className={`grant-countdown ${remaining <= 300 ? "warning" : ""}`}
        role="status"
      >
        Simulator report ·{" "}
        {remaining > 0
          ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining`
          : "Session expired"}
      </div>
      <PhotoFeedbackFlow
        key={authorization.referenceCode}
        tvContext={tvContext}
        advancedHref="/tv/simulator"
        grantRequired
        simulatorMode
        onDone={() => setAuthorization(null)}
      />
      {remaining === 0 ? (
        <div className="grant-expired" role="alertdialog" aria-modal="true">
          <h2>Simulator session expired</h2>
          <p>
            Your draft remains on this page. Scan a valid signed simulator QR
            for a new session.
          </p>
        </div>
      ) : null}
    </div>
  )
}
