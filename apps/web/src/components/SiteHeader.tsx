import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { SearchToggle } from "./SearchToggle"

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 bg-stone-900/80 backdrop-blur-sm">
      <div
        className={`${CONTENT_WIDTH_CLASSES} flex h-full items-center justify-between`}
      >
        <Link
          href={"/" as Route}
          className="flex items-center"
          data-testid="logo"
        >
          <Image
            src="/watch/images/jesusfilm-sign.svg"
            alt="JesusFilm"
            width={32}
            height={24}
            unoptimized
          />
        </Link>

        <SearchToggle />
      </div>
    </header>
  )
}
