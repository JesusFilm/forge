import { ContributorManagementError } from "@/services/changelog-contributors.service"
import { listChangelogPeople } from "@/services/changelog-people.service"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some((key) => key !== "clientId") ||
    query.getAll("clientId").length !== 1
  )
    return reply({ error: "invalid-request" }, 400)
  try {
    return reply(
      await listChangelogPeople(
        request.headers.get("authorization"),
        query.get("clientId")!,
      ),
    )
  } catch (error) {
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
