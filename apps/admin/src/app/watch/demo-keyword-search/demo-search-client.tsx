"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { executeGraphQL } from "./graphql-client"
import {
  SEARCH_OPERATION,
  type DemoSearchData,
  type SearchResponse,
  type SearchResult,
} from "./search-operation"
import { computeTopKDiff } from "./diff"

type ModeKey = "hybrid" | "keyword-first"

type PaneState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; response: SearchResponse }
  | { status: "error"; messages: string[] }

const DEFAULTS = {
  q: "",
  locale: "en",
  limit: 10,
  k: 10,
}

function readNumberParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = params.get(name)
  if (raw == null || raw.length === 0) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function DemoSearchClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlQ = searchParams.get("q") ?? DEFAULTS.q
  const urlLocale = searchParams.get("locale") ?? DEFAULTS.locale
  const urlLimit = readNumberParam(searchParams, "limit", DEFAULTS.limit)
  const urlK = readNumberParam(searchParams, "k", DEFAULTS.k)

  // Form is uncontrolled — `key` on the form remounts inputs whenever the
  // URL changes, so back/forward and shared links repaint the fields without
  // a setState-in-effect rehydration step.
  const formKey = `${urlQ}|${urlLocale}|${urlLimit}|${urlK}`

  const [hybridPane, setHybridPane] = useState<PaneState>({ status: "idle" })
  const [keywordPane, setKeywordPane] = useState<PaneState>({ status: "idle" })

  // Fire on URL change (effective query). Empty q skips.
  useEffect(() => {
    const trimmed = urlQ.trim()
    if (trimmed.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- transitioning effect-owned state on input clear
      setHybridPane({ status: "idle" })

      setKeywordPane({ status: "idle" })
      return
    }

    let cancelled = false

    setHybridPane({ status: "loading" })

    setKeywordPane({ status: "loading" })

    void Promise.allSettled([
      runSearch({
        q: trimmed,
        locale: urlLocale,
        limit: urlLimit,
        mode: "hybrid",
      }),
      runSearch({
        q: trimmed,
        locale: urlLocale,
        limit: urlLimit,
        mode: "keyword-first",
      }),
    ]).then((settled) => {
      if (cancelled) return
      setHybridPane(toPaneState(settled[0]))
      setKeywordPane(toPaneState(settled[1]))
    })

    return () => {
      cancelled = true
    }
  }, [urlQ, urlLocale, urlLimit])

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next = new URLSearchParams()
    next.set("q", String(form.get("q") ?? "").trim())
    next.set(
      "locale",
      String(form.get("locale") ?? "").trim() || DEFAULTS.locale,
    )
    next.set("limit", String(form.get("limit") ?? DEFAULTS.limit))
    next.set("k", String(form.get("k") ?? DEFAULTS.k))
    router.push(`?${next.toString()}`)
  }

  const diff = useMemo(() => {
    const aIds =
      hybridPane.status === "ok"
        ? hybridPane.response.results.map((r) => r.id)
        : []
    const bIds =
      keywordPane.status === "ok"
        ? keywordPane.response.results.map((r) => r.id)
        : []
    return computeTopKDiff(aIds, bIds, urlK)
  }, [hybridPane, keywordPane, urlK])

  const rowAccent = useMemo(() => buildRowAccentMap(diff), [diff])

  return (
    <main
      style={{
        padding: "24px 32px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111",
        maxWidth: 1600,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Keyword-First Search Canary</h1>
        <p
          style={{ marginTop: 6, color: "#555", fontSize: 13, lineHeight: 1.5 }}
        >
          Operator tool for diffing admin&apos;s{" "}
          <code>mode=&quot;hybrid&quot;</code> vs{" "}
          <code>mode=&quot;keyword-first&quot;</code> rankings on the same
          query. Both calls use <code>debug: true</code>; if the debug payload
          is withheld in prod, set <code>SEARCH_DEBUG_ALLOWED_ORIGINS</code> to
          include admin&apos;s origin. Retriever labels in the debug payload are{" "}
          <strong>UNSTABLE</strong> — do not branch on them in production code.
        </p>
      </header>

      <form
        key={formKey}
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 100px 100px auto",
          gap: 8,
          alignItems: "end",
          marginBottom: 16,
        }}
      >
        <Field label="Query (q)">
          <input
            name="q"
            defaultValue={urlQ}
            placeholder="e.g. the bible project"
            style={inputStyle}
          />
        </Field>
        <Field label="Locale">
          <input
            name="locale"
            defaultValue={urlLocale}
            placeholder="en"
            style={inputStyle}
          />
        </Field>
        <Field label="Limit">
          <input
            name="limit"
            type="number"
            min={1}
            max={50}
            defaultValue={urlLimit}
            style={inputStyle}
          />
        </Field>
        <Field label="Top-K diff">
          <input
            name="k"
            type="number"
            min={1}
            max={50}
            defaultValue={urlK}
            style={inputStyle}
          />
        </Field>
        <button type="submit" style={buttonStyle}>
          Search both modes
        </button>
      </form>

      <DiffPanel
        diff={diff}
        k={urlK}
        hybridPane={hybridPane}
        keywordPane={keywordPane}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <Pane heading="mode: hybrid" state={hybridPane} rowAccent={rowAccent} />
        <Pane
          heading="mode: keyword-first"
          state={keywordPane}
          rowAccent={rowAccent}
        />
      </div>
    </main>
  )
}

