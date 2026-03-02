import Image from "next/image"
import Link from "next/link"

const JESUS_FILM = "https://www.jesusfilm.org"

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-white">
      <nav className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <Link
          href={JESUS_FILM}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Image
            src="/jesus-film-logo-full.svg"
            alt="Jesus Film Project"
            width={139}
            height={36}
            className="h-9 w-auto"
          />
        </Link>
      </nav>
    </header>
  )
}
