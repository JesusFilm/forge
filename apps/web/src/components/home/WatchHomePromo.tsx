import { Clapperboard, Globe2, UsersRound, type LucideIcon } from "lucide-react"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

export type WatchHomePromoCardData = {
  icon?: string | null
  title: string
  description: string
}

export type WatchHomePromoBlockData = {
  sectionKey?: string | null
  eyebrow?: string | null
  heading?: string | null
  description?: string | null
  points?: readonly (WatchHomePromoCardData | null)[] | null
  highlightsHeading?: string | null
  highlights?: readonly (WatchHomePromoCardData | null)[] | null
  invitationEyebrow?: string | null
  invitationHeading?: string | null
  invitationGradientText?: string | null
  invitationDescription?: string | null
  ctaLabel?: string | null
  ctaLink?: string | null
}

const iconByName: Record<string, LucideIcon> = {
  clapperboard: Clapperboard,
  globe: Globe2,
  users: UsersRound,
}

const defaultPoints = [
  {
    icon: "globe",
    Icon: Globe2,
    title: "The most translated film library in the world",
    description:
      "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
  },
  {
    icon: "clapperboard",
    Icon: Clapperboard,
    title: "Carrying trusted voices into new formats",
    description:
      "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
  },
  {
    icon: "users",
    Icon: UsersRound,
    title: "More than a library. A mission-driven team.",
    description:
      "Jesus Film Project is a global team of translators, media specialists, editors, and creators turning decades of ministry experience into tools for disciple-makers everywhere.",
  },
] as const

const defaultHighlights = [
  {
    title: "Next Steps Platform",
    description:
      "Connect viewers with tangible opportunities on their spiritual journey, helping them take a next step into community, Scripture, or mission.",
  },
  {
    title: "Evangelistic Media Library",
    description:
      "An extensive Christian media library with thousands of videos, films, and resources available in multiple languages for ministry and evangelism worldwide.",
  },
  {
    title: "Digital Tools for Ministries",
    description:
      "Video management, content distribution, audience engagement, and analytics designed to help ministries reach more people effectively.",
  },
] as const

const defaultPromo: Required<Omit<WatchHomePromoBlockData, "sectionKey">> = {
  eyebrow: "Built for global missions",
  heading: "The message doesn't change. The way people watch does.",
  description:
    "We are rebuilding our video library and tools from the ground up, committing decades of translation work to the platforms where people already gather, watch, and share.",
  points: defaultPoints,
  highlightsHeading: "What we are building next",
  highlights: defaultHighlights,
  invitationEyebrow: "You're invited",
  invitationHeading: "Help build",
  invitationGradientText: "the next generation",
  invitationDescription:
    "We're inviting practitioners, creators, and partners into early access. Test new tools first, give feedback, and help shape products designed for real mission work.",
  ctaLabel: "Become a beta tester",
  ctaLink: "https://mailchi.mp/jesusfilm/beta",
}

function normalizeCards(
  cards: readonly (WatchHomePromoCardData | null)[] | null | undefined,
  fallback: readonly WatchHomePromoCardData[],
) {
  const filtered = (cards ?? []).filter(
    (card): card is WatchHomePromoCardData =>
      card != null && Boolean(card.title) && Boolean(card.description),
  )
  return filtered.length > 0 ? filtered : fallback
}

export function WatchHomePromo({
  data,
}: {
  data?: WatchHomePromoBlockData | null
} = {}) {
  const eyebrow = data?.eyebrow ?? defaultPromo.eyebrow
  const heading = data?.heading ?? defaultPromo.heading
  const description = data?.description ?? defaultPromo.description
  const points = normalizeCards(data?.points, defaultPoints)
  const highlightsHeading =
    data?.highlightsHeading ?? defaultPromo.highlightsHeading
  const highlights = normalizeCards(data?.highlights, defaultHighlights)
  const invitationEyebrow =
    data?.invitationEyebrow ?? defaultPromo.invitationEyebrow
  const invitationHeading =
    data?.invitationHeading ?? defaultPromo.invitationHeading
  const invitationGradientText =
    data?.invitationGradientText ?? defaultPromo.invitationGradientText
  const invitationDescription =
    data?.invitationDescription ?? defaultPromo.invitationDescription
  const ctaLabel = data?.ctaLabel ?? "Become a beta tester"
  const ctaLink = data?.ctaLink ?? "https://mailchi.mp/jesusfilm/beta"

  return (
    <section
      id={data?.sectionKey ?? undefined}
      className="relative overflow-hidden bg-[linear-gradient(135deg,rgba(69,10,29,0.6),rgba(88,28,135,0.2),rgba(234,88,12,0.1))] py-[4.5rem] text-white"
    >
      <div className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-45 mix-blend-multiply" />
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className="flex flex-col gap-14">
          <div className="max-w-3xl space-y-4">
            <p className="text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase">
              {eyebrow}
            </p>
            <h2 className="text-3xl leading-tight font-semibold tracking-normal text-white sm:text-4xl lg:text-5xl">
              {heading}
            </h2>
            <p className="text-lg leading-8 text-white/80 lg:text-xl">
              {description}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {points.map((point) => {
              const Icon = iconByName[point.icon ?? ""] ?? Globe2
              return (
                <article
                  key={point.title}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-colors duration-300 hover:bg-white/10"
                >
                  <Icon
                    className="h-20 w-20 text-white/20 mix-blend-overlay"
                    aria-hidden
                  />
                  <h3 className="mt-6 text-xl font-semibold text-white">
                    {point.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">
                    {point.description}
                  </p>
                </article>
              )
            })}
          </div>

          <div className="space-y-6">
            <p className="text-lg text-white/80 lg:text-xl">
              {highlightsHeading}
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              {highlights.map((highlight) => (
                <article
                  key={highlight.title}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-stone-950/20 p-6 transition-colors duration-300 hover:border-white/20 hover:bg-stone-900/60"
                >
                  <h3 className="text-lg font-semibold text-white">
                    {highlight.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">
                    {highlight.description}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-12 mb-16 text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase">
              {invitationEyebrow}
            </p>
            <h3 className="mb-4 text-3xl font-semibold text-white">
              {invitationHeading}{" "}
              {invitationGradientText ? (
                <span className="bg-gradient-to-r from-purple-400 via-blue-500 to-pink-500 bg-clip-text text-transparent">
                  {invitationGradientText}
                </span>
              ) : null}{" "}
              of mission tools
            </h3>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80 lg:text-xl">
              {invitationDescription}
            </p>
            <a
              href={ctaLink}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex h-12 items-center justify-center rounded-md bg-white px-10 py-3 text-base font-medium text-black transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {ctaLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
