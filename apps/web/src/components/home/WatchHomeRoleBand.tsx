"use client"

// Role-aware "start here" band at the top of the Watch home body zone. Same
// roles as the header chip and the video page's "What's next" zone;
// switching here switches everywhere. Markup, classes and the role-specific
// line + pills are copied from the prototype (prototype-parity manifest).
// This static navigation is separate from the video questionnaire; only the
// destinations are wired to canonical routes in the visitor's audio language
// and verified external sites. A rejected or unavailable authored
// configuration omits the band, container included.

import type { Route } from "next"
import {
  BookOpen,
  Compass,
  Download,
  FileText,
  Globe,
  History,
  Layers,
  MessageCircle,
  Play,
  Send,
  Sunrise,
  Users,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useId } from "react"

import { useWatchRole, type WatchRole } from "@/components/watch/watch-role"
import { useRegisterWatchAudiencePresence } from "@/components/watch/watch-audience-presence"
import {
  WatchRoleTabs,
  watchRolePanelProps,
} from "@/components/watch/WatchRoleTabs"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import {
  languagesIndexPath,
  localizedHistoryPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
  type LocaleSlug,
} from "@/lib/routes"
import { textDirectionForLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"
import {
  watchAudienceFrame,
  type WatchAudienceResolution,
} from "@/lib/watch-audience-config"

type Card = {
  Icon: LucideIcon
  title: string
  body: string
  href: string
  external?: boolean
  primary?: boolean
}

/**
 * The prototype's per-role content. Data exceptions (manifest): Explore's
 * private-chat pill pointed at an unreachable host and promised privacy we
 * cannot verify, so it is the prototype's other real-person destination
 * (chataboutjesus.com) with that action's own copy; Share's "Watch with a
 * friend" had no destination ("#") and no real guide exists, so it is omitted.
 */
function roleContent(
  lang: LocaleSlug,
): Record<WatchRole, { line: string; cards: Card[] }> {
  const video = (slug: string) => {
    const s = tryAsContentSlug(slug)
    return s ? (watchVideoPath(s, lang) as string) : null
  }
  const cards = (list: (Omit<Card, "href"> & { href: string | null })[]) =>
    list.flatMap((card) => (card.href ? [{ ...card, href: card.href }] : []))

  return {
    explore: {
      line: "New here? Start with the story of Jesus, or ask a question.",
      cards: cards([
        {
          Icon: Play,
          title: "Watch the story of Jesus",
          body: "The JESUS film · 2 hours · in your language",
          href: video("jesus"),
          primary: true,
        },
        {
          Icon: MessageCircle,
          title: "Talk with a real person",
          body: "Someone ready to listen, not to argue.",
          href: "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch-home",
          external: true,
        },
        {
          Icon: Compass,
          title: "Not sure where to start?",
          body: "Seven 3-minute films, one a day.",
          href: video("7-days-with-jesus-walk-with-jesus"),
        },
      ]),
    },
    grow: {
      line: "Welcome back. Pick up where you left off.",
      cards: cards([
        {
          Icon: History,
          title: "Continue watching",
          body: "Your recent films and where you stopped.",
          href: localizedHistoryPath(lang) as string,
          primary: true,
        },
        {
          Icon: Sunrise,
          title: "7 Days with Jesus",
          body: "A short film and a question for each day this week.",
          href: video("7-days-with-jesus-walk-with-jesus"),
        },
        {
          Icon: BookOpen,
          title: "The Gospels on film",
          body: "Matthew, Mark, Luke, and John, word for word.",
          href: video("lumo"),
        },
        {
          Icon: Users,
          title: "Join a Bible study",
          body: "Free, online, small group.",
          href: "https://join.bsfinternational.org/?utm_source=jesusfilm-watch-home",
          external: true,
        },
      ]),
    },
    share: {
      line: "Sharing your faith? Short films are the easiest thing to send.",
      cards: cards([
        {
          Icon: Send,
          title: "Short films to send",
          body: "3-minute conversation starters.",
          href: video("conversation-starters"),
          primary: true,
        },
        {
          Icon: Play,
          title: "The story of Jesus",
          body: "The JESUS film in their language.",
          href: video("jesus"),
        },
        {
          Icon: BookOpen,
          title: "How to start the conversation",
          body: "Questions that open things up, not shut them down.",
          href: video("evangelism"),
        },
      ]),
    },
    partner: {
      line: "Churches and ministries: everything you need to show these films.",
      cards: cards([
        {
          Icon: Globe,
          title: "Find films in a language",
          body: "2,000+ audio languages. Browse by language first.",
          href: languagesIndexPath() as string,
          primary: true,
        },
        {
          Icon: Download,
          title: "Download for offline",
          body: "Full films and series, 1080p to audio-only.",
          href: video("jesus"),
        },
        {
          Icon: Layers,
          title: "Series kits",
          body: "Episodes, guides, and a message plan in one place.",
          href: video("7-days-with-jesus-walk-with-jesus"),
        },
        {
          Icon: FileText,
          title: "Training & how-tos",
          body: "Showing a film well, leading the discussion, following up.",
          href: video("training"),
        },
      ]),
    },
  }
}

export type WatchHomeRoleBandProps = {
  /** The published configuration both Watch surfaces share. */
  audience?: WatchAudienceResolution
  languageSlug: string
}

export function WatchHomeRoleBand({
  audience,
  languageSlug,
}: WatchHomeRoleBandProps) {
  const { role, hydrated } = useWatchRole()
  const idBase = useId()
  const frame = watchAudienceFrame(audience)
  const lang = tryAsLocaleSlug(languageSlug)
  useRegisterWatchAudiencePresence(
    frame && lang ? frame.config : null,
    lang,
    frame?.sourceLocale ?? null,
  )
  if (!frame || !lang) return null

  const c = roleContent(lang)[role]

  return (
    <section
      aria-label="Who is this for"
      data-testid="watch-home-role-band"
      data-role={role}
      lang="en"
      dir="ltr"
      className={cn(
        `${WATCH_PAGE_CONTENT_CLASSES} pt-8 text-white transition-opacity duration-300 md:pt-10`,
        hydrated ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        lang={frame.sourceLocale}
        dir={textDirectionForLocale(frame.sourceLocale)}
      >
        <WatchRoleTabs
          idBase={idBase}
          config={frame.config}
          locale={frame.sourceLocale}
        />
      </div>

      <div
        {...watchRolePanelProps(idBase, role)}
        className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-white/10 pb-7 text-[15px]"
      >
        <p className="text-white/85">{c.line}</p>
        <ul className="flex flex-wrap items-center gap-2">
          {c.cards.map((card) => (
            <li key={card.title}>
              <QuietPill card={card} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function QuietPill({ card }: { card: Card }) {
  const className =
    "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 text-[13px] font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
  const inner = (
    <>
      <card.Icon aria-hidden className="size-4 shrink-0 opacity-80" />
      <span className="whitespace-nowrap">{card.title}</span>
    </>
  )
  if (card.external) {
    return (
      <a
        className={className}
        href={card.href}
        title={card.body}
        target="_blank"
        rel="noopener noreferrer"
      >
        {inner}
      </a>
    )
  }
  return (
    <Link
      className={className}
      href={card.href as Route}
      title={card.body}
      prefetch={false}
    >
      {inner}
    </Link>
  )
}
