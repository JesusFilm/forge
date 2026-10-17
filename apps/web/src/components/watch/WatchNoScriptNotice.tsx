import { useTranslations } from "next-intl"

/**
 * Explains the player/search requirement before streamed page content.
 * Header clearance matches FloatingSearchProvider's responsive hover envelope
 * and exists only inside noscript. Translated copy keeps its intrinsic height
 * in normal flow, above media backdrops and below the fixed header.
 * Browsers with JavaScript on never lay out or paint this content.
 */
export function WatchNoScriptNotice() {
  const t = useTranslations("WatchNoScript")
  return (
    <noscript>
      <div className="relative z-10 pt-[calc(5.5rem+env(safe-area-inset-top,0px))] md:pt-[calc(9rem+env(safe-area-inset-top,0px))] compact-landscape:pt-[calc(4.25rem+env(safe-area-inset-top,0px))]">
        <p
          data-testid="watch-noscript-notice"
          className="border-t border-white/10 bg-stone-900 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-center text-base text-stone-100 sm:text-sm"
        >
          {t("message")}
        </p>
      </div>
    </noscript>
  )
}
