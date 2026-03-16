#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const REPO = "JesusFilm/forge"
const MIGRATION_LIMIT = Number(process.env.MIGRATION_LIMIT || "120")
const MIGRATION_LOOKUP_PRS = process.env.MIGRATION_LOOKUP_PRS === "1"
const ROOT = process.cwd()
const SOR_DIR = join(ROOT, "docs")
const MANIFEST_PATH = join(SOR_DIR, "migration-manifest.json")
const INDEX_PATH = join(SOR_DIR, "index.md")
const SCOPES = ["mobile", "web", "cms", "graphql", "platform"]
const IOS_OR_ANDROID_PATTERN = /\b(ios|android)\b/i
const EXPO_PATTERN = /\bexpo\b/i

function ghJson(args) {
  const raw = execFileSync("gh", args, { encoding: "utf8" })
  return JSON.parse(raw)
}

function ghText(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim()
}

function ensureDirs() {
  for (const scope of SCOPES) {
    mkdirSync(join(SOR_DIR, scope, "issues"), { recursive: true })
    mkdirSync(join(SOR_DIR, scope, "plans"), { recursive: true })
  }
}

function issueScope(issue) {
  const title = String(issue.title || "").toLowerCase()
  const match = title.match(/^[a-z]+(?:\(([a-z-]+)\))?:/i)
  const maybeScope = match?.[1]?.toLowerCase()
  if (maybeScope && SCOPES.includes(maybeScope)) return maybeScope

  const labels = (issue.labels || []).map((label) =>
    String(label.name).toLowerCase(),
  )
  const labelScope = labels.find((label) => SCOPES.includes(label))
  if (labelScope) return labelScope

  for (const scope of ["mobile", "web", "cms", "graphql"]) {
    if (title.includes(`-${scope}-`) || title.includes(`${scope}-`)) {
      return scope
    }
  }
  return "platform"
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex")
}

function escapeYaml(str) {
  return JSON.stringify(str ?? "")
}

function sectionFromBody(body, heading) {
  if (!body) return ""
  const pattern = new RegExp(
    `(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  )
  const match = body.match(pattern)
  return match ? match[1].trim() : ""
}

function shortText(value, max = 280) {
  if (!value) return ""
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function isCompleted(issue) {
  const labels = (issue.labels || []).map((l) => String(l.name).toLowerCase())
  const body = String(issue.body || "").toLowerCase()
  return (
    labels.some((label) =>
      ["done", "completed", "complete", "resolved", "closed"].includes(label),
    ) ||
    body.includes("- [x]") ||
    body.includes("acceptance criteria")
  )
}

function keepByPlatformPolicy(issue) {
  const title = String(issue.title || "")
  const body = String(issue.body || "")
  const scope = issueScope(issue)
  const content = `${title}\n${body}`

  if (IOS_OR_ANDROID_PATTERN.test(content)) {
    return false
  }
  if (scope === "mobile" && !EXPO_PATTERN.test(content)) {
    return false
  }
  return true
}

function linkedPrsForIssue(issueNumber) {
  if (!MIGRATION_LOOKUP_PRS) return []
  const query = `repo:${REPO} is:pr is:merged in:body "#${issueNumber}"`
  try {
    return ghJson([
      "search",
      "prs",
      query,
      "--repo",
      REPO,
      "--limit",
      "20",
      "--json",
      "number,title,url,body",
    ])
  } catch {
    return []
  }
}

function notesFromPrBodies(prs) {
  const notes = prs
    .map((pr) => shortText(pr.body || "", 180))
    .filter(Boolean)
    .map((body) => `PR note: ${body}`)
  return [...new Set(notes)].slice(0, 5)
}

function renderIssueArtifact(issue, prs, reviewNotes) {
  const labels = (issue.labels || []).map((l) => l.name)
  const background = sectionFromBody(issue.body, "Background")
  const expected = sectionFromBody(issue.body, "Expected outcome")
  const acceptance = sectionFromBody(issue.body, "Acceptance criteria")
  const possible = sectionFromBody(issue.body, "Possible solution\\(s\\)")
  const references = sectionFromBody(issue.body, "References")
  const execSummary = prs.length
    ? prs
        .map(
          (pr) =>
            `- [#${pr.number}](${pr.url}): ${shortText(pr.title)}${pr.body ? ` — ${shortText(pr.body, 140)}` : ""}`,
        )
        .join("\n")
    : "- No linked merged PR found."
  const notes = reviewNotes.length
    ? reviewNotes.map((n) => `- ${n}`).join("\n")
    : "- No PR review notes found."

  return `---
artifactType: issue
issueNumber: ${issue.number}
issueTitle: ${escapeYaml(issue.title)}
issueUrl: ${escapeYaml(issue.url)}
state: ${escapeYaml(issue.state || "closed")}
closedAt: ${escapeYaml(issue.closedAt || "")}
labels: ${JSON.stringify(labels)}
linkedPrs: ${JSON.stringify(prs.map((pr) => ({ number: pr.number, url: pr.url })))}
scope: ${escapeYaml(issueScope(issue))}
---

# Issue Artifact: #${issue.number}

## Background

${background || "Not provided in source issue."}

## Expected outcome

${expected || "Not provided in source issue."}

## Acceptance criteria

${acceptance || "Not provided in source issue."}

## Possible solution(s)

${possible || "Not provided in source issue."}

## References

${references || "Not provided in source issue."}

## Execution summary

${execSummary}

## Key review notes

${notes}
`
}

function renderPlanArtifact(issue, prs) {
  const objective = sectionFromBody(issue.body, "Expected outcome")
  const planned = sectionFromBody(issue.body, "Possible solution\\(s\\)")
  const validation = sectionFromBody(issue.body, "Acceptance criteria")
  const prLinks = prs.length
    ? prs.map((pr) => `- [#${pr.number}](${pr.url})`).join("\n")
    : "- None"

  return `---
artifactType: plan
sourceIssueNumber: ${issue.number}
sourceIssueTitle: ${escapeYaml(issue.title)}
sourceIssueUrl: ${escapeYaml(issue.url)}
linkedPrs: ${JSON.stringify(prs.map((pr) => ({ number: pr.number, url: pr.url })))}
scope: ${escapeYaml(issueScope(issue))}
---

# Plan Artifact: #${issue.number}

## Objective

${objective || "Not provided in source issue."}

## Planned approach

${planned || "Not provided in source issue."}

## Validation

${validation || "Not provided in source issue."}

## Source links

- Issue: [#${issue.number}](${issue.url})
- PRs:
${prLinks}
`
}

function readManifest() {
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items)) parsed.items = []
    return parsed
  } catch {
    return { version: 1, generatedAt: null, repo: REPO, items: [] }
  }
}

