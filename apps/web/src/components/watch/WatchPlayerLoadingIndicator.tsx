import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

export function WatchPlayerLoadingIndicator({
  className,
}: {
  className?: string
}) {
  const t = useTranslations("ExperienceSkeleton")

  return (
    <div
      data-testid="watch-player-loading-indicator"
      className={cn(
        "relative flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white shadow-[0_18px_52px_rgba(0,0,0,0.45)] ring-1 ring-white/15 backdrop-blur-md",
        className,
      )}
      role="status"
      aria-label={t("loadingVideo")}
    >
      <span
        aria-hidden="true"
        className="h-10 w-10 rounded-full border-4 border-white/20 border-t-white/95 motion-safe:animate-spin"
      />
      <span className="sr-only">{t("loadingVideo")}</span>
    </div>
  )
}
