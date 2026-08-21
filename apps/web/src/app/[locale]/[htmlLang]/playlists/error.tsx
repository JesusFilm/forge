"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"

export default function UserPlaylistError({ reset }: { reset: () => void }) {
  const t = useTranslations("UserPlaylists")
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="min-h-screen bg-[#050505] pt-24 text-white">
      <section
        role="alert"
        className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6"
      >
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight sm:text-5xl"
        >
          {t("loadErrorTitle")}
        </h1>
        <p className="mt-4 leading-7 text-stone-300">{t("loadErrorBody")}</p>
        <button
          type="button"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
          onClick={reset}
        >
          {t("retry")}
        </button>
      </section>
    </main>
  )
}
