async function main({ github, context, core, fs, path }) {
  const octokit = github.getOctokit(process.env.GITHUB_TOKEN)

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

  const marker = env
    ? `<!-- terraform-plan-${stack}:${env} -->`
    : `<!-- terraform-plan-${stack} -->`
  const envLabel = env ? `/${env}` : ""

  let plan = ""
  try {
    plan = fs.readFileSync(outputPath, "utf8")
  } catch (e) {
    plan = `Unable to read ${outputPath}: ${e.message}`
  }

  const summaryMatch = plan.match(
    /Plan:\s+(\d+)\s+to add,\s+(\d+)\s+to change,\s+(\d+)\s+to destroy\./,
  )
  const addCount = summaryMatch ? Number(summaryMatch[1]) : 0
  const changeCount = summaryMatch ? Number(summaryMatch[2]) : 0
  const destroyCount = summaryMatch ? Number(summaryMatch[3]) : 0
  const totalChanges = addCount + changeCount + destroyCount
  const status =
    exitCode === 1
      ? "Plan failed"
      : summaryMatch
        ? totalChanges > 0
          ? "Changes detected"
          : "No changes"
        : exitCode === 2
          ? "Changes detected"
          : "No changes"
  const icon =
    exitCode === 1
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
  const fmt = (tz, label) =>
    `${label}: ${now.toLocaleString("en-CA", { timeZone: tz, dateStyle: "short", timeStyle: "medium" })}`
  const timestamps = [
    fmt("UTC", "UTC"),
    fmt("Pacific/Auckland", "NZ"),
    fmt("America/Los_Angeles", "PT"),
    fmt("America/New_York", "ET"),
  ].join(" | ")

  const maxLen = 45000
  if (plan.length > maxLen) {
    plan = `${plan.slice(0, maxLen)}\n\n... (truncated)`
  }

  const body = [
    marker,
    `## ${icon} Terraform plan (${stack}${envLabel}) — ${status}`,
    `**Changes:** ${changeSummary}`,
    `**Time:** ${timestamps}`,
    "",
    "```",
    plan,
    "```",
  ].join("\n")

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      per_page: 100,
    })

    const existing = comments.find(
      (c) => c.user?.type === "Bot" && c.body?.includes(marker),
    )

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existing.id,
        body,
      })
    } else {
      await octokit.rest.issues.createComment({
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
