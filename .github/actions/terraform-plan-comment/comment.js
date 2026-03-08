async function main({ github, context, core, fs, path }) {
  if (context.payload.pull_request?.head?.repo?.fork) {
    core.info("Skipping PR comment for forked repository context.")
    return
  }

  const stack = core.getInput("stack", { required: true })
  const env = (core.getInput("env") || "").trim()
  const exitCode = Number(core.getInput("exit_code", { required: true }) || "1")
  const outputPath = path.join(
    process.env.GITHUB_WORKSPACE || ".",
    core.getInput("output_file", { required: true }),
  )
  const fallbackPathRaw = (core.getInput("fallback_log") || "").trim()
  const fallbackPath = fallbackPathRaw
    ? path.join(process.env.GITHUB_WORKSPACE || ".", fallbackPathRaw)
    : ""
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`

  const marker = env
    ? `<!-- terraform-plan-${stack}:${env} -->`
    : `<!-- terraform-plan-${stack} -->`
  const envLabel = env ? `/${env}` : ""

  let plan = ""
  let usedFallback = false
  try {
    plan = fs.readFileSync(outputPath, "utf8")
  } catch (e) {
    if (fallbackPath) {
      try {
        plan = fs.readFileSync(fallbackPath, "utf8")
        usedFallback = true
      } catch (e2) {
        plan = `Unable to read plan output: ${e.message}. Fallback log: ${e2.message}`
      }
    } else {
      plan = `Unable to read ${outputPath}: ${e.message}`
    }
  }
  if (!usedFallback && plan.trim() === "") {
    if (fallbackPath) {
      try {
        plan = fs.readFileSync(fallbackPath, "utf8")
        usedFallback = true
      } catch (e2) {
        plan = "Plan output empty and no fallback log available."
      }
    } else if (plan.trim() === "") {
      plan = "Plan output empty."
    }
  }

  const summaryMatch = plan.match(
    /Plan:\s+(\d+)\s+to add,\s+(\d+)\s+to change,\s+(\d+)\s+to destroy\./,
  )
  const addCount = summaryMatch ? Number(summaryMatch[1]) : 0
  const changeCount = summaryMatch ? Number(summaryMatch[2]) : 0
  const destroyCount = summaryMatch ? Number(summaryMatch[3]) : 0
  const totalChanges = addCount + changeCount + destroyCount
  const status = usedFallback
    ? "Pre-plan step failed (format/validate/init)"
    : exitCode === 1
      ? "Plan failed"
      : summaryMatch
        ? totalChanges > 0
          ? "Changes detected"
          : "No changes"
        : exitCode === 2
          ? "Changes detected"
          : "No changes"
  const icon = usedFallback
    ? "❌"
    : exitCode === 1
      ? "❌"
      : summaryMatch
        ? totalChanges > 0
          ? "🟨"
          : "✅"
        : exitCode === 2
          ? "🟨"
          : "✅"
  const changeSummary = summaryMatch
    ? `+${addCount} ~${changeCount} -${destroyCount}`
    : "n/a"

  const now = new Date()
  const fmt = (tz, label) => [
    label,
    now.toLocaleString("en-CA", {
      timeZone: tz,
      dateStyle: "short",
      timeStyle: "medium",
    }),
  ]
  const timeRows = [
    fmt("UTC", "UTC"),
    fmt("Pacific/Auckland", "NZ"),
    fmt("America/Los_Angeles", "PT"),
    fmt("America/New_York", "ET"),
  ].map(([label, time]) => `| ${label} | ${time} |`)
  const timeTable = ["| TZ | Time |", "| --- | --- |", ...timeRows].join("\n")

  const maxLen = 45000
  if (plan.length > maxLen) {
    plan = `${plan.slice(0, maxLen)}\n\n... (truncated)`
  }

  const body = [
    marker,
    `## ${icon} Terraform plan (${stack}${envLabel}) — ${status}`,
    `**Changes:** ${changeSummary}`,
    "**Time:**",
    timeTable,
    "",
    `Run: ${runUrl}`,
    "",
    "```",
    plan,
    "```",
  ].join("\n")

  try {
    const { data: comments } = await github.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      per_page: 100,
    })

    const existing = comments.find(
      (c) => c.user?.type === "Bot" && c.body?.includes(marker),
    )

    if (existing) {
      await github.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existing.id,
        body,
      })
    } else {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body,
      })
    }
  } catch (error) {
    if (error.status === 403) {
      core.warning(
        "Skipping PR plan comment: token has no write access in this context.",
      )
      return
    }
    throw error
  }
}

module.exports = main
