import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { ErrorLink } from "@apollo/client/link/error"
import { getMainDefinition } from "@apollo/client/utilities"
import { getApiToken, getGraphQLUrl } from "./config"
import { authHeadersForOperation } from "./authHeaders"
import { WATCH_SEARCH_EVENT_OPERATION_NAME } from "./queries"
import { getViewerId } from "./viewer-id"
import {
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER,
  datadogGraphqlHeaders,
  datadogLog,
  isDatadogProvisioned,
  reportDatadogError,
} from "./datadog"

const REQUEST_TIMEOUT_MS = 15_000

// Read the Datadog op-name attribution header back off the request init so the
// timeout marker can say WHICH operation blew the budget (feat-268). Only the
// bounded op name is logged — never URLs, variables, or other header values.
function operationNameFromInit(init?: RequestInit): string {
  try {
    const headers = init?.headers
    if (!headers) return "anonymous"
    if (typeof (headers as Headers).get === "function") {
      return (
        (headers as Headers).get(DATADOG_GRAPH_QL_OPERATION_NAME_HEADER) ??
        "anonymous"
      )
    }
    const wanted = DATADOG_GRAPH_QL_OPERATION_NAME_HEADER.toLowerCase()
    const entries = Array.isArray(headers)
      ? headers
      : Object.entries(headers as Record<string, string>)
    const hit = entries.find(([name]) => name.toLowerCase() === wanted)
    return hit?.[1] ?? "anonymous"
  } catch {
    // Telemetry must never break the app; an unreadable shape loses only
    // attribution.
    return "anonymous"
  }
}

// Exported for the timeout-marker test.
export const fetchWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => {
    // Mark the client's own 15s deadline distinctly from an upstream abort or a
    // true network failure (R12/AE3): RUM records an aborted resource either way,
    // so this marker separates "client gave up" from "admin is slow".
    if (isDatadogProvisioned()) {
      datadogLog.warn("graphql.client_timeout_abort", {
        budget_ms: REQUEST_TIMEOUT_MS,
        operation: operationNameFromInit(init),
      })
    }
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  if (init?.signal) {
    init.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id),
  )
}

// Spread-merge so header links compose: each rides over what prior links set.
// NEVER a header-replacing setContext — that would drop the Search bearer the
// authLink set (mobile PR #1226 precedent).
function mergeContextHeaders(
  operation: ApolloLink.Operation,
  headers: Record<string, string>,
): void {
  if (Object.keys(headers).length === 0) return
  const prev = operation.getContext()
  operation.setContext({ headers: { ...(prev.headers ?? {}), ...headers } })
}

/**
 * The request chain minus transport (auth + Datadog attribution). Exported so
 * tests can prove the Search bearer survives the attribution merge (R9).
 */
export function createRequestChain(): ApolloLink {
  // Bearer + x-viewer-id ride ONLY on the Search op: admin buckets a fleet key
  // per device (consumer:<key>:v:<viewer_id> from x-viewer-id, else per IP).
  // On public ops the bearer would pool the whole fleet into one bucket.
  const authLink = new ApolloLink((operation, forward) => {
    mergeContextHeaders(
      operation,
      authHeadersForOperation(
        operation.operationName,
        getApiToken(),
        getViewerId(),
      ),
    )
    return forward(operation)
  })

  // Datadog op-name/type attribution rides every named op. RUM's XHR proxy maps
  // these onto the RUM resource, so trackResources attributes each GraphQL
  // resource by operation (path A content correlation — no resource attribute).
  const datadogLink = new ApolloLink((operation, forward) => {
    const def = getMainDefinition(operation.query)
    mergeContextHeaders(
      operation,
      datadogGraphqlHeaders(
        operation.operationName,
        def.kind === "OperationDefinition" ? def.operation : undefined,
      ),
    )
    return forward(operation)
  })

  // Unprovisioned builds skip the attribution link entirely (null-gate).
  return isDatadogProvisioned() ? authLink.concat(datadogLink) : authLink
}

// Every real RN abort carries name "AbortError" — whatwg-fetch sets it on both
// its DOMException and fallback-Error paths. Never match on message text: a
// server GraphQL error's message could collide (e.g. exactly "Aborted").
function isClientAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    (error as { name?: unknown }).name === "AbortError"
  )
}

/**
 * Surfaces GraphQL failures that arrive inside an HTTP-200 body (unauthenticated,
 * rate-limited, service-unavailable, partial `errors[]`) and network errors —
 * both invisible to RUM's resource tracking, which only sees the 200 (R13). Keyed
 * by operation name + error code so the agent can slice by operation and cause.
 * Pure + exported so the branch logic is unit-testable without driving the link.
 */
export function reportGraphqlOperationError(
  error: unknown,
  operationName: string | undefined,
): void {
  // Anonymous event mutations accept per-IP rate shedding (KTD6); a shed
  // event filing a RUM error would turn designed shedding into noise.
  if (operationName === WATCH_SEARCH_EVENT_OPERATION_NAME) return
  if (!isDatadogProvisioned()) return
  const operation = operationName ?? "anonymous"
  if (CombinedGraphQLErrors.is(error)) {
    const code =
      (error.errors[0]?.extensions?.code as string | undefined) ?? "unknown"
    reportDatadogError(error, { origin: "graphql_error", operation, code })
    return
  }
  // Client-initiated aborts (timeout budget, unmount/supersede) are noise, not
  // failures; the 15s timeout already emits graphql.client_timeout_abort (R12).
  if (isClientAbortError(error)) return
  reportDatadogError(error, { origin: "graphql_network_error", operation })
}

// onError-style link (v4 ErrorLink): every operation's downstream failure routes
// through the pure reporter. Self-gates on provisioning, so always safe in-chain.
function createErrorLink(): ErrorLink {
  return new ErrorLink(({ error, operation }) => {
    reportGraphqlOperationError(error, operation.operationName)
  })
}

let _client: ApolloClient | undefined

/**
 * Lazy singleton Apollo Client.
 * Never instantiate at module scope — crashes imports when env vars are missing in CI.
 */
export function getApolloClient(): ApolloClient {
  if (_client) return _client

  // errorLink is outermost so it observes failures from every downstream link.
  const link = ApolloLink.from([
    createErrorLink(),
    createRequestChain(),
    new HttpLink({
      uri: getGraphQLUrl(),
      fetch: fetchWithTimeout,
    }),
  ])

  _client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
  })

  return _client
}
