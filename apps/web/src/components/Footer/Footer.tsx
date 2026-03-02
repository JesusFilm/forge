import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"

const JESUS_FILM = "https://www.jesusfilm.org"

const SOCIAL = [
  {
    href: "https://x.com/jesusfilm",
    label: "X (Twitter)",
    src: "/x-twitter.svg",
  },
  {
    href: "https://www.facebook.com/jesusfilm",
    label: "Facebook",
    src: "/facebook.svg",
  },
  {
    href: "https://www.instagram.com/jesusfilm",
    label: "Instagram",
    src: "/instagram.svg",
  },
  {
    href: "https://www.youtube.com/jesusfilm",
    label: "YouTube",
    src: "/youtube.svg",
  },
] as const

const NAV_LINKS = [
  { label: "Share", href: `${JESUS_FILM}/share/` },
  { label: "Watch", href: `${JESUS_FILM}/watch/` },
  { label: "Giving", href: `${JESUS_FILM}/give/` },
  { label: "About", href: `${JESUS_FILM}/about/` },
  { label: "Products", href: `${JESUS_FILM}/products/` },
  { label: "Resources", href: `${JESUS_FILM}/resources/` },
  { label: "Partners", href: `${JESUS_FILM}/partners/` },
  { label: "Contact", href: `${JESUS_FILM}/contact/` },
] as const

export function Footer() {
  return (
    <footer
      className="w-full border-t border-neutral-300 bg-white text-neutral-800"
      data-theme="light"
    >
      <div className="mx-auto max-w-6xl px-4">
        {/* Top row: logo, social, nav links, Give Now */}
        <div className="flex flex-wrap items-center gap-6 py-6">
          <Link
            href={JESUS_FILM}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <Image
              src="/jesusfilm-sign.svg"
              alt="Jesus Film Project"
              width={49}
              height={36}
              className="h-9 w-auto"
            />
          </Link>
          <div className="flex items-center gap-3">
            {SOCIAL.map(({ href, label, src }) => (
              <Link
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-700 hover:text-neutral-900"
                aria-label={label}
              >
                <Image
                  src={src}
                  alt=""
                  width={24}
                  height={24}
                  className="size-6"
                />
              </Link>
            ))}
          </div>
          <nav
            className="flex flex-wrap items-center gap-4"
            aria-label="Footer navigation"
          >
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-neutral-800 hover:underline"
              >
                {label}
              </Link>
            ))}
          </nav>
          <Button
            asChild
            className="ml-auto shrink-0 rounded-lg bg-[color:var(--color-brand-red)] px-5 hover:bg-[color:var(--color-brand-red-hover)]"
          >
            <Link
              href={`${JESUS_FILM}/give/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Give Now
            </Link>
          </Button>
        </div>

        {/* Bottom row: address, phone, legal | Newsletter */}
        <div className="flex flex-wrap items-start justify-between gap-6 border-t border-neutral-200 py-6">
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-sm text-neutral-800">100 Lake Hart Drive</p>
              <p className="text-sm text-neutral-800">Orlando, FL, 32832</p>
            </div>
            <div className="border-l border-neutral-200 pl-8">
              <p className="text-sm text-neutral-800">Office: (407) 826-2300</p>
              <p className="text-sm text-neutral-800">Fax: (407) 826-2375</p>
            </div>
            <div className="border-l border-neutral-200 pl-8">
              <Link
                href={`${JESUS_FILM}/privacy/`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-neutral-800 hover:underline"
              >
                Privacy Policy
              </Link>
              <Link
                href={`${JESUS_FILM}/legal/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-sm text-neutral-800 hover:underline"
              >
                Legal Statement
              </Link>
            </div>
          </div>
          <Button
            asChild
            variant="secondary"
            className="shrink-0 rounded-lg px-5"
          >
            <Link
              href={`${JESUS_FILM}/newsletter/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sign Up For Our Newsletter
            </Link>
          </Button>
        </div>
      </div>
    </footer>
  )
}
