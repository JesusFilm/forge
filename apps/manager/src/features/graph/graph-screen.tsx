"use client"

import { useState } from "react"
import { ForceGraph } from "./force-graph"
import { GRAPH_MODES, type GraphMode } from "./graph-types"
import { useGraphData } from "./use-graph-data"

export function GraphScreen() {
  const [mode, setMode] = useState<GraphMode>("hierarchy")
  const { data, isLoading, error } = useGraphData(mode)

  const activeMode = GRAPH_MODES.find((m) => m.id === mode)

  return (
    <section className="graph-screen">
      <header className="graph-screen-header">
        <div>
          <h1 className="graph-screen-title">Semantic graph</h1>
          <p className="graph-screen-subtitle">
            Explore content clusters and relationships across channels.
          </p>
        </div>
      </header>

      <div className="graph-controls" role="tablist" aria-label="Graph mode">
        {GRAPH_MODES.map((m) => {
          const isActive = m.id === mode
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`graph-mode-btn${isActive ? " is-active" : ""}`}
              onClick={() => setMode(m.id)}
            >
              <span className="graph-mode-btn-label">{m.label}</span>
            </button>
          )
        })}
      </div>

      {activeMode && (
        <p className="graph-mode-description">{activeMode.description}</p>
      )}

      <div className="graph-meta-row">
        {isLoading && <span>Loading…</span>}
        {error && <span className="graph-error">Error: {error}</span>}
        {!isLoading && !error && data && (
          <>
            <span>
              <strong>{data.meta.nodeCount}</strong> nodes
            </span>
            <span>
              <strong>{data.meta.edgeCount}</strong> edges
            </span>
            {data.meta.notes?.length
              ? data.meta.notes.map((n) => (
                  <span key={n} className="graph-meta-note">
                    {n}
                  </span>
                ))
              : null}
          </>
        )}
      </div>

      <div className="graph-canvas-wrapper">
        {data ? (
          <ForceGraph nodes={data.nodes} edges={data.edges} />
        ) : (
          <div className="graph-canvas-placeholder">
            {isLoading ? "Building graph…" : (error ?? "No data")}
          </div>
        )}
      </div>

      <Legend />
    </section>
  )
}

function Legend() {
  return (
    <div className="graph-legend" aria-label="Legend">
      <LegendSwatch color="#2a241b" label="Channel / origin" />
      <LegendSwatch
        color="#3d7a82"
        label="Video / scene (colored by channel)"
      />
      <LegendSwatch color="#a3603d" label="Tag" />
      <LegendSwatch color="rgba(61,122,130,0.7)" label="Similarity edge" />
      <LegendSwatch color="rgba(106,99,89,0.6)" label="Hierarchy edge" />
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="graph-legend-item">
      <span
        className="graph-legend-swatch"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </span>
  )
}
