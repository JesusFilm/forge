import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ticketPath = /^docs\/roadmap\/[^/]+\/feat-\d+[^/]*\.md$/

export function ticketId(source) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  return frontmatter?.[1].match(/^id:\s*["']?(feat-\d+)["']?\s*$/m)?.[1]
}

export function introducedCollisions(changed, oldIds, currentIds) {
  const pathsById = new Map()
  for (const [file, id] of currentIds) {
    if (!pathsById.has(id)) pathsById.set(id, [])
    pathsById.get(id).push(file)
  }

  const introducedIds = new Set(
    changed.flatMap((file) => {
      const id = currentIds.get(file)
      return id && oldIds.get(file) !== id ? [id] : []
    }),
  )

  return [...introducedIds].flatMap((id) => {
    const paths = pathsById.get(id)
    return paths.length > 1 ? [{ id, paths: paths.sort() }] : []
  })
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
}

function allTickets(directory, relative = "docs/roadmap") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${relative}/${entry.name}`
    if (entry.isDirectory())
      return allTickets(path.join(directory, entry.name), file)
    return ticketPath.test(file) ? [file] : []
  })
}

function main() {
  const base = process.env.ROADMAP_ID_BASE
  if (!base || !/^[0-9a-f]{40}$/.test(base)) {
    throw new Error("ROADMAP_ID_BASE must be the PR base commit SHA")
  }

  const changed = git(
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    base,
    "HEAD",
    "--",
    "docs/roadmap",
  )
    .split("\n")
    .filter((file) => ticketPath.test(file))
  const currentIds = new Map(
    allTickets("docs/roadmap").map((file) => [
      file,
      ticketId(readFileSync(file, "utf8")),
    ]),
  )
  const oldIds = new Map(
    changed.map((file) => {
      try {
        return [file, ticketId(git("show", `${base}:${file}`))]
      } catch {
        return [file, undefined]
      }
    }),
  )
  const collisions = introducedCollisions(changed, oldIds, currentIds)
  if (collisions.length === 0) {
    console.log("No new roadmap ticket ID collisions.")
    return
  }

  for (const { id, paths } of collisions) {
    console.error(`::error::${id} is used by ${paths.join(", ")}`)
  }
  process.exitCode = 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  main()
}
