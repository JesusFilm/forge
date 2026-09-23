import { env } from "@/config/env"
import { studioIdSchema } from "@forge/studio-contracts"
import { StudioBoundaryError } from "@forge/studio-server"

const managerOrigin = () =>
  new URL(env.MANAGER_BASE_URL ?? "http://localhost:3002")

/** Links identify the project; revision is evidence, never an approval or snapshot selector. */
export function projectReviewLink(projectId: string, revision: number) {
  const url = new URL(
    `/dashboard/shorts/${encodeURIComponent(studioIdSchema.parse(projectId))}`,
    managerOrigin(),
  )
  url.searchParams.set("revision", String(revision))
  return url.toString()
}
export function withProjectLink<
  T extends { projectId: string; revision: number },
>(project: T) {
  return {
    ...project,
    reviewUrl: projectReviewLink(project.projectId, project.revision),
  }
}
export function resolveProjectLink(raw: string) {
  const url = new URL(raw)
  const match = url.pathname.match(/^\/dashboard\/shorts\/([^/]+)\/?$/)
  if (
    url.origin !== managerOrigin().origin ||
    url.username ||
    url.password ||
    !match
  )
    throw new StudioBoundaryError(
      "Use a project link from this Studio environment",
      400,
    )
  return studioIdSchema.parse(decodeURIComponent(match[1]))
}
