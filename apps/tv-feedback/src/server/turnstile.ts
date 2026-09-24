import "server-only"

import { config } from "./config"

export async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = config().TURNSTILE_SECRET_KEY
  if (!secret) return process.env.NODE_ENV === "development"
  if (!token || token.length > 2048) return false
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    )
    const result: unknown = await response.json()
    return (
      response.ok &&
      typeof result === "object" &&
      result !== null &&
      "success" in result &&
      result.success === true
    )
  } catch {
    return false
  }
}
