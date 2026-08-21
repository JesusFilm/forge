// Compatibility-safe global ceiling for existing deeply-composed Admin
// operations. Playlist-specific text/item limits remain much tighter in Zod.
const MAX_GRAPHQL_BODY_BYTES = 1024 * 1024

export type GraphqlRequestAdmission =
  | { admitted: true }
  | { admitted: false; status: 400 | 413 }

/** Bounds payload bytes and rejects JSON array batching before GraphQL parse. */
export async function admitGraphqlRequest(
  request: Request,
): Promise<GraphqlRequestAdmission> {
  if (request.method !== "POST") return { admitted: true }
  const declared = request.headers.get("content-length")
  if (declared && Number(declared) > MAX_GRAPHQL_BODY_BYTES) {
    return { admitted: false, status: 413 }
  }
  const body = await request.clone().text()
  if (Buffer.byteLength(body, "utf8") > MAX_GRAPHQL_BODY_BYTES) {
    return { admitted: false, status: 413 }
  }
  if (body.trimStart().startsWith("[")) {
    return { admitted: false, status: 400 }
  }
  return { admitted: true }
}
