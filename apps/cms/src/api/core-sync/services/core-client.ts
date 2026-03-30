import { print } from "graphql"
import type { DocumentNode } from "graphql"
import type { TypedDocumentNode } from "@graphql-typed-document-node/core"

const CORE_SYNC_URL =
  process.env.CORE_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"

/**
 * Lightweight GraphQL client that sends queries via raw fetch.
 *
 * Apollo Client strips optional variable definitions ($where, $input) from
 * the serialized query when gql.tada types mark them as optional, causing
 * the Core API to ignore filters and return all records. Using raw fetch
 * with graphql's `print()` preserves the full query text including variable
 * definitions.
 */
export function getCoreClient() {
  return {
    query: async <TData, TVars extends Record<string, unknown>>({
      query,
      variables,
    }: {
      query: TypedDocumentNode<TData, TVars> | DocumentNode
      variables?: TVars
    }): Promise<{ data: TData }> => {
      const res = await fetch(CORE_SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: print(query),
          variables: variables ?? {},
        }),
      })

      if (!res.ok) {
        throw new Error(`Core API HTTP ${res.status}: ${res.statusText}`)
      }

      const json = (await res.json()) as {
        data?: TData
        errors?: Array<{ message: string }>
      }

      if (json.errors?.length && !json.data) {
        throw new Error(
          `Core API GraphQL error: ${json.errors[0]?.message ?? "Unknown"}`,
        )
      }

      return { data: json.data as TData }
    },
  }
}