async function runSearch(args: {
  q: string
  locale: string
  limit: number
  mode: ModeKey
}): Promise<SearchResponse> {
  const result = await executeGraphQL<DemoSearchData, typeof args>(
    SEARCH_OPERATION,
    args,
  )
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("; "))
  }
  return result.data.search
}

function toPaneState(settled: PromiseSettledResult<SearchResponse>): PaneState {
  if (settled.status === "fulfilled") {
    return { status: "ok", response: settled.value }
  }
  const reason = settled.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  return { status: "error", messages: message.split("; ") }
}

// ---------------------------------------------------------------------------
// Diff panel
// ---------------------------------------------------------------------------

function DiffPanel({
  diff,
  k,
  hybridPane,
  keywordPane,
}: {
  diff: { both: string[]; aOnly: string[]; bOnly: string[] }
  k: number
  hybridPane: PaneState
  keywordPane: PaneState
}) {
  const haveData = hybridPane.status === "ok" && keywordPane.status === "ok"

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12,
      }}
    >
      <DiffTile
        label={`In both (top ${k})`}
        ids={diff.both}
        accent="#0a7d2f"
        background="#e8f6ec"
        haveData={haveData}
      />
      <DiffTile
        label={`Hybrid only (top ${k})`}
        ids={diff.aOnly}
        accent="#9a4400"
        background="#fdeede"
        haveData={haveData}
      />
      <DiffTile
        label={`Keyword-first only (top ${k})`}
        ids={diff.bOnly}
        accent="#0a4a99"
        background="#e6efff"
        haveData={haveData}
      />
    </section>
  )
}

function DiffTile({
  label,
  ids,
  accent,
  background,
  haveData,
}: {
  label: string
  ids: string[]
  accent: string
  background: string
  haveData: boolean
}) {
  return (
    <div
      style={{
        background,
        border: `1px solid ${accent}`,
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: accent,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 22,
          color: accent,
        }}
      >
        {haveData ? ids.length : "—"}
      </div>
      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
        {ids.map((id) => (
          <code
            key={id}
            style={{
              fontSize: 11,
              background: "#fff",
              padding: "1px 5px",
              borderRadius: 3,
              border: `1px solid ${accent}33`,
              color: "#222",
            }}
          >
            {truncateId(id)}
          </code>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result pane
// ---------------------------------------------------------------------------

function Pane({
  heading,
  state,
  rowAccent,
}: {
  heading: string
  state: PaneState
  rowAccent: Map<string, string>
}) {
  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "12px 14px",
        background: "#fafafa",
      }}
    >
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {heading}
      </h2>
      <PaneBody state={state} rowAccent={rowAccent} />
    </section>
  )
}

function PaneBody({
  state,
  rowAccent,
}: {
  state: PaneState
  rowAccent: Map<string, string>
}) {
  if (state.status === "idle") {
    return <Hint>Enter a query above and submit to canary both modes.</Hint>
  }
  if (state.status === "loading") {
    return <Hint>Loading…</Hint>
  }
  if (state.status === "error") {
    return (
      <Banner tone="error">
        <strong>GraphQL error.</strong>
        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
          {state.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </Banner>
    )
  }

  const { response } = state
  const debugRequestedButMissing = response.results.some((r) => r.debug == null)

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 12,
          color: "#444",
          marginBottom: 6,
        }}
      >
        <span>
          searchMode: <code>{response.searchMode}</code>
        </span>
        <span>
          results: <code>{response.results.length}</code>
        </span>
        <span>
          hasMore: <code>{String(response.hasMore)}</code>
        </span>
      </div>

      {response.searchMode === "KEYWORD_ONLY" ? (
        <Banner tone="warn">
          Embedding provider degraded — semantic retrievers skipped this run.
        </Banner>
      ) : null}

      {debugRequestedButMissing && response.results.length > 0 ? (
        <Banner tone="muted">
          Debug payload withheld for one or more rows (origin not on the
          allowlist). Set <code>SEARCH_DEBUG_ALLOWED_ORIGINS</code> to include
          this origin to surface retriever ranks.
        </Banner>
      ) : null}

      {response.results.length === 0 ? (
        <Hint>No results.</Hint>
      ) : (
        <ResultTable results={response.results} rowAccent={rowAccent} />
      )}
    </div>
  )
}

