"use client"

/**
 * U5 — Stable per-browser viewer identifier for Mux Data attribution on the
 * watch page.
 *
 * Stored in `localStorage` under `forge.viewer_id`. Generated lazily on first
 * call. Per the watch-page Key Decision (R-mux-data), Mux Player runs with
 * `disableCookies={true}` and uses this localStorage UUID as
 * `metadata.viewer_user_id` so we get cross-session attribution without
 * dropping a Mux third-party cookie.
 *
 * SSR contract: returns the empty string when called server-side. Callers in
 * client components should call this inside `useEffect` (or after a user
 * interaction) so the SSR pass never sees a placeholder ID. The empty-string
 * sentinel is intentional — Mux Data will simply skip the attribution field
 * if it's empty rather than fingerprinting an anonymous viewer.
 *
 * Private-browsing fallback: when `localStorage` is unavailable or throws
 * (Safari private mode quota error, restrictive CSP, etc.), we return a fresh
 * UUID per call. The viewer is then tracked as a different user across page
 * loads — acceptable degradation for an analytics signal.
 */

const VIEWER_ID_STORAGE_KEY = "forge.viewer_id"
let volatileViewerId: string | null = null

export function getViewerId(): string {
  // SSR guard — `localStorage` and `crypto.randomUUID` are not available on
  // the server. Caller should re-invoke after hydration.
  if (typeof window === "undefined") return ""

  try {
    const stored = window.localStorage.getItem(VIEWER_ID_STORAGE_KEY)
    if (stored) return stored
    const fresh = crypto.randomUUID()
    window.localStorage.setItem(VIEWER_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Private browsing / disabled storage / quota errors — fall back to a
    // page-session in-memory UUID so Mux Data still receives a stable
    // non-empty value without persisting anything cross-page.
    volatileViewerId ??= crypto.randomUUID()
    return volatileViewerId
  }
}
