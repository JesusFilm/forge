"use client"

import { useState, useEffect } from "react"
import type { FragmentOf } from "@forge/graphql"
import { HDate, months } from "@hebcal/hdate"
import { easterDatesFragment } from "./easterDatesFragment"

export { easterDatesFragment }

function calculateWesternEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function calculateOrthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  const julianDate = new Date(year, month - 1, day)
  return new Date(julianDate.getTime() + 13 * 24 * 60 * 60 * 1000)
}

function calculatePassover(year: number): Date {
  const hebYear = new HDate(new Date(year, 3, 1)).getFullYear()
  return new HDate(15, months.NISAN, hebYear).greg()
}

type EasterDatesProps = {
  data: FragmentOf<typeof easterDatesFragment>
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
}

export function EasterDates({ data }: EasterDatesProps) {
  const {
    easterDatesTitle,
    westernEasterLabel,
    orthodoxEasterLabel,
    passoverLabel,
    locale = "en-US",
  } = data

  const currentYear = new Date().getFullYear()
  const westernEaster = calculateWesternEaster(currentYear)
  const orthodoxEaster = calculateOrthodoxEaster(currentYear)
  const passover = calculatePassover(currentYear)

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale ?? "en-US", DATE_OPTIONS)

  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    const handler = () => setExpanded(mq.matches)
    handler()
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const title = (easterDatesTitle ?? "").replace("{year}", String(currentYear))

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-gradient-to-tr from-blue-400 via-amber-500 to-red-600 bg-blend-multiply shadow-lg"
      data-testid="EasterDates"
    >
      <div
        className="absolute inset-0 bg-gradient-to-br from-yellow-400/40 via-amber-500/40 to-red-500/40 blur-xl"
        style={{ mixBlendMode: "overlay" }}
      />
      <div
        className="absolute inset-0 opacity-50 mix-blend-overlay brightness-100 contrast-150"
        style={{
          backgroundImage: `url(https://grainy-gradients.vercel.app/noise.svg)`,
        }}
      />
      <div className="relative z-10">
        <div className="p-6">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={expanded}
            aria-controls="easter-dates-content"
            id="easter-dates-header"
          >
            <h4 className="text-2xl font-bold text-black/85 xl:text-3xl">
              {title}
            </h4>
            <span
              className="text-black/70 transition-transform"
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
          <div id="easter-dates-content">
            {expanded && (
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-lg font-medium text-black/50 mix-blend-multiply">
                    {westernEasterLabel}
                  </h3>
                  <p className="text-5xl font-extrabold tracking-tighter text-black/85 mix-blend-multiply">
                    {formatDate(westernEaster)}
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-black/50 mix-blend-multiply">
                    {orthodoxEasterLabel}
                  </h3>
                  <p className="text-xl font-extrabold text-black/75 mix-blend-multiply">
                    {formatDate(orthodoxEaster)}
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-black/50 mix-blend-multiply">
                    {passoverLabel}
                  </h3>
                  <p className="text-xl font-extrabold text-black/75 mix-blend-multiply">
                    {formatDate(passover)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
