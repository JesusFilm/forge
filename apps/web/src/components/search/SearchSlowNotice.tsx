"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

/**
 * How long a search may stay pending before the overlay tells the visitor it
 * is slow. Well inside the client's whole-request timeout, so the visitor sees
 * this before any failure message.
 */
export const SEARCH_SLOW_NOTICE_DELAY_MS = 4_000

/**
 * True once `pending` has stayed true for `delayMs` without `resetKey`
 * changing. A fast search never renders anything: the timer is cleared before
 * it fires and the state stays false. Cleanup clears the flag, so a result,
 * an error, an abort, a new query, or unmount all hide the notice.
 */
export function useSearchSlowNotice(
  pending: boolean,
  resetKey: string | null,
  delayMs: number = SEARCH_SLOW_NOTICE_DELAY_MS,
): boolean {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setSlow(true), delayMs)
    return () => {
      clearTimeout(timer)
      // A no-op (no re-render) unless the notice is showing.
      setSlow(false)
    }
  }, [pending, resetKey, delayMs])

  return pending && slow
}

type SearchSlowNoticeProps = {
  pending: boolean
  resetKey: string | null
}

export function SearchSlowNotice({ pending, resetKey }: SearchSlowNoticeProps) {
  const t = useTranslations("SearchOverlay")
  const slow = useSearchSlowNotice(pending, resetKey)
  if (!slow) return null
  return (
    <p
      data-testid="search-overlay-slow-notice"
      className="mb-4 text-center text-base text-stone-300 sm:text-sm"
    >
      {t("slowSearch")}
    </p>
  )
}
