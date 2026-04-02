import Link from "next/link"
import TiltCard from "@/components/TiltCard"
import WorldMapBackground from "@/components/WorldMapBackground"
import {
  getAllFeatures,
  getStatusCounts,
  getLaneLabel,
  type Feature,
} from "@/lib/features"
import { EXPERIMENTS } from "@/lib/experiments"

function getCompletedEndDate(feature: Feature): Date {
  const start = new Date(feature.start_date + "T00:00:00")
  return new Date(start.getTime() + (feature.duration - 1) * 86400000)
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function HomePage() {
  const features = getAllFeatures()
  const totals = getStatusCounts(features)

  const recentlyCompleted = features
    .filter((f) => f.status === "complete" && f.start_date)
    .sort(
      (a, b) =>
        getCompletedEndDate(b).getTime() - getCompletedEndDate(a).getTime(),
    )
    .slice(0, 5)

  const inProgressCount = totals["in-progress"]

  return (
    <div className="relative space-y-16 pb-16">
      <WorldMapBackground />

      {/* Warm signpost */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-center text-sm text-gray-400">
        Looking for Jesus Film?{" "}
        <a
          href="https://www.jesusfilm.org"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-400 hover:text-blue-300"
        >
          Visit jesusfilm.org &rarr;
        </a>
      </div>

      {/* Hero */}
      <section className="space-y-6 pt-4 text-center">
        <img
          src="/jesusfilm-sign.svg"
          alt="Jesus Film Project"
          className="mx-auto h-10"
        />
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Reaching every person,
          <br />
          in every language,
          <br />
          through the power of AI
        </h1>
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-gray-400">
          The Digital Strategies Department is building trusted AI capabilities
          that help people discover gospel content, engage meaningfully with
          Scripture, and take faithful next steps.
        </p>
        <p className="text-sm text-gray-500">
          This is our public roadmap. See what we&apos;re building, what
          we&apos;ve shipped, and where we&apos;re headed.
        </p>
      </section>

      {/* Momentum stats */}
      <section className="space-y-4">
        <h2 className="text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
          Progress at a glance
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Features Shipped"
            count={totals.complete}
            color="text-green-400"
          />
          <StatCard
            label="In Progress"
            count={inProgressCount}
            color="text-blue-400"
          />
          <StatCard
            label="Total Planned"
            count={features.length}
            color="text-gray-300"
          />
        </div>
      </section>

      {/* Recently completed */}
      {recentlyCompleted.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold">Recently Shipped</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyCompleted.map((feature) => (
              <TiltCard
                key={feature.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
              >
                <Link href={`/ticket/${feature.id}`} className="block p-4">
                  <div className="text-xs text-gray-500">
                    {getLaneLabel(feature.lane)}
                  </div>
                  <h3 className="mt-1 text-sm font-semibold">
                    {feature.title}
                  </h3>
                  <div className="mt-2 text-xs text-gray-500">
                    Completed {formatDate(getCompletedEndDate(feature))}
                  </div>
                </Link>
              </TiltCard>
            ))}
          </div>
        </section>
      )}

      {/* Experiments */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold">Live Experiments</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXPERIMENTS.map((exp) => (
            <div
              key={exp.number}
              className={`rounded-lg border border-[var(--color-border)] border-l-2 ${exp.accentBorder} bg-[var(--color-card)] p-4`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${exp.accentBg} ${exp.accent}`}
                >
                  {exp.number}
                </span>
                <h3 className="text-sm font-semibold">{exp.title}</h3>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-400">
                {exp.description}
              </p>
              <div className="mt-3">
                {exp.comingSoon ? (
                  <span className="text-xs text-gray-500">Coming soon</span>
                ) : exp.links[0] ? (
                  <a
                    href={exp.links[0].href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-medium ${exp.accent} hover:underline`}
                  >
                    {exp.links[0].label} &#8599;
                    {exp.loginRequired && (
                      <span className="ml-1 text-gray-500">
                        (login required)
                      </span>
                    )}
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="space-y-4 text-center">
        <Link
          href="/roadmap"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          Explore the Roadmap &rarr;
        </Link>
        <div>
          <Link
            href="/about"
            className="text-sm text-gray-400 hover:text-gray-300"
          >
            Learn more about our mission
          </Link>
        </div>
      </section>
    </div>
  )
}

function StatCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-center">
      <div className={`text-2xl font-bold sm:text-3xl ${color}`}>{count}</div>
      <div className="mt-1 text-xs text-gray-400">{label}</div>
    </div>
  )
}
