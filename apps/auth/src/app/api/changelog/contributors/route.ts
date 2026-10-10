import {
  ContributorManagementError,
  manageChangelogContributors,
} from "@/services/changelog-contributors.service"

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    if (
      [...query.keys()].some((key) => key !== "clientId") ||
      query.getAll("clientId").length !== 1
    ) {
      return reply({ error: "invalid-request" }, 400)
    }
    return reply(
      await manageChangelogContributors(
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
      Object.keys(body).length !== 2 ||
      !("clientId" in body) ||
      !("recipientId" in body) ||
      typeof body.clientId !== "string" ||
      typeof body.recipientId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.recipientId) ||
      new URL(request.url).search
    ) {
      return reply({ error: "invalid-request" }, 400)
    }
    return reply(
      await manageChangelogContributors(
        request.headers.get("authorization"),
        body.clientId,
        body.recipientId,
      ),
    )
  } catch (error) {
    if (error instanceof SyntaxError)
      return reply({ error: "invalid-request" }, 400)
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
  return error instanceof ContributorManagementError
    ? reply({ error: error.code }, error.status)
    : reply({ error: "management-unavailable" }, 503)
}
