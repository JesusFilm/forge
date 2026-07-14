import { useTranslations } from "next-intl"

import { SpinnerIcon } from "@/components/ui/spinner"

export default function LanguageVideosLoading() {
  const t = useTranslations("ExperienceSkeleton")

  return (
    <div className="min-h-screen bg-black px-4 pt-[calc(7rem+env(safe-area-inset-top,0px))] pb-8 text-stone-100 sm:px-6 md:px-8 md:pt-[calc(8rem+env(safe-area-inset-top,0px))]">
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label={t("loadingContent")}
        className="mx-auto flex min-h-64 w-full max-w-[112rem] items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-stone-300"
      >
        <SpinnerIcon className="size-5 animate-spin text-amber-200" />
        <span>{t("loadingContent")}…</span>
      </div>
    </div>
  )
}
