// Token persistence and refresh for the TV device grant (feat-322 U4.3/U4.4).
//
// Storage is expo-secure-store (the platform keychain), not AsyncStorage: these
// are bearer credentials with a weeks-long lifetime, and AsyncStorage is plain
// files. Everything here is best-effort at the STORAGE layer and strict at the
// TOKEN layer — a keychain hiccup must not crash the app, but a token we cannot
// prove is valid must never be handed to a caller.

import * as SecureStore from "expo-secure-store"

import type { DeviceTokens } from "./deviceGrantClient"

const ACCESS_TOKEN_KEY = "forge.tv.auth.access_token"
const REFRESH_TOKEN_KEY = "forge.tv.auth.refresh_token"
const EXPIRES_AT_KEY = "forge.tv.auth.expires_at"

/**
 * Refresh this long before the access token actually expires.
 *
 * A TV is often mid-playback when the token turns over; refreshing at the
 * boundary would let a request in flight lose the race. Sixty seconds is
 * comfortably longer than the request timeout.
 */
export const REFRESH_SKEW_MS = 60_000

export type StoredSession = {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
}

async function setOrDelete(key: string, value: string | null): Promise<void> {
  if (value == null) {
    await SecureStore.deleteItemAsync(key)
    return
  }
  await SecureStore.setItemAsync(key, value)
}

/**
 * Persist a freshly issued or refreshed session.
 *
 * Order matters and is the point of this function: the NEW tokens are written
 * before anything discards the old ones. A crash between "server rotated the
 * refresh token" and "device persisted it" otherwise leaves the TV holding a
 * token the server has already invalidated, which reads to the viewer as a
 * spontaneous sign-out.
 */
export async function saveSession(tokens: DeviceTokens): Promise<void> {
  const expiresAtMs =
    tokens.expiresInSeconds != null
      ? Date.now() + tokens.expiresInSeconds * 1000
      : null

  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken)
  await setOrDelete(REFRESH_TOKEN_KEY, tokens.refreshToken ?? null)
  await setOrDelete(
    EXPIRES_AT_KEY,
    expiresAtMs != null ? String(expiresAtMs) : null,
  )
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY)
    if (!accessToken) return null
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
    const rawExpiry = await SecureStore.getItemAsync(EXPIRES_AT_KEY)
    const parsed = rawExpiry != null ? Number(rawExpiry) : Number.NaN
    return {
      accessToken,
      refreshToken,
      expiresAtMs: Number.isFinite(parsed) ? parsed : null,
    }
  } catch {
    // Keychain unavailable — indistinguishable from signed out, and treating
    // it as signed out is the safe direction.
    return null
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY)
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
    await SecureStore.deleteItemAsync(EXPIRES_AT_KEY)
  } catch {
    // Best effort. The caller has already dropped its in-memory copy.
  }
}

/** Whether the stored access token needs refreshing before its next use. */
export function needsRefresh(
  session: StoredSession | null,
  nowMs: number,
): boolean {
  if (session == null) return false
  if (session.refreshToken == null) return false
  if (session.expiresAtMs == null) return false
  return nowMs >= session.expiresAtMs - REFRESH_SKEW_MS
}
