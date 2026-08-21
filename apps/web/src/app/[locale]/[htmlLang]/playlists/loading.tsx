"use client"

import { useTranslations } from "next-intl"

export default function UserPlaylistLoading() {
  const t = useTranslations("UserPlaylists")
  return (
    <main
      aria-busy="true"
      aria-label={t("loadingLabel")}
      className="min-h-screen bg-[#050505] pt-24 text-white"
    >
      <div className="mx-auto max-w-6xl animate-pulse px-4 py-10 sm:px-6 sm:py-14">
        <div className="h-4 w-40 rounded bg-stone-800" />
        <div className="mt-4 h-12 w-72 max-w-full rounded bg-stone-800" />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-52 rounded-2xl border border-white/10 bg-stone-900"
            />
          ))}
        </div>
        <span className="sr-only">{t("loadingText")}</span>
      </div>
    </main>
  )
}
