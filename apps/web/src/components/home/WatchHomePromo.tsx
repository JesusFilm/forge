import Link from "next/link"
import { Clapperboard, Globe2, UsersRound } from "lucide-react"

const points = [
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

const highlights = [
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
    <section className="border-y border-white/10 bg-[linear-gradient(135deg,#111827,#3f1d2b_48%,#14332c)] py-16 text-white sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold tracking-[0.24em] text-red-100 uppercase">
            Built for global missions
          </p>
          <h2 className="text-3xl leading-tight font-semibold tracking-normal sm:text-4xl lg:text-5xl">
            The message does not change. The way people watch does.
          </h2>
          <p className="text-base leading-7 text-stone-200 sm:text-lg">
            We are rebuilding our video library and tools from the ground up,
            committing decades of translation work to the platforms where people
            already gather, watch, and share.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {points.map(({ Icon, title, description }) => (
            <article
              key={title}
              className="rounded-lg border border-white/10 bg-white/[0.06] p-5"
            >
              <Icon className="h-8 w-8 text-red-100/80" aria-hidden />
              <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-stone-300">
                {description}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {highlights.map((highlight) => (
            <article
              key={highlight.title}
              className="rounded-lg border border-white/10 bg-black/20 p-5"
            >
              <h3 className="text-base font-semibold text-white">
                {highlight.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-stone-300">
                {highlight.description}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-14 max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.24em] text-red-100 uppercase">
            You are invited
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-normal sm:text-3xl">
            Help build the next generation of mission tools
          </h3>
          <p className="mt-4 text-base leading-7 text-stone-200">
            We are inviting practitioners, creators, and partners into early
            access. Test new tools first, give feedback, and help shape products
            designed for real mission work.
          </p>
          <Link
            href="https://mailchi.mp/jesusfilm/beta"
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-6 inline-flex h-12 items-center rounded-lg bg-white px-6 text-sm font-semibold text-black transition hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Become a beta tester
          </Link>
        </div>
      </div>
    </section>
  )
}
