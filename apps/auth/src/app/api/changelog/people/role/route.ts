import { ContributorManagementError } from "@/services/changelog-contributors.service"
import {
  setChangelogRole,
  type ChangelogRole,
} from "@/services/changelog-roles.service"

const roles: ChangelogRole[] = ["Admin", "Contributor", "Reader", "No Access"]

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "clientId",
            "recipientId",
            "role",
            "expectedRole",
            "confirmSelfDemotion",
          ].includes(key),
      ) ||
      !("clientId" in body) ||
      !("recipientId" in body) ||
      !("role" in body) ||
      !("expectedRole" in body) ||
      typeof body.clientId !== "string" ||
      typeof body.recipientId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.recipientId) ||
      !roles.includes(body.role as ChangelogRole) ||
      !roles.includes(body.expectedRole as ChangelogRole) ||
      ("confirmSelfDemotion" in body &&
        typeof body.confirmSelfDemotion !== "boolean") ||
      new URL(request.url).search
    )
      return reply({ error: "invalid-request" }, 400)
    return reply(
      await setChangelogRole(
        request.headers.get("authorization"),
        body.clientId,
        body.recipientId,
        body.role as ChangelogRole,
        body.expectedRole as ChangelogRole,
        "confirmSelfDemotion" in body && body.confirmSelfDemotion === true,
      ),
    )
  } catch (error) {
    if (error instanceof SyntaxError)
      return reply({ error: "invalid-request" }, 400)
    return error instanceof ContributorManagementError
      ? reply({ error: error.code }, error.status)
      : reply({ error: "management-unavailable" }, 503)
  }
}

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}
