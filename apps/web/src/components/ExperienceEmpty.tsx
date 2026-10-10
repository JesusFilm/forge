import { useTranslations } from "next-intl"

export function ExperienceEmpty() {
  const t = useTranslations("ExperienceError")
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center p-8">
      <p className="text-lg text-gray-600">{t("empty")}</p>
    </main>
  )
}
