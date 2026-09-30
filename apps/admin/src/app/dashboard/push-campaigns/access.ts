import { redirect } from "next/navigation"

import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"

/**
 * R28 — the campaign pages and actions sit at the viewer tier behind one key.
 * A principal without it goes back to the dashboard root, never to a refusal.
 */
export async function requirePushPrincipal(): Promise<
  Awaited<ReturnType<typeof requireSession>>
> {
  const principal = await requireSession()
  if (!hasPermission(principal, "write:push-campaigns")) {
    redirect("/dashboard")
  }
  return principal
}
