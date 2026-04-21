// Sourced cost + latency rows for the /demo-search comparison panel.
//
// Every figure in this file is pulled from a public source cited inline. If a
// figure is an assumption (e.g. we picked a query-volume for the scaling
// example), mark it with `assumption: true` and explain why in `note` so the
// demo panel can flag it visibly.

export type ComparisonRow = {
  label: string
  ours: string
  algolia: string
  ourSource?: string
  algoliaSource?: string
  note?: string
  assumption?: boolean
}

export type ComparisonSection = {
  title: string
  rows: ComparisonRow[]
}

const assumedMonthlyQueries = "1,000,000"

export const SECTIONS: ComparisonSection[] = [
  {
    title: "Steady-state cost",
    rows: [
      {
        label: `Search queries / month (assumed: ${assumedMonthlyQueries})`,
        ours: "~$0.60 (embedding API calls, OpenAI text-embedding-3-small)",
        algolia: "~$495 on Algolia Grow ($0.50 / 1K requests after 10K free)",
        ourSource:
          "https://platform.openai.com/docs/models/text-embedding-3-small",
        algoliaSource:
          "https://support.algolia.com/hc/en-us/articles/15745996583441-How-am-I-billed-on-the-Grow-plan",
        assumption: true,
        note: "1M queries is an illustrative figure — JesusFilm's actual volume may differ.",
      },
      {
        label: "Semantic / AI search tier",
        ours: "Included in base stack (pgvector + OpenRouter)",
        algolia:
          "NeuralSearch is Elevate-tier only — contact-sales, no public price",
        algoliaSource: "https://www.algolia.com/pricing",
      },
      {
        label: "Database / index hosting (per month)",
        ours: "~$19–$87 fixed (Neon Launch / Railway 2 vCPU · 4 GB · 50 GB)",
        algolia:
          "Record storage bundled into plan tier; overage $0.40 / 1K records",
        ourSource: "https://neon.com/pricing",
        algoliaSource: "https://www.algolia.com/pricing",
      },
    ],
  },
  {
    title: "Latency",
    rows: [
      {
        label: "Engine-side query time",
        ours: "~5–8 ms p50 (pgvector HNSW @ 1M × 1536d, community benchmarks)",
        algolia: "1–20 ms (Algolia's own published figure)",
        algoliaSource:
          "https://support.algolia.com/hc/en-us/articles/4406975267089-How-fast-is-Algolia",
      },
      {
        label: "End-to-end (incl. network & embedding)",
        ours: "Typical 200–600 ms server → CMS round-trip in dev; faster in prod when both are co-located on Railway",
        algolia:
          "Algolia recommends ≤50 ms end-to-end for as-you-type UX; no public SLA",
        algoliaSource:
          "https://www.algolia.com/blog/product/don-t-let-network-latency-ruin-the-search-experience-of-your-international-users",
      },
    ],
  },
]

export const METHODOLOGY_NOTES: string[] = [
  "Our latency is measured around the GraphQL call on the Next.js server: Next.js → JesusFilm CMS → back. The figure includes query embedding + pgvector retrieval + keyword search + fusion. It excludes the browser ↔ Next.js hop.",
  "Algolia's engine-side latency is their own published marketing figure and also excludes network.",
  "Algolia's semantic / NeuralSearch tier is contact-sales, so the 'per-1M-queries' comparison uses Algolia's Grow tier pricing as a floor — their true apples-to-apples semantic product has no public price.",
  "JesusFilm's current Algolia usage is documented at docs.core.jesusfilm.org/docs/basics/frontend/algolia. Query volume is not public; the 1M figure above is illustrative.",
]
