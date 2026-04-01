import type { Feature, FeatureStatus, Lane } from "./features"
import { getStatusCounts, getLaneLabel } from "./features"

function statusEmoji(status: FeatureStatus): string {
  switch (status) {
    case "complete":
      return "done"
    case "in-progress":
      return "in-progress"
    case "blocked":
      return "blocked"
    case "not-started":
      return "not-started"
  }
}

function featuresTable(features: Feature[]): string {
  const header = `| Title | Status | Priority | Owner | Timeline |
|-------|--------|----------|-------|----------|`

  const rows = features.map((f) => {
    const link = `[${f.title}](/ticket/${f.id}.md)`
    return `| ${link} | ${statusEmoji(f.status)} | ${f.priority} | ${f.owner} | ${f.timeline || "—"} |`
  })

  return [header, ...rows].join("\n")
}

function statusSummary(features: Feature[]): string {
  const counts = getStatusCounts(features)
  return `**${features.length} features** — ${counts.complete} complete, ${counts["in-progress"]} in-progress, ${counts["not-started"]} not-started, ${counts.blocked} blocked`
}

export function renderRoadmapMarkdown(features: Feature[]): string {
  const lines: string[] = [
    `# Roadmap Overview`,
    "",
    statusSummary(features),
    "",
    featuresTable(features),
  ]
  return lines.join("\n")
}

export function renderLaneMarkdown(lane: Lane, features: Feature[]): string {
  const label = getLaneLabel(lane)
  const lines: string[] = [
    `# ${label}`,
    "",
    statusSummary(features),
    "",
    featuresTable(features),
  ]
  return lines.join("\n")
}

export function renderPersonMarkdown(
  person: string,
  features: Feature[],
): string {
  const lines: string[] = [
    `# ${person}`,
    "",
    statusSummary(features),
    "",
    featuresTable(features),
  ]
  return lines.join("\n")
}

export function renderTicketMarkdown(feature: Feature): string {
  const meta = [
    `- **Status:** ${statusEmoji(feature.status)}`,
    `- **Priority:** ${feature.priority}`,
    `- **Owner:** ${feature.owner}`,
    `- **Lane:** ${getLaneLabel(feature.lane)}`,
    `- **Timeline:** ${feature.timeline || "—"}`,
  ]

  if (feature.depends_on.length > 0) {
    const deps = feature.depends_on
      .map((id) => `[${id}](/ticket/${id}.md)`)
      .join(", ")
    meta.push(`- **Depends on:** ${deps}`)
  }

  if (feature.blocks.length > 0) {
    const blocks = feature.blocks
      .map((id) => `[${id}](/ticket/${id}.md)`)
      .join(", ")
    meta.push(`- **Blocks:** ${blocks}`)
  }

  if (feature.tags.length > 0) {
    meta.push(`- **Tags:** ${feature.tags.join(", ")}`)
  }

  const lines: string[] = [
    `# ${feature.id}: ${feature.title}`,
    "",
    ...meta,
    "",
    "---",
    "",
    feature.content.trim(),
  ]
  return lines.join("\n")
}
