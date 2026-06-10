/**
 * Thin fetch wrapper for admin's own GraphQL endpoint at /api/graphql.
 *
 * Defaults to same-origin browser POST; server actions may pass an
 * absolute endpoint and server-side bearer. Returns a discriminated outcome:
 * - { ok: true, data } when the response carries data with no errors
 * - { ok: false, errors } when GraphQL returned errors[]
 * - { ok: false, errors: [{ message: ... }] } on network / parse failure
 *
 * No client library, no codegen — operation strings live next to
 * each consumer. Promote to src/lib if a second consumer appears.
 */

export type GraphQLResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Array<{ message: string }> }

export type ExecuteGraphQLOptions = {
  bearerToken?: string
  endpoint?: string
  origin?: string | null
}

function authorizationHeaderValue(token: string | undefined): string | null {
  const trimmed = token?.trim()
  if (!trimmed) return null
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

export async function executeGraphQL<
  TData,
  TVars extends Record<string, unknown>,
>(
  query: string,
  variables: TVars,
  options: ExecuteGraphQLOptions = {},
): Promise<GraphQLResult<TData>> {
  let response: Response
  const authorization = authorizationHeaderValue(options.bearerToken)
  const origin = options.origin?.trim()
  try {
    response = await fetch(options.endpoint ?? "/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    })
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          message:
            error instanceof Error
              ? `Network error: ${error.message}`
              : "Network error",
        },
      ],
    }
  }

  let payload: { data?: TData; errors?: Array<{ message: string }> }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return {
      ok: false,
      errors: [
        { message: `Invalid JSON response (status ${response.status})` },
      ],
    }
  }

  if (payload.errors && payload.errors.length > 0) {
    return { ok: false, errors: payload.errors }
  }
  if (payload.data == null) {
    return {
      ok: false,
      errors: [{ message: `Empty response (status ${response.status})` }],
    }
  }
  return { ok: true, data: payload.data }
}
