import "server-only"

import { config } from "./config"

export async function verifyTurnstile(token: string): Promise<boolean> {
  const { TURNSTILE_SECRET_KEY: secret, TURNSTILE_HOSTNAMES: hostnames } =
    config()
  if (!secret) return process.env.NODE_ENV === "development"
  const allowedHostnames = new Set(
    (hostnames ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  )
  if (!token || token.length > 2048 || !allowedHostnames.size) return false
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
      result.success === true &&
      "action" in result &&
      result.action === "tv_feedback" &&
      "hostname" in result &&
      typeof result.hostname === "string" &&
      allowedHostnames.has(result.hostname)
    )
  } catch {
    return false
  }
}