function ResultTable({
  results,
  rowAccent,
}: {
  results: SearchResult[]
  rowAccent: Map<string, string>
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12,
      }}
    >
      <thead>
        <tr style={{ textAlign: "left", color: "#666" }}>
          <th style={thStyle}>#</th>
          <th style={thStyle}>id / title</th>
          <th style={thStyle}>score</th>
          <th style={thStyle}>retrievers</th>
          <th style={thStyle}>cap</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r, i) => {
          const accent = rowAccent.get(r.id) ?? "#fff"
          return (
            <tr
              key={r.id}
              style={{
                borderTop: "1px solid #eee",
                background: accent,
              }}
            >
              <td style={tdStyle}>{i + 1}</td>
              <td style={tdStyle}>
                <div style={{ fontWeight: 500 }}>{r.title || "(no title)"}</div>
                <div
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "#666",
                    fontSize: 11,
                  }}
                >
                  {r.type.toLowerCase()} · {truncateId(r.id)}
                  {r.playbackId ? ` · mux:${truncateId(r.playbackId)}` : ""}
                </div>
              </td>
              <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace" }}>
                {r.score.toFixed(4)}
                {r.debug ? (
                  <div style={{ color: "#888", fontSize: 11 }}>
                    fused: {r.debug.fusedScore.toFixed(4)}
                  </div>
                ) : null}
              </td>
              <td style={tdStyle}>
                {r.debug ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {r.debug.retrieverRanks.map((rr, idx) => (
                      <span key={idx} style={chipStyle}>
                        {rr.label} #{rr.rank}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: "#999" }}>—</span>
                )}
              </td>
              <td style={tdStyle}>
                {r.debug?.dilutionCapApplied ? (
                  <span
                    title="Dilution cap halved this row's fused score"
                    style={{
                      ...chipStyle,
                      color: "#7a2900",
                      borderColor: "#e0a586",
                    }}
                  >
                    ⚑ applied
                  </span>
                ) : (
                  <span style={{ color: "#bbb" }}>—</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRowAccentMap(diff: {
  both: string[]
  aOnly: string[]
  bOnly: string[]
}): Map<string, string> {
  const map = new Map<string, string>()
  for (const id of diff.both) map.set(id, "#e8f6ec")
  for (const id of diff.aOnly) map.set(id, "#fdeede")
  for (const id of diff.bOnly) map.set(id, "#e6efff")
  return map
}

function truncateId(id: string): string {
  if (id.length <= 10) return id
  return `…${id.slice(-8)}`
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "#666",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#888", fontSize: 13, padding: "12px 0" }}>
      {children}
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warn" | "muted"
  children: React.ReactNode
}) {
  const palette = {
    error: { bg: "#fdecec", border: "#c54040", text: "#7a1f1f" },
    warn: { bg: "#fff7e0", border: "#c79100", text: "#5a4400" },
    muted: { bg: "#eef1f4", border: "#a9b3bd", text: "#36424d" },
  }[tone]
  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        padding: "8px 10px",
        borderRadius: 4,
        fontSize: 12,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  color: "#111",
  background: "#fff",
  colorScheme: "light",
}

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  border: "1px solid #2d6cdf",
  background: "#2d6cdf",
  color: "#fff",
  borderRadius: 4,
  fontSize: 14,
  cursor: "pointer",
  whiteSpace: "nowrap",
}

const thStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
}

const tdStyle: React.CSSProperties = {
  padding: "6px",
  verticalAlign: "top",
}

const chipStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  padding: "1px 6px",
  border: "1px solid #ccc",
  borderRadius: 10,
  background: "#fff",
  color: "#444",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
}
