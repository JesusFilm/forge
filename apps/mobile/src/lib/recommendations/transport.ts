/**
 * Deadline-bounded Apollo calls for the recommendation client. Every budget
 * here sits strictly below the client's 15 s fetch ceiling, so this layer
 * settles first and the caller sees a typed TIMEOUT instead of a generic abort.
 */
import type { OperationVariables, TypedDocumentNode } from "@apollo/client"

import { REQUEST_TIMEOUT_MS, getApolloClient } from "../apolloClient"
import { toRecommendationClientError } from "./errors"

/** The delivery query: one Admin round trip plus admission and issuance. */
export const DELIVERY_DEADLINE_MS = 3_000
/** Evidence, claim, context and playback facts. */
export const EVIDENCE_DEADLINE_MS = 5_000
/** Selection sits on the tap-to-navigate path, so it gets the least. */
export const SELECTION_DEADLINE_MS = 800
/** Bootstrap and viewer status: a profile transaction, like Web's 3 s. */
export const IDENTITY_DEADLINE_MS = 3_000

for (const budget of [
  DELIVERY_DEADLINE_MS,
  EVIDENCE_DEADLINE_MS,
  SELECTION_DEADLINE_MS,
  IDENTITY_DEADLINE_MS,
]) {
  if (budget >= REQUEST_TIMEOUT_MS) {
    throw new Error("recommendation deadline must sit below the fetch ceiling")
  }
}

export type Deadline = { signal: AbortSignal; clear: () => void }

/**
 * An abort signal that fires after `ms`. The runtime's own helper when
 * present; otherwise a timer the caller clears on settle, so a fast answer
 * does not leave one armed timer per request behind.
 */
export function deadline(ms: number): Deadline {
  const withTimeout = AbortSignal as unknown as {
    timeout?: (ms: number) => AbortSignal
  }
  if (typeof withTimeout.timeout === "function") {
    return { signal: withTimeout.timeout(ms), clear: () => undefined }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/**
 * Run a mutation with a deadline and no cache. Rejects with a
 * RecommendationClientError on every failure path, including a missing body.
 * The document's own types decide the variables and the result.
 */
export async function mutateWithDeadline<
  TData,
  TVariables extends OperationVariables,
>(
  mutation: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  deadlineMs: number,
): Promise<TData> {
  const budget = deadline(deadlineMs)
  try {
    const result = await getApolloClient().mutate<TData, TVariables>({
      mutation,
      variables,
      fetchPolicy: "no-cache",
      context: { fetchOptions: { signal: budget.signal } },
    })
    if (result.data == null) {
      throw new Error("recommendation mutation returned no data")
    }
    return result.data
  } catch (error) {
    throw toRecommendationClientError(error)
  } finally {
    budget.clear()
  }
}

/** Run a query with a deadline and no cache; same failure contract as above. */
export async function queryWithDeadline<
  TData,
  TVariables extends OperationVariables,
>(
  query: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  deadlineMs: number,
): Promise<TData> {
  const budget = deadline(deadlineMs)
  try {
    const result = await getApolloClient().query<TData, TVariables>({
      query,
      variables,
      fetchPolicy: "no-cache",
      context: { fetchOptions: { signal: budget.signal } },
    })
    if (result.error) throw result.error
    if (result.data == null) {
      throw new Error("recommendation query returned no data")
    }
    return result.data
  } catch (error) {
    throw toRecommendationClientError(error)
  } finally {
    budget.clear()
  }
}
