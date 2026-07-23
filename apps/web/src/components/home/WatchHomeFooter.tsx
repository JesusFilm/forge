import Image from "next/image"
import { useTranslations } from "next-intl"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

const navLinks = [
  { key: "share", href: "https://www.jesusfilm.org/partners/share/" },
  { key: "watch", href: "https://www.jesusfilm.org/watch/" },
  { key: "giving", href: "https://www.jesusfilm.org/give/" },
  { key: "about", href: "https://www.jesusfilm.org/about/" },
  { key: "products", href: "https://www.jesusfilm.org/products/" },
  {
    key: "resources",
    href: "https://www.jesusfilm.org/partners/resources/",
  },
  { key: "partners", href: "https://www.jesusfilm.org/partners/" },
  { key: "contact", href: "https://www.jesusfilm.org/contact/" },
] as const

const giveNowHref =
  "https://www.jesusfilm.org/how-to-help/ways-to-donate/give-now/?amount=&frequency=single&campaign-code=NXWJPO&designation-number=2592320&thankYouRedirect=/dev/special/thank-you-refer/social-share/"

export function WatchHomeFooter() {
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
            className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-bold xl:justify-end"
          >
            {navLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className="transition-colors hover:text-[#cb333b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
              >
                {t(link.key)}
              </a>
            ))}
            <a
              href={giveNowHref}
              className="inline-flex h-9 items-center rounded-full bg-[#d33a43] px-5 text-sm font-bold text-white transition-colors hover:bg-[#b62d35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b] focus-visible:ring-offset-2"
            >
              {t("giveNow")}
            </a>
          </nav>
        </div>

        <div
          data-testid="watch-footer-contact-grid"
          className="grid max-w-[410px] grid-cols-3 break-words text-xs leading-tight text-[#131111]"
        >
          <p className="min-w-0 max-w-[130px] border-e border-[#d9d9d9] pe-3 sm:pe-5">
            100 Lake Hart Drive
            <br />
            Orlando, FL, 32832
            <br />
            <span className="text-[#9a9a9a]">
              {t("resourcesVersion", { version: "fea8f46" })}
            </span>
          </p>
          <p className="min-w-0 max-w-[140px] border-e border-[#d9d9d9] px-3 sm:px-5">
            {t("office")}: (407) 826-2300
            <br />
            {t("fax")}: (407) 826-2375
          </p>
          <p className="min-w-0 max-w-[140px] ps-3 sm:px-5">
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
