import { ArrowLeft, Clapperboard } from "lucide-react"
import { useTranslations } from "next-intl"

import { LanguageGlobeSection } from "@/components/sections/LanguageGlobeSection"
import { languagesIndexPath, searchPath } from "@/lib/routes"
import { watchMainContentTargetProps } from "@/lib/watch-main-content"

// `ownsMainTarget` is for the root not-found only, which renders outside
// WatchChromeShell and so has no shell wrapper carrying the skip-link target.
export function WatchNotFound({
  ownsMainTarget = false,
}: {
  ownsMainTarget?: boolean
}) {
  const t = useTranslations("WatchNotFound")
  const languageT = useTranslations("WatchLanguageIndex")

  return (
    <main
      {...(ownsMainTarget ? watchMainContentTargetProps : {})}
      className="min-h-svh overflow-x-hidden overflow-y-auto bg-black"
    >
      <LanguageGlobeSection
        actions={[
          {
            href: searchPath(),
            icon: <ArrowLeft aria-hidden="true" className="h-5 w-5 shrink-0" />,
            label: t("backToWatch"),
          },
          {
            href: languagesIndexPath(),
            icon: (
              <Clapperboard aria-hidden="true" className="h-5 w-5 shrink-0" />
            ),
            label: t("browseVideos"),
            variant: "secondary",
          },
        ]}
        actionsLabel={t("actionsLabel")}
        description={t("languageDescription")}
        eyebrow={t("eyebrow")}
        headingId="watch-not-found-heading"
        headingLevel="h1"
        title={
          <>
            <span className="sr-only">{t("screenReaderPrefix")} </span>
            {t("title")}
          </>
        }
        variant="not-found"
        watermark={
          <span aria-hidden="true" data-testid="watch-not-found-code">
            404
          </span>
        }
      >
        <p>{languageT("description")}</p>
      </LanguageGlobeSection>
    </main>
  )
}
