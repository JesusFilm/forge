// TV-only for now: mobile still gates on the retired `Search` name and has not
// migrated. Each app also ships its OWN fleet key value — never copy a token.
//
// TWO CREDENTIALS, TWO ALLOWLISTS (feat-322 U4.9)
// ----------------------------------------------
// This module now hands out two different bearers, and they are NOT
// interchangeable:
//
//   FLEET token (`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`) — one value baked into
//     every TV binary. It identifies the FLEET, not a person, and its only job
//     is to buy a per-device rate-limit bucket on the public `watchSearch`.
//
//   USER access token (feat-322 device grant) — one per signed-in viewer, held
//     in secure storage, carrying the `web:watch-events:write` scope. It
//     identifies a PERSON.
//
// Never merge them, never substitute one for the other, and never widen either
// onto `HttpLink.headers` — a global header would put the fleet key on every
// public query (pooling the whole fleet into one bucket) and the user's token
// on operations that have no business seeing it. Allowlisting is per OPERATION
// and the two allowlists are disjoint; `overlappingAllowlistOperations()` is
// the test-enforced invariant.

/**
 * Consumer-bearer header builder. Absent token returns the anonymous shape so
 * the app still boots and public queries work where no key is provisioned.
 */
export function buildAuthHeaders(
  token: string | undefined,
): Record<string, string> {
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** Search operation name. Renamed with admin's Query.search → watchSearch (#1622).
 *  MUST equal the `query <name>` in WATCH_SEARCH or the bearer attaches nowhere. */
export const SEARCH_OPERATION_NAME = "WatchSearch"

/**
 * Watch-event write. MUST equal the `mutation <name>` in the TV document that
 * flushes `flushWatchEventQueue` into admin's `recordWatchEvent` (matching
 * apps/web's `RecordWatchEvent`), or the user bearer attaches to nothing and
 * every flush is rejected as anonymous — the #1622 rename trap, one credential
 * over. When that document lands, pin it here the way mobile pins its own:
 * parse the document and assert `operation.name.value === this constant`.
 */
export const WATCH_EVENT_OPERATION_NAME = "RecordWatchEvent"

/** Viewer-scoped watch-progress ops (feat-322 Continue Watching account
 *  merge). MUST equal the `query`/`mutation` names in
 *  `watchEvents/watchProgressDocuments.ts` — pinned there by contract test,
 *  same rename trap as the watch-event op above. */
export const PROGRESS_QUERY_OPERATION_NAME = "MyWatchProgress"
export const PROGRESS_UPSERT_OPERATION_NAME = "UpsertMyWatchProgress"
export const PROGRESS_CLEAR_OPERATION_NAME = "ClearMyWatchProgress"

/** Operations that may carry the baked-in FLEET token. */
export const FLEET_TOKEN_OPERATIONS: readonly string[] = [SEARCH_OPERATION_NAME]

/**
 * Operations that may carry the SIGNED-IN USER's access token — the viewer's
 * OWN watch data only: the watch-event write plus the three watch-progress ops
 * (admin resolves the account from the introspected token, so these can only
 * ever touch the signed-in viewer's rows).
 *
 * `WatchSearch` is deliberately absent and must stay absent: admin buckets
 * search by the credential presented, so a user bearer there would move the
 * device out of its `consumer:<fleet-key>:v:<viewer_id>` bucket and change the
 * rate-limit identity the whole fleet is sized against.
 */
export const USER_TOKEN_OPERATIONS: readonly string[] = [
  WATCH_EVENT_OPERATION_NAME,
  PROGRESS_QUERY_OPERATION_NAME,
  PROGRESS_UPSERT_OPERATION_NAME,
  PROGRESS_CLEAR_OPERATION_NAME,
]

/**
 * The disjointness invariant, as data rather than a boot-time throw: a throw at
 * module scope would take the whole app down on a TV with no console. Returns
 * the operations that appear on BOTH allowlists — must always be empty.
 */
export function overlappingAllowlistOperations(): string[] {
  return FLEET_TOKEN_OPERATIONS.filter((op) =>
    USER_TOKEN_OPERATIONS.includes(op),
  )
}

/**
 * Scoped to the search op only. Not an auth requirement (watchSearch is public)
 * — it buys the per-device rate-limit bucket; on other public ops it would pool
 * the whole fleet into one.
 */
export function authHeadersForOperation(
  operationName: string | undefined,
  token: string | undefined,
  viewerId?: string,
): Record<string, string> {
  // Reads the allowlist rather than comparing against the constant directly, so
  // FLEET_TOKEN_OPERATIONS is the single source of truth both this and the
  // disjointness invariant consult. Behaviour is unchanged: the list is [search].
  if (!operationName) return {}
  if (!FLEET_TOKEN_OPERATIONS.includes(operationName)) return {}
  const headers = buildAuthHeaders(token)
  // x-viewer-id lets admin bucket per-install (CGNAT-immune) instead of per-IP;
  // spoofable, so admin treats it as an availability label only.
  if (viewerId) headers["x-viewer-id"] = viewerId
  return headers
}

/**
 * The signed-in viewer's bearer, scoped to the watch-event write allowlist.
 *
 * Unlike the fleet bearer this IS an auth requirement: admin's
 * `usableWebUserSubject` rejects a token whose scopes omit
 * `web:watch-events:write`, and a missing bearer makes the write anonymous.
 * Signed-out (no token) is a normal state and returns the anonymous shape —
 * the flush retains the event rather than failing.
 */
export function userAuthHeadersForOperation(
  operationName: string | undefined,
  userAccessToken: string | undefined,
): Record<string, string> {
  if (!operationName) return {}
  if (!USER_TOKEN_OPERATIONS.includes(operationName)) return {}
  return buildAuthHeaders(userAccessToken)
}

export type OperationHeaderInputs = {
  operationName: string | undefined
  /** `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` — the whole fleet's shared key. */
  fleetToken: string | undefined
  /** The signed-in viewer's access token, or undefined when signed out. */
  userAccessToken: string | undefined
  viewerId?: string
}

/**
 * The one place both credentials are considered together — and it is a
 * SELECTION, not a merge: the two allowlists are disjoint, so at most one of
 * them can produce an `Authorization` header for any operation.
 *
 * If both ever do, that is a bug in the allowlists, and this returns NEITHER.
 * Picking a winner would silently ship the wrong credential; sending nothing
 * degrades the call (public bucket / anonymous write) and stays diagnosable.
 */
export function headersForOperation({
  operationName,
  fleetToken,
  userAccessToken,
  viewerId,
}: OperationHeaderInputs): Record<string, string> {
  // Asks the ALLOWLISTS, not the headers they happened to produce. Keying on
  // `fleet.Authorization && user.Authorization` fails OPEN in the state this
  // app documents as normal: an unprovisioned `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`
  // yields no fleet Authorization, so an overlapping operation would sail past
  // the guard and ship the USER's bearer — the exact outcome it exists to
  // prevent. The overlap is what is wrong; neither credential may ride it.
  if (
    operationName != null &&
    FLEET_TOKEN_OPERATIONS.includes(operationName) &&
    USER_TOKEN_OPERATIONS.includes(operationName)
  ) {
    console.error(
      "[tv-auth] event=bearer_allowlist_overlap reason=two_credentials_one_operation",
    )
    return {}
  }

  const fleet = authHeadersForOperation(operationName, fleetToken, viewerId)
  const user = userAuthHeadersForOperation(operationName, userAccessToken)
  return { ...fleet, ...user }
}
