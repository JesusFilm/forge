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

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

export default function LoginPage() {
  const router = useRouter()
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
    setError("Invalid email or password")
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <hr />
      <h2>Or sign in with</h2>
      <ul>
        {["facebook", "google", "apple", "okta"].map((provider) => (
          <li key={provider}>
            <button
              type="button"
              onClick={() => {
                window.location.href = `/api/auth/sign-in/social?provider=${provider}&callbackURL=/dashboard`
              }}
            >
              {provider.charAt(0).toUpperCase() + provider.slice(1)}
            </button>
          </li>
        ))}
      </ul>
      <p>
        <small>
          Placeholder UI. Design work tracked separately via Stitch; replaced in
          Unit 12 of the admin-app plan.
        </small>
      </p>
    </main>
  )
}
