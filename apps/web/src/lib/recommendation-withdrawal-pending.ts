export const RECOMMENDATION_WITHDRAWAL_PENDING_COOKIE =
  "forge_recommendation_withdrawal_pending" as const

const WITHDRAWAL_PENDING_VALUE = "1"
const WITHDRAWAL_PENDING_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

function hasWithdrawalPendingCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=")
    const name = (separator === -1 ? part : part.slice(0, separator)).trim()
    return name === RECOMMENDATION_WITHDRAWAL_PENDING_COOKIE
  })
}

export function requestHasRecommendationWithdrawalPending(
  request: Request,
): boolean {
  return hasWithdrawalPendingCookie(request.headers.get("cookie"))
}

export function isRecommendationWithdrawalPending(): boolean {
  return typeof document !== "undefined"
    ? hasWithdrawalPendingCookie(document.cookie)
    : false
}

export function markRecommendationWithdrawalPending(): void {
  if (typeof document === "undefined") return
  const secure = window.location.protocol === "https:" ? "; secure" : ""
  document.cookie = `${RECOMMENDATION_WITHDRAWAL_PENDING_COOKIE}=${WITHDRAWAL_PENDING_VALUE}; path=/; max-age=${WITHDRAWAL_PENDING_MAX_AGE_SECONDS}; samesite=lax${secure}`
}

export function clearRecommendationWithdrawalPending(): void {
  if (typeof document === "undefined") return
  const secure = window.location.protocol === "https:" ? "; secure" : ""
  document.cookie = `${RECOMMENDATION_WITHDRAWAL_PENDING_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`
}
