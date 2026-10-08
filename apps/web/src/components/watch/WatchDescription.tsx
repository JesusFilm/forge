import { useTranslations } from "next-intl"
import { useState } from "react"

import { parseWatchDescription } from "@/lib/watch-description"

const LUMO_LINKS = [
  { label: "LUMO Project", href: "https://www.lumoproject.com" },
  { label: "Facebook", href: "https://www.facebook.com/thelumoproject" },
  { label: "X", href: "https://twitter.com/TheLumoProject" },
  { label: "Instagram", href: "https://www.instagram.com/lumo.project" },
]

export function WatchDescription({
  description,
  className,
  testId,
}: {
  description: string | null | undefined
  className: string
  testId: string
}) {
  const readMore = useTranslations("BibleQuotes")("readMore")
  const showLess = useTranslations("WatchLanguageIndex")("showLess")
  const { editorial, attribution } = parseWatchDescription(description)
  const [isExpanded, setIsExpanded] = useState(false)
  if (!editorial && !attribution) return null

  return (
    <div data-testid={testId} className={className}>
      {editorial ? (
        editorial.length > 360 ? (
          <details
            onToggle={(event) => setIsExpanded(event.currentTarget.open)}
          >
            <summary
              aria-label={isExpanded ? showLess : readMore}
              aria-describedby={isExpanded ? undefined : `${testId}-preview`}
              className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">
                {isExpanded
                  ? showLess
                  : `${editorial.slice(0, 280).trimEnd()} ${readMore}`}
              </span>
            </summary>
            {!isExpanded ? (
              <span id={`${testId}-preview`} className="sr-only">
                {editorial.slice(0, 280).trimEnd()}
              </span>
            ) : null}
            {isExpanded ? <p className="mt-2">{editorial}</p> : null}
          </details>
        ) : (
          <p>{editorial}</p>
        )
      ) : null}
      {attribution ? (
        <p className="mt-3 text-sm">
          {LUMO_LINKS.map((link, index) => (
            <span key={link.label}>
              {index > 0 ? " · " : null}
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {link.label}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}
