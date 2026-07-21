import { Clapperboard, Globe2, UsersRound } from "lucide-react"
import { BetaTesterTrigger } from "@/components/watch/BetaTesterModalProvider"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

const defaultPoints = [
  {
    Icon: Globe2,
    title: "The most translated film library in the world",
    description:
      "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
  },
  {
    Icon: Clapperboard,
    title: "Carrying trusted voices into new formats",
    description:
      "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
  },
  {
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

export function WatchHomePromo() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(135deg,rgba(69,10,29,0.6),rgba(88,28,135,0.2),rgba(234,88,12,0.1))] py-[4.5rem] text-white">
      <div className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-45 mix-blend-multiply" />
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className="flex flex-col gap-14">
          <div className="max-w-3xl space-y-4">
            <p className="text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase">
              Built for global missions
            </p>
            <h2 className="text-3xl leading-tight font-semibold tracking-normal text-white sm:text-4xl lg:text-5xl">
              {"The message doesn't change. The way people watch does."}
            </h2>
            <p className="text-lg leading-8 text-white/80 lg:text-xl">
              We are rebuilding our video library and tools from the ground up,
              committing decades of translation work to the platforms where
              people already gather, watch, and share.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {defaultPoints.map((point) => {
              const Icon = point.Icon
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
              What we are building next
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              {defaultHighlights.map((highlight) => (
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
              {"You're invited"}
            </p>
            <h3 className="mb-4 text-3xl font-semibold text-white">
              Help build{" "}
              <span className="bg-gradient-to-r from-purple-400 via-blue-500 to-pink-500 bg-clip-text text-transparent">
                the next generation
              </span>{" "}
              of mission tools
            </h3>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80 lg:text-xl">
              {
                "We're inviting practitioners, creators, and partners into early access. Test new tools first, give feedback, and help shape products designed for real mission work."
              }
            </p>
            <BetaTesterTrigger className="inline-flex h-12 items-center justify-center rounded-md bg-white px-10 py-3 text-base font-medium text-black transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Become a beta tester
            </BetaTesterTrigger>
          </div>
        </div>
      </div>
    </section>
  )
}
