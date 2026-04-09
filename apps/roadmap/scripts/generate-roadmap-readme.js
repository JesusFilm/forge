const fs = require("fs")
const path = require("path")

const {
  getAllFeatures,
  getLaneLabel,
  getStatusCounts,
} = require("../lib/features.ts")

const readmePath = path.resolve(process.cwd(), "../../docs/roadmap/README.md")
const README_LANE_ORDER = [
  "content-discovery",
  "media-generation",
  "platform",
  "topic-experiences",
]

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function formatDueDate(feature) {
  if (!feature.start_date || feature.duration <= 0) return "—"
  const start = new Date(`${feature.start_date}T00:00:00`)
  start.setDate(start.getDate() + feature.duration - 1)
  return formatIsoDate(start)
}

function renderReadmeFeatureTable(features) {
  return [
    `| ID | Feature | Owner | Priority | Start | Days | Due | Status |`,
    `| -- | ------- | ----- | -------- | ----- | ---- | --- | ------ |`,
    ...features.map(
      (feature) =>
        `| [${feature.id}](${feature.filePath.replace("docs/roadmap/", "")}) | ${feature.title} | ${feature.owner} | ${feature.priority} | ${feature.start_date || "—"} | ${feature.duration || "—"} | ${formatDueDate(feature)} | ${feature.status} |`,
    ),
  ]
}

function renderRoadmapReadme(features, today = new Date()) {
  const counts = getStatusCounts(features)
  const normalizedToday = new Date(today)
  normalizedToday.setHours(0, 0, 0, 0)
  const overdueCount = features.filter((feature) => {
    if (feature.status === "complete") return false
    if (!feature.start_date || feature.duration <= 0) return false
    return formatDueDate(feature) < formatIsoDate(normalizedToday)
  }).length

  const lines = [
    `# DS Year 1 Roadmap`,
    ``,
    `## Goal`,
    ``,
    `Build trusted, scalable AI capabilities that help people discover gospel content, engage meaningfully with Scripture, and take faithful next steps.`,
    ``,
    `## Status (${normalizedToday.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })})`,
    ``,
    `- **Total tickets:** ${features.length}`,
    `- **Complete:** ${counts.complete}`,
    `- **In progress:** ${counts["in-progress"]}`,
    `- **Not started:** ${counts["not-started"]}`,
    `- **Blocked:** ${counts.blocked}`,
    `- **Overdue and not complete:** ${overdueCount}`,
    ``,
    `## Feature Index`,
  ]

  for (const lane of README_LANE_ORDER) {
    const laneFeatures = features.filter((feature) => feature.lane === lane)
    if (laneFeatures.length === 0) continue

    lines.push(
      ``,
      `### ${getLaneLabel(lane)}`,
      ``,
      ...renderReadmeFeatureTable(laneFeatures),
    )
  }

  return lines.join("\n")
}

const readme = renderRoadmapReadme(getAllFeatures(), new Date())

fs.writeFileSync(readmePath, `${readme}\n`)
console.log(`Updated ${readmePath}`)
