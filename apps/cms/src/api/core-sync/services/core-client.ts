import { print } from "graphql"
import type { TypedDocumentNode } from "@graphql-typed-document-node/core"

const CORE_SYNC_URL =
  process.env.CORE_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"

/**
 * Lightweight typed GraphQL client using raw fetch + graphql's print().
 *
 * We intentionally avoid Apollo Client here because @graphql-codegen/client-preset
 * strips optional variable definitions ($where, $input) from the generated
 * DocumentNode AST. Apollo serializes these stripped ASTs, causing the Core API
 * to receive queries without filter parameters — making incremental sync
 * impossible. Using print() re-serializes from the full AST which preserves
 * all variable definitions.
 *
 * Type safety is preserved via TypedDocumentNode generics from gql.tada.
 */
export function getCoreClient() {
  return {
    query: async <TData, TVars extends Record<string, unknown>>({
      query,
      variables,
    }: {
      query: TypedDocumentNode<TData, TVars>
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
