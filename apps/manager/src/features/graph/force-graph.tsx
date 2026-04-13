"use client"

import dynamic from "next/dynamic"
import { useMemo, useRef, useEffect, useState } from "react"
import type { GraphEdge, GraphNode } from "./graph-types"

// react-force-graph-2d relies on window / HTMLCanvasElement — must be
// client-only. Loading shell renders a stable-height placeholder so the
// canvas layout does not jump when the component hydrates.
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="graph-canvas-loading">Loading canvas…</div>,
  },
)

type ForceGraphProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

type FgNode = GraphNode & {
  color: string
  val: number
}

type FgLink = {
  source: string
  target: string
  kind: GraphEdge["kind"]
  weight?: number
}

const NODE_KIND_FALLBACK: Record<string, string> = {
  channel: "#8c6f47",
  video: "#b89570",
  scene: "#3d7a82",
  tag: "#a3603d",
  language: "#5d6f8b",
}

// Palette for group-based coloring (channels). Stable per group via hash.
const GROUP_PALETTE = [
  "#3d7a82",
  "#b5713c",
  "#5a7a3d",
  "#8b5a8c",
  "#c08a4a",
  "#4d6fa6",
  "#a9533f",
  "#457a5a",
  "#7e5a8d",
  "#b0854e",
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function colorFor(node: GraphNode): string {
  if (node.kind === "tag") return NODE_KIND_FALLBACK.tag
  if (node.kind === "channel") return "#2a241b"
  if (node.group) {
    return GROUP_PALETTE[hashStr(node.group) % GROUP_PALETTE.length]
  }
  return NODE_KIND_FALLBACK[node.kind] ?? "#6a6359"
}

export function ForceGraph({ nodes, edges }: ForceGraphProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 800,
    height: 600,
  })

  useEffect(() => {
    function measure() {
      const el = wrapperRef.current
      if (!el) return
      setSize({
        width: el.clientWidth || 800,
        height: el.clientHeight || 600,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  const data = useMemo(() => {
    const graphNodes: FgNode[] = nodes.map((n) => ({
      ...n,
      color: colorFor(n),
      val: n.size ?? 4,
    }))
    const graphLinks: FgLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: e.weight,
    }))
    return { nodes: graphNodes, links: graphLinks }
  }, [nodes, edges])

  return (
    <div ref={wrapperRef} className="graph-canvas">
      <ForceGraph2D
        width={size.width}
        height={size.height}
        graphData={data as unknown as never}
        backgroundColor="#faf7f1"
        nodeRelSize={4}
        nodeLabel={(raw: unknown) => {
          const node = raw as FgNode
          const description =
            (node.meta?.description as string | undefined) ??
            (node.meta?.label as string | undefined) ??
            ""
          return `<div style="max-width:280px">
            <strong>${escapeHtml(node.label)}</strong><br/>
            <small>${escapeHtml(node.kind)}</small>
            ${description ? `<div style="margin-top:4px">${escapeHtml(description)}</div>` : ""}
          </div>`
        }}
        linkWidth={(raw: unknown) => {
          const link = raw as FgLink
          return link.weight ? link.weight * 2 : 0.6
        }}
        linkColor={(raw: unknown) => {
          const link = raw as FgLink
          return link.kind === "similarity"
            ? "rgba(61,122,130,0.5)"
            : link.kind === "tagged"
              ? "rgba(163,96,61,0.35)"
              : "rgba(106,99,89,0.4)"
        }}
        cooldownTicks={120}
        warmupTicks={40}
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
