import {
  getAllFeatures,
  getAllOwners,
  getStatusCounts,
  getLaneLabel,
  ALL_LANES,
} from "@/lib/features"

export async function GET() {
  const features = getAllFeatures()
  const counts = getStatusCounts(features)
  const owners = getAllOwners()

  const lines: string[] = [
    `# JesusFilm Roadmap`,
    "",
    `> Project roadmap for JesusFilm (JFP). ${features.length} features across ${ALL_LANES.length} lanes: ${counts.complete} complete, ${counts["in-progress"]} in-progress, ${counts["not-started"]} not-started, ${counts.blocked} blocked.`,
    "",
    `This site provides a read-only view of the JesusFilm project roadmap. Every page is available as markdown by appending \`.md\` to the URL.`,
    "",
    `## Pages`,
    "",
    `- [Home](/index.md): Overview with progress stats, recently shipped features, and live experiments`,
    `- [Full Roadmap](/roadmap.md): All features with status, priority, owner, and timeline`,
    `- [About](/about.md): Mission, team, focus areas, guardrails, and timeline`,
    `- [Experiments](/experiments.md): Active project demos with links and team info`,
    "",
    `## Lanes`,
    "",
    ...ALL_LANES.map(
      (lane) =>
        `- [${getLaneLabel(lane)}](/lane/${lane}.md): Features in the ${getLaneLabel(lane).toLowerCase()} lane`,
    ),
    "",
    `## Team`,
    "",
    ...owners.map(
      (owner) =>
        `- [${owner}](/person/${owner}.md): Features assigned to ${owner}`,
    ),
  ]

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  })
}
