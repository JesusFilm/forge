import Image from "next/image"
import { useTranslations } from "next-intl"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { WatchIntroductionReplayButton } from "@/components/watch/WatchIntroductionReplayButton"

const navLinks = [
  { key: "share", href: "https://www.jesusfilm.org/partners/share/" },
  { key: "watch", href: "https://www.jesusfilm.org/watch/" },
  { key: "giving", href: "https://www.jesusfilm.org/give/" },
  { key: "about", href: "https://www.jesusfilm.org/about/" },
  {
    key: "resources",
    href: "https://www.jesusfilm.org/partners/resources/",
  },
  { key: "partners", href: "https://www.jesusfilm.org/partners/" },
  { key: "contact", href: "https://www.jesusfilm.org/contact/" },
] as const

const giveNowHref =
  "https://www.jesusfilm.org/how-to-help/ways-to-donate/give-now/?amount=&frequency=single&campaign-code=NXWJPO&designation-number=2592320&thankYouRedirect=/dev/special/thank-you-refer/social-share/"

export function WatchHomeFooter({
  showIntroductionReplay = false,
}: {
  showIntroductionReplay?: boolean
}) {
  const t = useTranslations("WatchFooter")

  return [
    <footer
      key="footer"
      data-testid="watch-home-footer"
      className="relative z-20 bg-white py-10 text-[#131111]"
    >
      <div className={`${WATCH_PAGE_CONTENT_CLASSES} flex flex-col gap-8`}>
        <div className="grid gap-8 lg:grid-cols-[160px_minmax(0,1fr)] lg:items-center xl:grid-cols-[340px_minmax(0,1fr)]">
          <a
            href="https://www.jesusfilm.org/"
            aria-label={t("home")}
            className="block w-fit"
          >
            <Image
              src="/watch/images/footer/jesus-film-logo.png"
              alt="Jesus Film"
              width={60}
              height={60}
              unoptimized
              className="h-[60px] w-[60px]"
            />
          </a>

          <nav
            aria-label={t("navigation")}
            data-testid="watch-footer-navigation"
            className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 text-sm font-bold md:flex-nowrap md:justify-between md:gap-x-0"
          >
            {navLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className="min-w-0 break-words text-center leading-tight transition-colors hover:text-[#cb333b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
              >
                {t(link.key)}
              </a>
            ))}
            <a
              href={giveNowHref}
              className="inline-flex min-h-9 min-w-0 break-words items-center rounded-full bg-[#d33a43] px-5 py-2 text-center text-sm font-bold leading-tight text-white transition-colors hover:bg-[#b62d35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b] focus-visible:ring-offset-2"
            >
              {t("giveNow")}
            </a>
          </nav>
        </div>

        <div
          data-testid="watch-footer-contact-grid"
          className="grid w-full grid-cols-3 break-words text-xs leading-tight text-[#131111]"
        >
          <p className="min-w-0">
            100 Lake Hart Drive
            <br />
            Orlando, FL, 32832
          </p>
          <p className="min-w-0">
            {t("office")}: (407) 826-2300
            <br />
            {t("fax")}: (407) 826-2375
          </p>
          <p className="min-w-0">
            <a
              href="https://www.jesusfilm.org/privacy/"
              className="block hover:text-[#cb333b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
            >
              {t("privacyPolicy")}
            </a>
            <a
              href="https://www.jesusfilm.org/legal/"
              className="block hover:text-[#cb333b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
            >
              {t("legalStatement")}
            </a>
          </p>
        </div>
        {showIntroductionReplay ? (
          <div className="flex justify-start border-t border-[#dedbd7] pt-6">
            <WatchIntroductionReplayButton />
          </div>
        ) : null}
      </div>
    </footer>,
    <aside
      key="ai-attribution-notice"
      aria-labelledby="watch-ai-attribution-heading"
      data-testid="watch-ai-attribution-notice"
      className="relative z-20 border-t border-[#e9e6e1] bg-[#f8f7f5] py-4 text-[#76716b]"
    >
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <h2 id="watch-ai-attribution-heading" className="sr-only">
          {t("aiAttributionHeading")}
        </h2>
        <p className="max-w-5xl text-[11px] leading-5">
          {t.rich("aiAttributionBody", {
            terms: (chunks) => (
              <a
                href="https://www.jesusfilm.org/terms/"
                className="font-medium text-[#69645f] underline decoration-[#b8b2ab] underline-offset-2 transition-colors hover:text-[#3f3b38] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8d8780]"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
    </aside>,
  ]
}
