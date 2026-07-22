import Image from "next/image"
import { useTranslations } from "next-intl"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

const socialLinks = [
  {
    label: "X",
    href: "https://twitter.com/jesusfilm",
    icon: "/watch/images/footer/x-twitter.svg",
  },
  {
    label: "Facebook",
    href: "https://www.facebook.com/jesusfilm",
    icon: "/watch/images/footer/facebook.svg",
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/jesusfilm",
    icon: "/watch/images/footer/instagram.svg",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/user/jesusfilm",
    icon: "/watch/images/footer/youtube.svg",
  },
] as const

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

  return (
    <footer
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

          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-end">
            <div className="flex items-center gap-6">
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                  aria-label={link.label}
                  className="inline-flex h-7 w-7 items-center justify-center text-[#3c3c3c] transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b]"
                >
                  <Image
                    src={link.icon}
                    alt=""
                    width={24}
                    height={24}
                    unoptimized
                    aria-hidden
                    className="h-6 w-6"
                  />
                </a>
              ))}
            </div>

            <nav
              aria-label={t("navigation")}
              className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-bold"
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
        </div>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex flex-col gap-5 text-xs leading-tight text-[#131111] sm:flex-row sm:flex-wrap">
            <p className="max-w-[130px] border-[#d9d9d9] sm:border-r sm:pr-5">
              100 Lake Hart Drive
              <br />
              Orlando, FL, 32832
              <br />
              <span className="text-[#9a9a9a]">
                {t("resourcesVersion", { version: "fea8f46" })}
              </span>
            </p>
            <p className="max-w-[140px] border-[#d9d9d9] sm:border-r sm:px-5">
              {t("office")}: (407) 826-2300
              <br />
              {t("fax")}: (407) 826-2375
            </p>
            <p className="max-w-[140px] sm:px-5">
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

          <a
            href="https://www.jesusfilm.org/email/"
            className="inline-flex h-10 w-fit items-center justify-center rounded-full bg-[#333] px-5 text-sm font-bold text-white transition-colors hover:bg-[#1f1f1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cb333b] focus-visible:ring-offset-2"
          >
            {t("newsletter")}
          </a>
        </div>
      </div>
    </footer>
  )
}
