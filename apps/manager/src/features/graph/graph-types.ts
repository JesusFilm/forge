export type GraphMode =
  | "hierarchy"
  | "scene-similarity"
  | "video-similarity"
  | "tags"

export type GraphNodeKind = "channel" | "video" | "scene" | "tag" | "language"

export type GraphEdgeKind = "parent" | "similarity" | "tagged" | "variant"

export type GraphNode = {
  id: string
  label: string
  kind: GraphNodeKind
  group?: string
  size?: number
  meta?: Record<string, unknown>
}

export type GraphEdge = {
  source: string
  target: string
  kind: GraphEdgeKind
  weight?: number
}

export type GraphPayload = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta: {
    mode: GraphMode
    generatedAt: string
    nodeCount: number
    edgeCount: number
    notes?: string[]
  }
}

export const GRAPH_MODES: ReadonlyArray<{
  id: GraphMode
  label: string
  description: string
}> = [
  {
    id: "hierarchy",
    label: "Connections",
    description: "Explicit CMS relationships: channel → video → child videos.",
  },
  {
    id: "scene-similarity",
    label: "Scene embeddings",
    description:
      "Scenes grouped by cosine similarity of their multimodal embeddings.",
  },
  {
    id: "video-similarity",
    label: "Video embeddings",
    description:
      "Videos grouped by transcript embedding similarity (prototype).",
  },
  {
    id: "tags",
    label: "Tags",
    description:
      "Keyword ↔ video relationships by language, grouped by channel.",
  },
]
