import type { Feature, FeatureStatus, Lane } from "./features"
import { getStatusCounts, getLaneLabel } from "./features"
import type { Experiment } from "./experiments"

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

export function renderHomeMarkdown(
  features: Feature[],
  experiments: Experiment[],
): string {
  const counts = getStatusCounts(features)

  const recentlyCompleted = features
    .filter((f) => f.status === "complete" && f.start_date)
    .sort((a, b) => {
      const endA = new Date(
        new Date(a.start_date + "T00:00:00").getTime() +
          (a.duration - 1) * 86400000,
      )
      const endB = new Date(
        new Date(b.start_date + "T00:00:00").getTime() +
          (b.duration - 1) * 86400000,
      )
      return endB.getTime() - endA.getTime()
    })
    .slice(0, 5)

  const lines: string[] = [
    `# JesusFilm Digital Strategies Roadmap`,
    "",
    `> Reaching every person, in every language, through the power of AI.`,
    "",
    `The Digital Strategies Department is building trusted AI capabilities that help people discover gospel content, engage meaningfully with Scripture, and take faithful next steps.`,
    "",
    `## Progress at a Glance`,
    "",
    `- **Features Shipped:** ${counts.complete}`,
    `- **In Progress:** ${counts["in-progress"]}`,
    `- **Total Planned:** ${features.length}`,
    "",
    `[Full Roadmap](/roadmap.md) | [About](/about.md) | [Experiments](/experiments.md)`,
  ]

  if (recentlyCompleted.length > 0) {
    lines.push("", `## Recently Shipped`, "")
    for (const f of recentlyCompleted) {
      lines.push(`- [${f.title}](/ticket/${f.id}.md) — ${getLaneLabel(f.lane)}`)
    }
  }

  if (experiments.length > 0) {
    lines.push("", `## Live Experiments`, "")
    for (const exp of experiments) {
      const link =
        exp.links[0] && !exp.comingSoon
          ? ` — [${exp.links[0].label}](${exp.links[0].href})`
          : exp.comingSoon
            ? " — Coming soon"
            : ""
      lines.push(`- **${exp.title}:** ${exp.description}${link}`)
    }
  }

  return lines.join("\n")
}

export function renderAboutMarkdown(experiments: Experiment[]): string {
  const team = [
    { name: "Tataihono", role: "Architect" },
    { name: "Vlad", role: "Product Owner & Manager Builder" },
    { name: "Ekkasit", role: "AI Experience Generation" },
    { name: "Nisal", role: "Backend" },
    { name: "Urim", role: "Frontend (Web & Mobile)" },
  ]

  const principles = [
    {
      title: "Theological fidelity",
      description:
        "AI assists, humans verify. No speculative doctrine. Every generated piece of content is grounded in trusted Scripture and reviewed before publication.",
    },
    {
      title: "Human oversight",
      description:
        "Generated content starts as drafts, published only after human review. The AI proposes; the ministry team decides.",
    },
    {
      title: "Safe experimentation",
      description:
        "Practical outcomes over full automation. We ship incremental value, measure impact, and iterate with care.",
    },
    {
      title: "Ministry first",
      description:
        "Technology serves the mission, not the other way around. Every capability we build is measured by lives reached, not models deployed.",
    },
  ]

  const quarters = [
    { label: "Sept – Nov 2025", title: "Foundation" },
    { label: "Dec 2025 – Feb 2026", title: "Infrastructure & Data" },
    { label: "March – May 2026", title: "Search, Topics, Audio (current)" },
    {
      label: "June – Aug 2026",
      title: "Personalization, Publishing, Video AI",
    },
  ]

  const lines: string[] = [
    `# About — JesusFilm Digital Strategies`,
    "",
    `> Reaching every person, in every language, through the power of AI.`,
    "",
    `Build trusted, scalable AI capabilities that help people discover gospel content, engage meaningfully with Scripture, and take faithful next steps, while maintaining strong theological and ministry guardrails.`,
    "",
    `## The Opportunity`,
    "",
    `Billions of people across hundreds of languages are searching for hope, meaning, and truth. The Jesus Film Project has decades of gospel media (films, short videos, Scripture resources) but connecting the right content to the right person at the right moment remains an enormous challenge. AI changes the equation — not by replacing human ministry, but by making it possible to structure, discover, and deliver content at a scale that was previously impossible.`,
    "",
    `## Three Focus Areas`,
    "",
    `1. **Content Discovery & Recommendation** — Structure and tag media so people and AI systems can discover related content. Semantic search, embeddings, and intelligent recommendations.`,
    `2. **Topic Pages & Guided Journeys** — Use clustered content and AI assistance to generate clear, public-facing topic pages. Tens of thousands of pages, each a doorway to the gospel.`,
    `3. **AI-Assisted Media Creation** — Reduce the cost and effort of creating media through AI-assisted subtitles, audio, and video. Break language barriers at scale.`,
    "",
    `## Year 1 Timeline`,
    "",
    ...quarters.map((q) => `- **${q.label}:** ${q.title}`),
    "",
    `## The Team`,
    "",
    `| Name | Role |`,
    `|------|------|`,
    ...team.map((m) => `| ${m.name} | ${m.role} |`),
    "",
    `## Our Guardrails`,
    "",
    ...principles.map((p) => `- **${p.title}:** ${p.description}`),
  ]

  if (experiments.length > 0) {
    lines.push("", `## Live Experiments`, "")
    for (const exp of experiments) {
      const link =
        exp.links[0] && !exp.comingSoon
          ? ` — [${exp.links[0].label}](${exp.links[0].href})`
          : exp.comingSoon
            ? " — Coming soon"
            : ""
      lines.push(`- **${exp.title}:** ${exp.description}${link}`)
    }
  }

  return lines.join("\n")
}

export function renderExperimentsMarkdown(experiments: Experiment[]): string {
  const lines: string[] = [
    `# Experiments`,
    "",
    `Active projects demonstrating what we're building. Each explores a different way to use technology for ministry, from hand-crafted experiences to AI-generated content to mobile delivery.`,
  ]

  for (const exp of experiments) {
    lines.push(
      "",
      `## ${exp.number}. ${exp.title}`,
      "",
      exp.description,
      "",
      `- **Team:** ${exp.team.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", ")}`,
    )

    if (exp.comingSoon) {
      lines.push(`- **Status:** Coming soon`)
    } else if (exp.links.length > 0) {
      for (const link of exp.links) {
        lines.push(`- **${link.label}:** ${link.href}`)
      }
      if (exp.loginRequired) {
        lines.push(`- *Login required*`)
      }
    }
  }

  return lines.join("\n")
}
