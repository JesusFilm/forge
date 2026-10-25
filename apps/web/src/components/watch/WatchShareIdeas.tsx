"use client"

// "Share your faith" audience body: practical habits for sending a film well,
// the existing Share control, and a launcher for the film kit. The kit module
// is not fetched until the visitor asks for it. On Watch home there is no
// current film, so the host's existing collection is shown instead.
//
// Layout note: nothing here uses `truncate` on a long token (a URL). That sets
// `white-space: nowrap`, which makes the element's min-content as wide as the
// whole string and blows out the grid track on a phone.

import {
  Clock3,
  Ear,
  HandHeart,
  MessageCircle,
  Package,
  Send,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Suspense, lazy, useRef, useState, type ReactNode } from "react"

import type { WatchShareFilm } from "@/lib/watch-share-kit"
import { WATCH_SECTION_EYEBROW_CLASS } from "./watch-section-styles"

const WatchShareKit = lazy(() =>
  import("./WatchShareKit").then((module) => ({
    default: module.WatchShareKit,
  })),
)

type Idea = {
  id: string
  Icon: LucideIcon
  title: string
  why: string
  /** One short thing you could say. A phrase, not a script. */
  say?: string
}

const IDEAS: Idea[] = [
  {
    id: "one",
    Icon: UserRound,
    title: "Send it to one person",
    why: "In a group chat it is everyone’s job and nobody’s. Picture one face, then send it to them.",
    say: "This made me think of you.",
  },
  {
    id: "why",
    Icon: Sparkles,
    title: "Say why you watched it",
    why: "Your reaction is the recommendation. A bare link looks like an ad; a sentence about what it stirred in you does not.",
    say: "I watched this and it stayed with me.",
  },
  {
    id: "ask",
    Icon: MessageCircle,
    title: "End with a question",
    why: "A question invites a reply. A statement closes the conversation before it starts.",
    say: "What did you make of it?",
  },
  {
    id: "exit",
    Icon: HandHeart,
    title: "Give them an easy no",
    why: "Pressure is what makes people avoid the subject and eventually avoid you. Naming the length and meaning it is enough.",
    say: "Three minutes, and no worries if not.",
  },
  {
    id: "together",
    Icon: Users,
    title: "Watch it together if you can",
    why: "Sitting beside someone beats a link every time. Press play, say nothing, and let it land before you speak.",
  },
  {
    id: "listen",
    Icon: Ear,
    title: "Listen more than you talk",
    why: "You are not there to win the point. What they say afterwards tells you what they actually need.",
  },
  {
    id: "timing",
    Icon: Clock3,
    title: "Timing beats wording",
    why: "The right moment with clumsy words works better than perfect words at the wrong one. Wait for the door to open.",
  },
  {
    id: "once",
    Icon: Send,
    title: "Follow up once, then leave it",
    why: "One gentle check-in respects them. Repeated nudges turn a gift into a debt.",
    say: "No rush — just glad I sent it.",
  },
]

/** Short, plain reassurance. The barrier here is nerve, not information. */
const ENCOURAGEMENT = [
  "You do not need to have the answers.",
  "You are not responsible for the outcome.",
  "The worst that happens is they do not watch it.",
  "You are not selling anything. You are passing on something that moved you.",
]

export type WatchShareIdeasProps = {
  /** The current film, or `null` on Watch home where none is selected yet. */
  film: WatchShareFilm | null
  /** The host's existing collection, shown until a film is selected. */
  collection?: ReactNode
  /** Opens the existing Share modal. */
  onShareClick?: () => void
  /** Ask the host to load the film's audio language inventory. */
  onRequestLanguageOptions?: () => void
}

