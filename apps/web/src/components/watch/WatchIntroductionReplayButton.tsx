"use client"

import { useCallback, useEffect, useRef } from "react"
import { useLocale, useTranslations } from "next-intl"

import { useOptionalWatchIntroduction } from "@/components/watch/WatchIntroductionProvider"
import { WATCH_MODAL_CLOSE_DELAY_MS } from "@/components/watch/WatchModalActivityProvider"
import { isWatchIntroductionLocaleEligible } from "@/lib/watch-introduction-preference"

export function WatchIntroductionReplayButton() {
  const t = useTranslations("WatchIntroductionTour")
  const locale = useLocale()
  const introduction = useOptionalWatchIntroduction()
  const eligible =
    introduction != null && isWatchIntroductionLocaleEligible(locale)
  const registerReplayTrigger = introduction?.registerReplayTrigger
  const buttonRef = useRef<HTMLButtonElement>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!eligible || !registerReplayTrigger) return
    registerReplayTrigger(buttonRef.current)
    return () => registerReplayTrigger(null)
  }, [eligible, registerReplayTrigger])

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    },
    [],
  )

  const replay = useCallback(() => {
    const trigger = buttonRef.current
    if (!trigger || !introduction || introduction.replay(trigger)) return

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      if (trigger.isConnected) introduction.replay(trigger)
    }, WATCH_MODAL_CLOSE_DELAY_MS)
  }, [introduction])

  if (!eligible) return null

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="watch-introduction-replay"
      onClick={replay}
      className="min-h-11 rounded-full border border-[#d33a43] px-5 py-2 text-sm font-bold text-[#b62d35] transition-colors hover:bg-[#d33a43] hover:text-white focus-visible:ring-2 focus-visible:ring-[#cb333b] focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {t("replay")}
    </button>
  )
}
