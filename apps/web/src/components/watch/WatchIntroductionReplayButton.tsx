"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"

import { useOptionalWatchIntroduction } from "@/components/watch/WatchIntroductionProvider"

export function WatchIntroductionReplayButton() {
  const t = useTranslations("WatchIntroductionTour")
  const introduction = useOptionalWatchIntroduction()
  const registerReplayTrigger = introduction?.registerReplayTrigger
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!registerReplayTrigger) return
    registerReplayTrigger(buttonRef.current)
    return () => registerReplayTrigger(null)
  }, [registerReplayTrigger])

  if (!introduction) return null

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="watch-introduction-replay"
      onClick={(event) => introduction.replay(event.currentTarget)}
      className="min-h-11 rounded-full border border-[#d33a43] px-5 py-2 text-sm font-bold text-[#b62d35] transition-colors hover:bg-[#d33a43] hover:text-white focus-visible:ring-2 focus-visible:ring-[#cb333b] focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {t("replay")}
    </button>
  )
}
