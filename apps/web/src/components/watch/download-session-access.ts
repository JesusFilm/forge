"use client"

import { checkDownloadSession } from "@/components/watch/download-session-client"

export type DownloadSessionAccess =
  | { ok: true; accountGateEnabled: boolean }
  | { ok: false; reason: "session-unavailable" }
  | {
      ok: false
      accountGateEnabled: true
      reason: "auth-required"
      loginUrl: string
    }

export async function resolveDownloadSessionAccess(): Promise<DownloadSessionAccess> {
  const session = await checkDownloadSession()
  if (!session.ok) return { ok: false, reason: "session-unavailable" }
  if (!session.accountGateEnabled)
    return { ok: true, accountGateEnabled: false }
  if (!session.authenticated) {
    if (!session.loginUrl) return { ok: false, reason: "session-unavailable" }
    return {
      ok: false,
      accountGateEnabled: true,
      reason: "auth-required",
      loginUrl: session.loginUrl,
    }
  }
  return { ok: true, accountGateEnabled: true }
}
