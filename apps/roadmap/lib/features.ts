import fs from "fs"
import path from "path"
import matter from "gray-matter"

export type FeatureStatus =
  | "not-started"
  | "in-progress"
  | "complete"
  | "blocked"
export type Priority = "P0" | "P1" | "P2"
export type Lane =
  | "content-discovery"
  | "topic-experiences"
  | "media-generation"
  | "platform"

export type Feature = {
  id: string
  title: string
  owner: string
  priority: Priority
  status: FeatureStatus
  start_date: string // YYYY-MM-DD
  duration: number // days
  timeline: string // computed display string
  lane: Lane
  depends_on: string[]
  blocks: string[]
  tags: string[]
  content: string
  problemPreview: string
  slug: string
  filePath: string
}

const ROADMAP_DIR = process.env.ROADMAP_DIR
  ? path.resolve(process.env.ROADMAP_DIR)
  : path.join(process.cwd(), "../../docs/roadmap")

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 }

function formatTimeline(startDate: string, duration: number): string {
  if (!startDate) return ""
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(start.getTime() + (duration - 1) * 86400000)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  if (duration <= 1) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}

// `ai-chat` is intentionally excluded — it is a docs-only, unregistered lane.
// Do not add it here. See CLAUDE.md → "Excluded lane: ai-chat".
const LANE_DIRS: Lane[] = [
  "content-discovery",
  "topic-experiences",
  "media-generation",
  "platform",
]

function parseFeatureFile(filePath: string, lane: Lane): Feature | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const { data, content } = matter(raw)

    if (!data.id || !data.title || !data.owner) {
      console.warn(`Skipping ${filePath}: missing required frontmatter fields`)
      return null
    }

    const startDate = data.start_date ?? ""
    const duration = data.duration ?? 0

    return {
      id: data.id,
      title: data.title,
      owner: data.owner,
      priority: data.priority ?? "P2",
      status: data.status ?? "not-started",
      start_date: startDate,
      duration,
      timeline: formatTimeline(startDate, duration),
      lane,
      depends_on: data.depends_on ?? [],
      blocks: data.blocks ?? [],
      tags: data.tags ?? [],
      content,
      problemPreview: extractProblemPreview(content),
      slug: data.id,
      filePath: `docs/roadmap/${lane}/${path.basename(filePath)}`,
    }
  } catch (err) {
    console.warn(`Error parsing ${filePath}:`, err)
    return null
  }
}

function extractProblemPreview(content: string): string {
  const problemSectionMatch = content.match(
    /##\s+Problem\s*([\s\S]*?)(?:\n##\s+|\n#\s+|$)/i,
  )
  const source = problemSectionMatch?.[1] ?? content

  const paragraphs = source
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part))
    .map((part) => part.trim())
    .filter(Boolean)

  const preview = paragraphs[0] ?? "No problem summary available yet."
  return preview.length > 520
    ? `${preview.slice(0, 517).trimEnd()}...`
    : preview
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
}

export function getAllFeatures(): Feature[] {
  const features: Feature[] = []

  for (const lane of LANE_DIRS) {
    const laneDir = path.join(ROADMAP_DIR, lane)
    if (!fs.existsSync(laneDir)) continue

    const files = fs.readdirSync(laneDir).filter((f) => f.endsWith(".md"))
    for (const file of files) {
      const feature = parseFeatureFile(path.join(laneDir, file), lane)
      if (feature) features.push(feature)
    }
  }

  // Compute effective status: blocked if any dependency is incomplete
  const statusById = new Map(features.map((f) => [f.id, f.status]))
  for (const f of features) {
    if (f.status === "complete") continue
    if (f.depends_on.length === 0) continue
    const hasIncompleteDep = f.depends_on.some(
      (depId) => statusById.get(depId) !== "complete",
    )
    if (hasIncompleteDep) {
      f.status = "blocked"
    }
  }

  features.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (pDiff !== 0) return pDiff
    return a.start_date.localeCompare(b.start_date)
  })

  return features
}

export function getFeatureById(id: string): Feature | undefined {
  return getAllFeatures().find((f) => f.id === id)
}

export function getFeaturesByOwner(owner: string): Feature[] {
  return getAllFeatures().filter((f) => f.owner === owner)
}

export function getFeaturesByLane(lane: Lane): Feature[] {
  return getAllFeatures().filter((f) => f.lane === lane)
}

export function getFeaturesByStatus(status: FeatureStatus): Feature[] {
  return getAllFeatures().filter((f) => f.status === status)
}

export function getAllOwners(): string[] {
  const owners = new Set(getAllFeatures().map((f) => f.owner))
  return Array.from(owners).sort()
}

export const ALL_LANES: Lane[] = [
  "content-discovery",
  "topic-experiences",
  "media-generation",
  "platform",
]

const GITHUB_PROFILES: Record<string, { username: string; avatar: string }> = {
  tataihono: {
    username: "tataihono",
    avatar: "https://avatars.githubusercontent.com/u/802117?v=4",
  },
  nisal: {
    username: "Kneesal",
    avatar: "https://avatars.githubusercontent.com/u/114973713?v=4",
  },
  ekkasit: {
    username: "up-tandem",
    avatar: "https://avatars.githubusercontent.com/u/219753032?v=4",
  },
  urim: {
    username: "Ur-imazing",
    avatar: "https://avatars.githubusercontent.com/u/95621276?v=4",
  },
  vlad: {
    username: "lumberman",
    avatar: "https://avatars.githubusercontent.com/u/1384471?v=4",
  },
  josh: {
    username: "openclaw",
    avatar: "https://avatars.githubusercontent.com/openclaw?v=4",
  },
}

export function getOwnerProfile(owner: string): {
  username: string
  avatar: string
} | null {
  return GITHUB_PROFILES[owner] ?? null
}

export function getLaneLabel(lane: Lane): string {
  const labels: Record<Lane, string> = {
    "content-discovery": "Content Discovery",
    "topic-experiences": "Topic Experiences",
    "media-generation": "Media Generation",
    platform: "Platform",
  }
  return labels[lane]
}

export function getStatusCounts(
  features: Feature[],
): Record<FeatureStatus, number> {
  const counts: Record<FeatureStatus, number> = {
    "not-started": 0,
    "in-progress": 0,
    complete: 0,
    blocked: 0,
  }
  for (const f of features) {
    counts[f.status]++
  }
  return counts
}
