"use client"

import { useSyncExternalStore } from "react"
import {
  getStats,
  subscribe,
  type DemoSearchStats,
} from "@/lib/demo-search-metrics"
import { METHODOLOGY_NOTES, SECTIONS } from "./costs"

const serverSnapshot: DemoSearchStats = {
  count: 0,
  p50Ms: null,
  p95Ms: null,
  totalEmbeddingCostUsd: 0,
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(6)}`
  return `$${value.toFixed(2)}`
}

export function CostLatencyPanel() {
  const stats = useSyncExternalStore(subscribe, getStats, () => serverSnapshot)

  return (
    <section
      aria-labelledby="cost-latency-heading"
      className="mt-16 rounded-2xl border border-stone-800 bg-stone-950/60 p-6 md:p-8"
    >
      <header className="mb-6">
        <p className="text-xs font-medium tracking-wider text-stone-500 uppercase">
          Why a pgvector stack, in numbers
        </p>
        <h2
          id="cost-latency-heading"
          className="mt-1 text-2xl font-semibold text-white"
        >
          Cost &amp; speed vs Algolia
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-400">
          The{" "}
          <a
            className="underline decoration-stone-600 underline-offset-2 hover:text-stone-200"
            href="https://www.jesusfilm.org/watch"
            target="_blank"
            rel="noreferrer noopener"
          >
            current www.jesusfilm.org/watch
          </a>{" "}
          search is powered by Algolia. This demo hits our semantic-search API
          (pgvector + OpenRouter embeddings) instead. Every number below links
          to its source.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <LiveStat label="Queries this session" value={stats.count.toString()} />
        <LiveStat
          label="Search embedding cost this session"
          value={formatUsd(stats.totalEmbeddingCostUsd)}
          hint={
            stats.count === 0
              ? "Run a search to populate"
              : "Query-embedding call only — does not include the AI page-generation cost"
          }
        />
      </div>

      <div className="flex flex-col gap-8">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-stone-300 uppercase">
              {section.title}
            </h3>
            <div className="overflow-hidden rounded-xl border border-stone-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-900/60 text-xs uppercase tracking-wider text-stone-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Metric</th>
                    <th className="px-4 py-3 font-medium">Our stack</th>
                    <th className="px-4 py-3 font-medium">Algolia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800">
                  {section.rows.map((row) => (
                    <tr key={row.label} className="align-top">
                      <td className="px-4 py-3 text-stone-300">
                        {row.label}
                        {row.assumption && (
                          <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-200 uppercase">
                            assumption
                          </span>
                        )}
                        {row.note && (
                          <p className="mt-1 text-xs text-stone-500">
                            {row.note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-200">
                        <Cell text={row.ours} source={row.ourSource} />
                      </td>
                      <td className="px-4 py-3 text-stone-200">
                        <Cell text={row.algolia} source={row.algoliaSource} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <footer className="mt-8 border-t border-stone-800 pt-6">
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-stone-500 uppercase">
          Methodology
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-stone-400">
          {METHODOLOGY_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </footer>
    </section>
  )
}

function LiveStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-4">
      <p className="text-xs font-medium tracking-wider text-stone-500 uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-white tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  )
}

function Cell({ text, source }: { text: string; source?: string }) {
  if (!source) return <span>{text}</span>
  return (
    <span>
      {text}{" "}
      <a
        href={source}
        target="_blank"
        rel="noreferrer noopener"
        className="text-stone-500 underline decoration-stone-700 underline-offset-2 hover:text-stone-300"
      >
        source
      </a>
    </span>
  )
}
