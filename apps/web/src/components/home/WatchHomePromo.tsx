import { Clapperboard, Globe2, UsersRound } from "lucide-react"
import { BetaTesterTrigger } from "@/components/watch/BetaTesterModalProvider"
import { useTranslations } from "next-intl"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

const defaultPoints = [
  {
    Icon: Globe2,
    titleKey: "translatedLibraryTitle",
    descriptionKey: "translatedLibraryDescription",
  },
  {
    Icon: Clapperboard,
    titleKey: "trustedVoicesTitle",
    descriptionKey: "trustedVoicesDescription",
  },
  {
    Icon: UsersRound,
    titleKey: "missionTeamTitle",
    descriptionKey: "missionTeamDescription",
  },
] as const

const defaultHighlights = [
  {
    titleKey: "nextStepsTitle",
    descriptionKey: "nextStepsDescription",
  },
  {
    titleKey: "mediaLibraryTitle",
    descriptionKey: "mediaLibraryDescription",
  },
  {
    titleKey: "ministryToolsTitle",
    descriptionKey: "ministryToolsDescription",
  },
] as const

export function WatchHomePromo() {
  const t = useTranslations("WatchHomePromo")

  return (
    <section className="relative overflow-hidden bg-[linear-gradient(135deg,rgba(69,10,29,0.6),rgba(88,28,135,0.2),rgba(234,88,12,0.1))] py-[4.5rem] text-white">
      <div className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-45 mix-blend-multiply" />
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className="flex flex-col gap-14">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm sm:text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase">
              {t("eyebrow")}
            </p>
            <h2 className="text-3xl leading-tight font-semibold tracking-normal text-white sm:text-4xl lg:text-5xl">
              {t("title")}
            </h2>
            <p className="text-lg leading-8 text-white/80 lg:text-xl">
              {t("description")}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {defaultPoints.map((point) => {
              const Icon = point.Icon
              return (
                <article
                  key={point.titleKey}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-colors duration-300 hover:bg-white/10"
                >
                  <Icon
                    className="h-20 w-20 text-white/20 mix-blend-overlay"
                    aria-hidden
                  />
                  <h3 className="mt-6 text-xl font-semibold text-white">
                    {t(point.titleKey)}
                  </h3>
                  <p className="mt-3 text-base sm:text-sm leading-relaxed text-white/70">
                    {t(point.descriptionKey)}
                  </p>
                </article>
              )
            })}
          </div>

          <div className="space-y-6">
            <p className="text-lg text-white/80 lg:text-xl">
              {t("buildingNext")}
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              {defaultHighlights.map((highlight) => (
                <article
                  key={highlight.titleKey}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-stone-950/20 p-6 transition-colors duration-300 hover:border-white/20 hover:bg-stone-900/60"
                >
                  <h3 className="text-lg font-semibold text-white">
                    {t(highlight.titleKey)}
                  </h3>
                  <p className="mt-3 text-base sm:text-sm leading-relaxed text-white/70">
                    {t(highlight.descriptionKey)}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-12 mb-16 text-center">
            <p className="mb-4 text-sm sm:text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase">
              {t("invitationEyebrow")}
            </p>
            <h3 className="mb-4 text-3xl font-semibold text-white">
              {t.rich("invitationTitle", {
                highlight: (chunks) => (
                  <span className="bg-gradient-to-r from-purple-400 via-blue-500 to-pink-500 bg-clip-text text-transparent">
                    {chunks}
                  </span>
                ),
              })}
            </h3>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80 lg:text-xl">
              {t("invitationDescription")}
            </p>
            <BetaTesterTrigger className="inline-flex h-12 items-center justify-center rounded-md bg-white px-10 py-3 text-base font-medium text-black transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {t("betaTester")}
            </BetaTesterTrigger>
          </div>
        </div>
      </div>
    </section>
  )
}
