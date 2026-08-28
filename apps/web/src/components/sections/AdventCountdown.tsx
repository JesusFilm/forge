"use client"

import { useState, useEffect, useId } from "react"
import { useTranslations } from "next-intl"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import { adventCountdownFragment } from "@/lib/fragments/advent-countdown"

export { adventCountdownFragment }

function getDaysUntilChristmas(): { days: number; targetYear: number } {
  const now = new Date()
  const currentYear = now.getFullYear()
  const christmas = new Date(currentYear, 11, 25) // Dec 25

  if (now.getMonth() === 11 && now.getDate() === 25) {
    return { days: 0, targetYear: currentYear }
  }

  if (now > christmas) {
    const nextChristmas = new Date(currentYear + 1, 11, 25)
    const diff = nextChristmas.getTime() - now.getTime()
    return {
      days: Math.ceil(diff / (1000 * 60 * 60 * 24)),
      targetYear: currentYear + 1,
    }
  }

  const diff = christmas.getTime() - now.getTime()
  return {
    days: Math.ceil(diff / (1000 * 60 * 60 * 24)),
    targetYear: currentYear,
  }
}

type AdventCountdownProps = {
  data: FragmentOf<typeof adventCountdownFragment>
}

export function AdventCountdown({ data }: AdventCountdownProps) {
  const t = useTranslations("WatchHomeSections")
  const { adventTitle: title, scripture, scriptureReference } = data

  const instanceId = useId()
  const headerId = `advent-countdown-header-${instanceId}`
  const contentId = `advent-countdown-content-${instanceId}`

  const { days, targetYear } = getDaysUntilChristmas()
  const isChristmasDay = days === 0

  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    const handler = () => setExpanded(mq.matches)
    handler()
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const displayTitle = (title ?? "").replace("{year}", String(targetYear))

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-gradient-to-tr from-green-800 via-brand-red to-amber-600 bg-blend-multiply shadow-lg"
      data-testid="AdventCountdown"
    >
      <div
        className="absolute inset-0 bg-gradient-to-br from-green-600/40 via-brand-red/40 to-amber-500/40 blur-xl"
        style={{ mixBlendMode: "overlay" }}
      />
      <div
        className="absolute inset-0 opacity-50 mix-blend-overlay brightness-100 contrast-150"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Cfilter id='n' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeBlend mode='screen'/%3E%3C/filter%3E%3Crect width='500' height='500' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
        }}
      />
      <div className="relative z-10">
        <div className="p-6">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={expanded}
            aria-controls={contentId}
            id={headerId}
          >
            <h4 className="text-2xl font-bold text-white/90 xl:text-3xl">
              {displayTitle}
            </h4>
            <span
              className="text-white/70 transition-transform"
              aria-hidden
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>
          <div id={contentId}>
            {expanded && (
              <div className="space-y-4 pt-4">
                {isChristmasDay ? (
                  <div>
                    <p className="text-5xl font-extrabold tracking-tighter text-white/90">
                      {t("merryChristmas")}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-6xl font-extrabold tracking-tighter text-white/90">
                      {days}
                    </p>
                    <p className="text-lg font-medium text-white/60">
                      {t("daysUntilChristmas", { count: days })}
                    </p>
                  </div>
                )}
                {scripture && (
                  <div className="border-t border-white/20 pt-4">
                    <p className="text-lg leading-relaxed text-white/80 italic">
                      &ldquo;{scripture}&rdquo;
                    </p>
                    {scriptureReference && (
                      <p className="mt-1 text-base sm:text-sm font-medium text-white/50">
                        — {scriptureReference}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