function writeFileSafe(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${content.trimEnd()}\n`, "utf8")
}

function main() {
  ensureDirs()
  const issues = ghJson([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "closed",
    "--limit",
    String(MIGRATION_LIMIT),
    "--json",
    "number,title,url,state,closedAt,labels,body",
  ])
  const completed = issues
    .filter(isCompleted)
    .filter(keepByPlatformPolicy)
    .sort((a, b) => a.number - b.number)
  const manifest = readManifest()
  const items = []

  for (const issue of completed) {
    const scope = issueScope(issue)
    const slug = slugify(issue.title || `issue-${issue.number}`)
    const issuePathRel = `${scope}/issues/${issue.number}-${slug}.md`
    const planPathRel = `${scope}/plans/${issue.number}-${slug}-plan.md`
    const issuePath = join(SOR_DIR, issuePathRel)
    const planPath = join(SOR_DIR, planPathRel)

    const prs = linkedPrsForIssue(issue.number)
    const reviewNotes = notesFromPrBodies(prs)
    const issueDoc = renderIssueArtifact(issue, prs, reviewNotes)
    const planDoc = renderPlanArtifact(issue, prs)

    writeFileSafe(issuePath, issueDoc)
    writeFileSafe(planPath, planDoc)

    items.push({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.url,
      scope,
      issueArtifact: issuePathRel,
      planArtifact: planPathRel,
      linkedPrNumbers: prs.map((pr) => pr.number).sort((a, b) => a - b),
      issueChecksum: checksum(issueDoc),
      planChecksum: checksum(planDoc),
      migratedAt: new Date().toISOString(),
    })
  }

  const nextManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repo: REPO,
    source: {
      ghVersion: ghText(["--version"]).split("\n")[0],
      prLookupEnabled: MIGRATION_LOOKUP_PRS,
      closedIssuesScanned: issues.length,
      completedIssuesMigrated: completed.length,
      platformPolicy: "exclude_ios_android_and_keep_expo_only_for_mobile",
    },
    items,
  }

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    "utf8",
  )

  const lines = [
    "# Migrated Work Catalog",
    "",
    "This catalog is generated/updated by the migration pipeline.",
    "",
    "## Summary",
    "",
    `- Closed issues scanned: ${issues.length} (limit: ${MIGRATION_LIMIT})`,
    `- Completed issues migrated: ${completed.length}`,
    "",
    "## Scope Breakdown",
    "",
  ]
  for (const scope of SCOPES) {
    const count = items.filter((item) => item.scope === scope).length
    lines.push(`- ${scope}: ${count}`)
  }
  lines.push("", "## Issue Artifacts", "")

  for (const item of items) {
    lines.push(
      `- [#${item.issueNumber}: ${item.issueTitle}](${item.issueArtifact}) | [plan](${item.planArtifact})`,
    )
  }

  if (!items.length) {
    lines.push("- No completed issues matched migration criteria.")
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- Source links are preserved in each artifact.",
  )
  lines.push("- Use `migration-manifest.json` for deterministic state.")
  writeFileSync(INDEX_PATH, `${lines.join("\n")}\n`, "utf8")

  console.log(
    `Migrated ${completed.length} completed issues out of ${issues.length} closed issues.`,
  )
}

main()
