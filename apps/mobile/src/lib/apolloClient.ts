import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { ErrorLink } from "@apollo/client/link/error"
import { getMainDefinition } from "@apollo/client/utilities"
import { getApiToken, getGraphQLUrl } from "./config"
import { authHeadersForOperation, isProgressOperation } from "./authHeaders"
// Safe as a static import: authSession's native-adjacent deps load lazily
// inside its own getters, so this pulls no native module into jest.
import { getAuthSession } from "./authSession"
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

/**
 * Typed marker for aborts THIS client initiated (15s budget, unmount/supersede).
 * The signal — not name or message — is the only trustworthy discriminator, so
 * the abort is classified where the signal is in scope.
 */
export class ClientAbortError extends Error {
  readonly isClientAbort = true
  constructor(cause?: unknown) {
    // User-facing copy: the watch/series error screens render `error.message`
    // verbatim, so an internal string would reach the screen. Classification
    // reads isClientAbort/name, never this text.
    super("The request timed out. Please try again.")
    this.name = "ClientAbortError"
    this.cause = cause
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

  return fetch(input, { ...init, signal: controller.signal })
    .catch((error: unknown) => {
      // RN rejects a cancelled request as a name-less Error("Aborted") (400 such
      // prod RUM events), so the downstream name check cannot see it. Convert
      // here, where the signal proves the abort was ours.
      if (controller.signal.aborted) throw new ClientAbortError(error)
      throw error
    })
    .finally(() => clearTimeout(id))
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
 * User-JWT link (KTD10): for exactly the three progress operations, awaits
 * the session module's refresh-if-expired JWT and merges the Bearer header.
 * Every other operation forwards SYNCHRONOUSLY and untouched — public
 * queries never carry the user token (the fleet-bearer law), and the
 * existing sync header links stay sync. A failed or absent mint forwards
 * without the header (the server denies; the caller fails open, R11).
 */
export function createUserJwtLink(
  getJwt: () => Promise<string | null>,
): ApolloLink {
  return new ApolloLink((operation, forward) => {
    if (!isProgressOperation(operation.operationName)) {
      return forward(operation)
    }
    return new Observable<ApolloLink.Result>((subscriber) => {
      let innerSubscription: { unsubscribe: () => void } | undefined
      let cancelled = false
      const proceed = (jwt: string | null) => {
        if (cancelled) return
        if (jwt) {
          mergeContextHeaders(operation, { Authorization: `Bearer ${jwt}` })
        }
        innerSubscription = forward(operation).subscribe(subscriber)
      }
      getJwt().then(proceed, () => proceed(null))
      return () => {
        cancelled = true
        innerSubscription?.unsubscribe()
      }
    })
  })
}

/**
 * The request chain minus transport (auth + Datadog attribution). Exported so
 * tests can prove the Search bearer survives the attribution merge (R9).
 */
export function createRequestChain(): ApolloLink {
  // Async user-JWT link sits AHEAD of the sync header links (KTD10):
  // a sync extension could not await the session module's refresh.
  const userJwtLink = createUserJwtLink(() => getAuthSession().getFreshJwt())
  return userJwtLink.concat(createHeaderChain())
}

function createHeaderChain(): ApolloLink {
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

const MAX_CAUSE_DEPTH = 3

// Typed marker FIRST: RN rejects a cancelled request as a name-less
// Error("Aborted"), so name alone missed 400 prod aborts. Never match on message
// text — a server error could legitimately say "Aborted".
function isClientAbortError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error == null) return false
  const candidate = error as {
    name?: unknown
    isClientAbort?: unknown
    cause?: unknown
  }
  if (candidate.isClientAbort === true) return true
  if (candidate.name === "AbortError") return true
  // Apollo may wrap the abort. Depth-bounded: an unbounded walk lets a cause
  // CYCLE throw RangeError out of reportGraphqlOperationError, which has no
  // safeDatadogCall wrapper and would escape into the Apollo error link.
  if (depth >= MAX_CAUSE_DEPTH || candidate.cause == null) return false
  return isClientAbortError(candidate.cause, depth + 1)
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