export function WatchShareIdeas({
  film,
  collection,
  onShareClick,
  onRequestLanguageOptions,
}: WatchShareIdeasProps) {
  const launcher = useRef<HTMLButtonElement>(null)
  // The kit belongs to one film: selecting another film closes it.
  const filmKey = film ? `${film.slug}/${film.languageSlug}` : null
  const [openFor, setOpenFor] = useState<string | null>(null)
  const kitOpen = film != null && openFor === filmKey

  function openKit() {
    setOpenFor(filmKey)
    onRequestLanguageOptions?.()
  }

  function closeKit() {
    setOpenFor(null)
    launcher.current?.focus()
  }

  const minutes = film?.runtimeMinutes ? `${film.runtimeMinutes} minutes` : null

  return (
    <section
      aria-labelledby="watch-share-ideas-heading"
      data-testid="watch-share-ideas"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <style>{`
        @keyframes wsi-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .wsi-r > * { animation: wsi-rise .4s ease-out both }
        .wsi-r > *:nth-child(2) { animation-delay: .04s }
        .wsi-r > *:nth-child(3) { animation-delay: .08s }
        .wsi-r > *:nth-child(4) { animation-delay: .12s }
        .wsi-r > *:nth-child(5) { animation-delay: .16s }
        .wsi-r > *:nth-child(6) { animation-delay: .20s }
        .wsi-r > *:nth-child(7) { animation-delay: .24s }
        .wsi-r > *:nth-child(8) { animation-delay: .28s }
        @media (prefers-reduced-motion: reduce) { .wsi-r > * { animation: none } }
      `}</style>

      <header className="max-w-2xl">
        <p className={WATCH_SECTION_EYEBROW_CLASS}>Sharing it well</p>
        <h2
          id="watch-share-ideas-heading"
          className="mt-3 text-3xl leading-[1.1] font-semibold text-balance sm:text-4xl"
        >
          You don&rsquo;t need a script.
        </h2>
        <p className="mt-3 text-base leading-relaxed text-white/70">
          {film ? (
            <>
              <span lang="" dir="auto">
                {film.title}
              </span>
              {minutes
                ? ` is ${minutes} long. That is a small thing to send someone.`
                : " is a small thing to send someone."}
            </>
          ) : (
            "A short film is a small thing to send someone."
          )}{" "}
          What makes it land is not the wording — it is these few habits.
        </p>
      </header>

      {film ? null : (
        <div className="mt-8 min-w-0">
          <h3 className="text-2xl leading-tight font-semibold sm:text-3xl">
            Pick a film to send
          </h3>
          <div className="mt-5 min-w-0">{collection}</div>
        </div>
      )}

      {/* encouragement — the barrier is nerve, not information */}
      <ul className="mt-7 grid min-w-0 gap-2.5 sm:grid-cols-2">
        {ENCOURAGEMENT.map((line) => (
          <li
            key={line}
            className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3.5"
          >
            <span
              aria-hidden
              className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand-red"
            />
            <span className="min-w-0 text-[15px] leading-snug text-white/85">
              {line}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-12 text-2xl leading-tight font-semibold sm:text-3xl">
        Eight things that help.
      </h3>
      <ul className="wsi-r mt-6 grid min-w-0 gap-3 md:grid-cols-2">
        {IDEAS.map((idea, i) => (
          <li key={idea.id} className="min-w-0">
            <article
              data-testid="watch-share-idea"
              className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.07]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/8">
                  <idea.Icon
                    aria-hidden
                    className="size-[18px] text-white/80"
                  />
                </span>
                <span className="text-[11px] font-bold tabular-nums text-white/30">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h4 className="min-w-0 text-[17px] leading-tight font-semibold text-balance">
                  {idea.title}
                </h4>
              </div>
              <p className="min-w-0 text-[14px] leading-relaxed text-white/65">
                {idea.why}
              </p>
              {idea.say ? (
                <p className="mt-auto w-fit max-w-full rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[14px] leading-snug text-stone-900">
                  <span className="mr-1.5 text-[10px] font-bold tracking-[0.1em] text-stone-400 uppercase">
                    say
                  </span>
                  {idea.say}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ul>

      {film ? (
        <>
          <div className="mt-10 flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
            <p className="min-w-0 flex-1 text-[15px] leading-snug text-white/75">
              Got someone in mind? That is the whole step.
            </p>
            {onShareClick ? (
              <button
                type="button"
                data-testid="watch-share-send"
                onClick={onShareClick}
                className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-brand-red px-5 py-3 text-xs font-bold tracking-wider text-white uppercase transition-colors hover:bg-[#d92a36] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
              >
                <Send aria-hidden className="size-4" />
                Send this film
              </button>
            ) : null}
            <button
              ref={launcher}
              type="button"
              data-testid="watch-share-kit-launcher"
              aria-expanded={kitOpen}
              onClick={kitOpen ? closeKit : openKit}
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/25 px-5 py-3 text-xs font-bold tracking-wider text-white uppercase transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
            >
              <Package aria-hidden className="size-4" />
              Prepare a film kit
            </button>
          </div>
          {kitOpen ? (
            <Suspense
              fallback={
                <p role="status" className="mt-6 text-sm text-white/65">
                  Preparing the kit…
                </p>
              }
            >
              <WatchShareKit
                film={film}
                onClose={closeKit}
                onRequestLanguageOptions={onRequestLanguageOptions}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
