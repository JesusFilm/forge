"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

export function LoginForm({ expired }: { expired: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(
    expired ? "Your session has expired. Please sign in again." : null,
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error: string }
        setError(data.error || "Login failed")
        return
      }

      router.push("/dashboard/coverage")
      router.refresh()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-card">
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form">
        <label className="login-label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="login-input"
        />

        <label className="login-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="login-input"
        />

        <button type="submit" disabled={loading} className="login-button">
          {loading ? "Signing in\u2026" : "Sign in"}
        </button>
      </form>
    </div>
  )
}
