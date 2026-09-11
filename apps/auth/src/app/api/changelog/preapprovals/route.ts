import { ContributorManagementError } from "@/services/changelog-contributors.service"
import { manageChangelogPreapprovals } from "@/services/changelog-preapprovals.service"

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    if (
      [...query.keys()].some((key) => key !== "clientId") ||
      query.getAll("clientId").length !== 1
    )
      return reply({ error: "invalid-request" }, 400)
    return reply(
      await manageChangelogPreapprovals(
        request.headers.get("authorization"),
        query.get("clientId")!,
      ),
    )
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      new URL(request.url).search ||
      !("clientId" in body) ||
      typeof body.clientId !== "string" ||
      !("id" in body) ||
      typeof body.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id) ||
      !("action" in body) ||
      Object.keys(body).length !== 4
    )
      return reply({ error: "invalid-request" }, 400)
    if (
      body.action === "create" &&
      "email" in body &&
      typeof body.email === "string" &&
      body.email.trim().length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    ) {
      return reply(
        await manageChangelogPreapprovals(
          request.headers.get("authorization"),
          body.clientId,
          { action: "create", id: body.id, email: body.email },
        ),
      )
    }
    if (
      (body.action === "cancel" || body.action === "renew") &&
      "version" in body &&
      typeof body.version === "number" &&
      Number.isSafeInteger(body.version) &&
      body.version >= 0
    ) {
      return reply(
        await manageChangelogPreapprovals(
          request.headers.get("authorization"),
          body.clientId,
          { action: body.action, id: body.id, version: body.version },
        ),
      )
    }
    return reply({ error: "invalid-request" }, 400)
  } catch (error) {
    return failure(error)
  }
}
function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}
function failure(error: unknown) {
  if (error instanceof SyntaxError)
    return reply({ error: "invalid-request" }, 400)
  return error instanceof ContributorManagementError
    ? reply({ error: error.code }, error.status)
    : reply({ error: "management-unavailable" }, 503)
}
