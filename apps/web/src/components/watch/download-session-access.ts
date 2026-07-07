"use client"

import { checkDownloadSession } from "@/components/watch/download-session-client"

export type DownloadSessionAccess =
  | { ok: true }
  | { ok: false; reason: "session-unavailable" }
  | { ok: false; reason: "auth-required"; loginUrl: string }

export async function resolveDownloadSessionAccess(): Promise<DownloadSessionAccess> {
  const session = await checkDownloadSession()
  if (!session.ok) return { ok: false, reason: "session-unavailable" }
  if (!session.authenticated) {
    if (!session.loginUrl) return { ok: false, reason: "session-unavailable" }
    return { ok: false, reason: "auth-required", loginUrl: session.loginUrl }
  }
  return { ok: true }
}
