"use client"

import { LoaderCircle } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const expired = searchParams.get("expired") === "1"
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
    <div className="space-y-6 sm:space-y-7">
      {error && (
        <div
          className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ds-brand-red)_24%,white)] bg-[color:color-mix(in_srgb,var(--ds-brand-red)_8%,white)] px-5 py-4 text-[15px] font-medium tracking-[-0.01em] text-[var(--ds-brand-red)]"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-7">
        <label
          className="block text-[20px] font-semibold tracking-[-0.02em] text-black"
          htmlFor="login-email"
        >
          Email
        </label>
        <Input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="-mt-2 h-16 rounded-[1.75rem] border-black/10 bg-white px-8 text-[16px] shadow-none focus-visible:border-black focus-visible:ring-black/12"
        />

        <label
          className="block text-[20px] font-semibold tracking-[-0.02em] text-black"
          htmlFor="login-password"
        >
          Password
        </label>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="-mt-2 h-16 rounded-[1.75rem] border-black/10 bg-white px-8 text-[16px] shadow-none focus-visible:border-black focus-visible:ring-black/12"
        />

        <Button
          type="submit"
          disabled={loading}
          variant="primary"
          size="lg"
          className="mt-2 h-18 w-full rounded-[1.75rem] text-[20px] font-semibold"
        >
          {loading ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </div>
  )
}
