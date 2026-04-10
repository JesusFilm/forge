"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogIn } from "lucide-react"
import { cn } from "@/lib/cn"

export function LoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isPending, setIsPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsPending(true)

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        setError("Invalid password")
        return
      }

      router.push("/")
      router.refresh()
    } catch {
      setError("Something went wrong")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={cn(
            "w-full rounded-xl border border-neutral-200 px-4 py-2.5",
            "text-sm outline-none transition",
            "focus:border-primary-300 focus:ring-2 focus:ring-primary-100",
          )}
          autoFocus
        />
        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      </div>
      <button
        type="submit"
        disabled={isPending || !password}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5",
          "bg-primary-500 text-sm font-medium text-white",
          "transition hover:bg-primary-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <LogIn className="h-4 w-4" />
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  )
}
