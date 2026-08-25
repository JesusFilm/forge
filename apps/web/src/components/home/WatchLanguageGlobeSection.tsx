import { Languages } from "lucide-react"
import { useTranslations } from "next-intl"

import { LanguageGlobeSection } from "@/components/sections/LanguageGlobeSection"
import { languagesIndexPath } from "@/lib/routes"

export function WatchLanguageGlobeSection() {
  const t = useTranslations("WatchLanguageIndex")
  const languagePickerT = useTranslations("LanguageCombobox")

  return (
    <LanguageGlobeSection
      actions={[
        {
          href: languagesIndexPath(),
          icon: <Languages aria-hidden="true" className="h-5 w-5" />,
          label: languagePickerT("selectLanguage"),
        },
      ]}
      actionsLabel={t("title")}
      deferGlobe
      description={t("description")}
      eyebrow={t("eyebrow")}
      headingId="watch-language-globe-heading"
      sectionKey="watch-language-globe"
      title={t("title")}
    />
  )
}
