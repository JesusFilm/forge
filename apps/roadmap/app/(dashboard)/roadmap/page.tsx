import Link from "next/link"
import PlannedRoadmapTimeline from "@/components/PlannedRoadmapTimeline"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <section className="flex flex-col gap-6 pb-2 pt-8 lg:flex-row lg:justify-between">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              AI Delivery
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Roadmap
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-stone-400">
              Our AI development strategy uses weekly releases to incorporate AI
              features into existing products where they matter most.
            </p>
          </div>

          <div className="self-start lg:self-center lg:text-right">
            <Link
              href="/contributions"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-700 bg-stone-900 px-3.5 py-2.5 text-base font-semibold text-white transition-colors hover:border-stone-500 hover:bg-stone-800"
            >
              <svg
                className="h-3.5 w-3.5 text-stone-300"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M7 5.5H15M7 10H15M7 14.5H15M4.5 5.5H4.51M4.5 10H4.51M4.5 14.5H4.51"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Open Task View</span>
            </Link>
            <p className="mt-2 max-w-[240px] text-sm leading-snug text-stone-500/80 lg:ml-auto">
              See detailed breakdown of the work by person and late
            </p>
          </div>
        </section>
      </div>

      <div className="relative left-1/2 w-screen max-w-[1800px] -translate-x-1/2 px-4 md:px-8">
        <PlannedRoadmapTimeline />
      </div>
    </div>
  )
}
