import Link from "next/link"
import {
  getAllFeatures,
  getStatusCounts,
  getLaneLabel,
  type Feature,
} from "@/lib/features"

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
    <div className="space-y-16 pb-16">
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
          The Digital Strategies team is building trusted AI capabilities that
          help people discover gospel content, engage meaningfully with
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
              <Link
                key={feature.id}
                href={`/ticket/${feature.id}`}
                className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_4px_20px_rgba(74,222,128,0.15)]"
              >
                <div className="text-xs text-gray-500">
                  {getLaneLabel(feature.lane)}
                </div>
                <h3 className="mt-1 text-sm font-semibold group-hover:text-green-400">
                  {feature.title}
                </h3>
                <div className="mt-2 text-xs text-gray-500">
                  Completed {formatDate(getCompletedEndDate(feature))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="space-y-4 text-center">
        <Link
          href="/dashboard"
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
