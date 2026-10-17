import {
  CurrentPermissionError,
  currentChangelogPermission,
} from "@/services/changelog-current-permission.service"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some((key) => key !== "clientId") ||
    query.getAll("clientId").length !== 1
  )
    return reply({ error: "invalid-request" }, 400)
  try {
    return reply(
      await currentChangelogPermission(
        request.headers.get("authorization"),
        query.get("clientId")!,
      ),
    )
  } catch (error) {
    return error instanceof CurrentPermissionError
      ? reply({ error: error.message }, error.status)
      : reply({ error: "permission-unavailable" }, 503)
  }
}

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}
