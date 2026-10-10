/** Prevent stored CTA content from reviving the retired Watch beta program. */
export function isRetiredWatchBetaSignupUrl(
  value: string | null | undefined,
): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname === "mailchi.mp" &&
      url.pathname.replace(/\/+$/, "") === "/jesusfilm/beta"
    )
  } catch {
    return false
  }
}
