---
title: Fleet-client bearer must be operation-scoped, never global
date: "2026-06-12"
category: architecture-patterns
module: "apps/mobile"
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "Shipping a bearer token to a mobile/TV fleet via EXPO_PUBLIC_* env vars"
  - "Adding Authorization headers to an Apollo HttpLink for a fleet client"
  - "A phased auth rollout extends to a new consumer app (mobile, TV, eval)"
  - "Deciding which operations on a shared Apollo client carry credentials"
symptoms:
  - "Search returns UNAUTHENTICATED after SEARCH_AUTH_REQUIRED activates on admin"
  - "Browse-category thumbnails disappear (each card is backed by a Query.search call)"
  - "Fleet devices all sharing one rate-limit bucket, risking self-DoS"
root_cause: config_error
resolution_type: code_fix
related_components:
  - "apps/tv"
  - "apps/admin"
  - "packages/admin-graphql"
tags:
  - "bearer-token"
  - "rate-limiting"
  - "apollo-link"
  - "fleet-client"
  - "search-auth"
  - "expo-public"
  - "operation-scoped-auth"
  - "mobile"
---

# Fleet-client bearer must be operation-scoped, never global

> **Mechanism updated 2026-07-23 (admin #1622).** The incident below is
> historical: `Query.search` and `SEARCH_AUTH_REQUIRED` no longer exist, and the
> replacement `watchSearch` is unconditionally public — a missing or stale bearer
> is now IGNORED, never rejected, so this failure never presents as
> `UNAUTHENTICATED` again. The **rule is unchanged and was re-proved on TV**: the
> bearer must stay scoped to exactly the search operation, and the operation name
> is now `WatchSearch`. What changed is the symptom — a mismatch is silent, and
> costs only the per-device rate-limit bucket, which makes it harder to notice.
> `apps/tv` now pins the constant to the query document with a source-scanning
> guard test; see
> `docs/solutions/best-practices/compile-shim-empty-return-hides-downstream-contract-drift.md`.

## Context

When admin activated `SEARCH_AUTH_REQUIRED` (Plan 002 phased search-auth
rollout), `Query.search` began rejecting anonymous callers with
`GraphQLError { extensions: { code: "UNAUTHENTICATED" } }`. Plan 002 Unit 7
wired the consumer bearer for `apps/web` SSR but never landed for
`apps/mobile`, whose Apollo client sent no `Authorization` header at all.

On the mobile Discover tab this surfaced as two simultaneous symptoms with one
cause: the six browse-category cards lost their video thumbnails (each card
fetches its image via a `limit:1` `Search` call in `useCategoryThumbnails`,
errors swallowed silently) and every typed search showed "Search failed.
Please try again." Home and video detail pages kept working — they use public
queries (`watchSetting`, `experienceBySlug`, `videoBySlug`) that are not
gated.

Prior sessions confirm the timeline: the category-thumbnails feature was
verified end-to-end working anonymously on 2026-06-07 → 06-09, and an earlier
session had deliberately stripped the legacy Strapi bearer, establishing
"no token" as the mobile client's intended baseline (session history). The
auth flip landed after that, with no mobile-side plumbing to meet it.

Reproduction against prod admin:

```bash
# Anonymous — rejected once SEARCH_AUTH_REQUIRED is active
curl -sS -X POST https://admin.jesusfilm.org/api/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query S($q: String!, $locale: String!) { search(q: $q, locale: $locale, limit: 1) { results { slug } } }","variables":{"q":"jesus","locale":"en"}}'
# → {"errors":[{"message":"Authentication required","extensions":{"code":"UNAUTHENTICATED"}}],...}

# Same query with a WEB_ADMIN_API_KEYS entry as bearer → results
```

## Guidance

**When a device fleet shares one baked-in bearer, attach it only to the
operations the server actually gates — never globally on the HTTP link.**

The first implementation attached the bearer globally on the `HttpLink`,
copying `apps/tv`'s existing pattern. It passed unit tests, typecheck, and
simulator verification; multi-agent review caught the problem before merge:

```ts
// REJECTED — do not copy. The helper is fine; the HttpLink-wide placement
// is the bug: it attaches the bearer to every request.
const link = new HttpLink({
  uri: getGraphQLUrl(),
  headers: buildAuthHeaders(getApiToken()),
  fetch: fetchWithTimeout,
})
```

Shipped shape — scope the header per-operation (`apps/mobile/src/lib/authHeaders.ts`

- `apps/mobile/src/lib/apolloClient.ts`):

```ts
export const SEARCH_OPERATION_NAME = "Search"

export function authHeadersForOperation(
  operationName: string | undefined,
  token: string | undefined,
): Record<string, string> {
  if (operationName !== SEARCH_OPERATION_NAME) return {}
  return buildAuthHeaders(token)
}
```

```ts
// The bearer rides ONLY on the gated Search operation: a bearer'd request
// rate-limit-buckets as consumer:<key> on admin (one shared bucket for the
// whole fleet), while anonymous public queries bucket per device IP.
const authLink = new ApolloLink((operation, forward) => {
  const auth = authHeadersForOperation(operation.operationName, getApiToken())
  if (Object.keys(auth).length > 0) {
    const prev = operation.getContext()
    operation.setContext({ headers: { ...(prev.headers ?? {}), ...auth } })
  }
  return forward(operation)
})

const link = authLink.concat(
  new HttpLink({ uri: getGraphQLUrl(), fetch: fetchWithTimeout }),
)
```

Companion pieces shipped with the scoping:

- `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` is `.optional()` in the env schema, so
  keyless builds boot and only search degrades (per
  `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`).
- `parseSearchError` got an explicit `UNAUTHENTICATED` branch — non-retryable
  "update the app" copy plus a `__DEV__` warning naming the env var — so a
  missing or rotated key is diagnosable instead of hiding behind the generic
  retry message.

**Provisioning rules** (documented in `apps/mobile/.env.example`):

1. Mint a **dedicated** entry in admin's `WEB_ADMIN_API_KEYS` CSV per client
   surface — never share web SSR's or TV's value, or revoking one surface
   breaks the others.
2. Receiver-first sequencing: deploy the CSV entry on admin FIRST, then set
   the EAS/Doppler var, then build (same rule as
   `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`).
3. Rotation overlap: a key baked into a store binary cannot change without an
   app release — keep old + new CSV entries overlapping until old versions
   age out of the install base.
4. Production embargo: hold the EAS preview/production token until admin
   lands fleet-aware bucketing (e.g. `consumer:<key>:<ip>`) — even
   Search-scoped, all fleet searches share one 60/min bucket.

## Why This Matters

Admin's GraphQL seam turns a valid consumer bearer into the request's
rate-limit identity (`apps/admin/src/graphql/plugins/rate-limit.ts`):

```ts
// Abridged — see apps/admin/src/graphql/plugins/rate-limit.ts for the full shape.
export function identifyForRateLimit(ctx: ContextShape): string {
  if (ctx.user?.id) return ctx.user.id
  if (
    ctx.user?.role === "CONSUMER_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    return `consumer:${ctx.user.rateLimitBucketKey}` // ONE bucket per key value
  }
  // ...
  return `public:${getClientIp(ctx.request)}` // per device IP for anonymous
}
// configByField: [{ type: "Query", field: "*", max: 60, window: "1m" }]
```

That bucket design exists FOR web SSR — one server, one egress IP, CGNAT
rationale — where a dedicated key-bucket is strictly better than collapsing
onto a NAT'd IP. A device fleet inverts the trade: thousands of installs ship
the _same_ key (Metro inlines `EXPO_PUBLIC_*` as plaintext into the JS
bundle, so it is also extractable), and a global header funnels every
install's Home, watch, and experience traffic into that single 60 queries/min
bucket — fleet-wide self-DoS, or a deliberate one by anyone who extracts the
key. Anonymous traffic buckets per device IP, which is already the correct
shape for fleets.

The trap that made this dangerous: **"the TV app already does this" was not
evidence of safety.** TV attaches its bearer globally and has the same latent
bug — it just has never shipped with a token set. Prior art proves
passthrough mechanics (WAF, header plumbing), not load-shape safety.

## When to Apply

- Any client app distributed to many devices that must present a shared
  credential to one of our backends (mobile, TV, desktop, browser extension).
- Any time a phased server-side auth gate (dual-accept → required) extends to
  a new consumer surface — check which operations are actually gated and
  scope the credential to exactly those.
- Reviewing `apps/tv`: it needs this same Search-scoping change before a
  token is ever provisioned for it.

## Examples

The scoping contract is a first-class test
(`apps/mobile/src/lib/__tests__/authHeaders.test.ts`). The "public op + token
→ empty" cases are the fleet-protection contract — typecheck and simulator
testing cannot catch their deletion; only these tests block the regression:

```ts
// Search + token → header present
expect(authHeadersForOperation("Search", "abc123")).toEqual({
  Authorization: "Bearer abc123",
})

// Public op + token → empty (the fleet-protection contract)
expect(authHeadersForOperation("GetVideoBySlug", "abc123")).toEqual({})
expect(authHeadersForOperation("GetWatchSetting", "abc123")).toEqual({})
expect(authHeadersForOperation(undefined, "abc123")).toEqual({})

// Search + no token → empty (graceful anonymous degradation)
expect(authHeadersForOperation("Search", undefined)).toEqual({})
```

## Related

- PR #1226 — the fix (`fix(mobile): restore Discover search with scoped consumer bearer`)
- `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md` — the server-side complement (why the consumer bucket exists for web SSR); this doc is its fleet-client corollary
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md` — the passport composition the bearer satisfies; its "internal apps need no code change" claim holds only for callers already sending a bearer
- `docs/solutions/conventions/tv-mobile-clients-consume-only-public-admin-queries.md` — the "no client bearer" baseline this learning adds a narrow, operation-scoped carve-out to
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` — receiver-first key sequencing
- `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md` — why no fresh WAF probe was needed
- `docs/solutions/mobile/expo-env-file-handling.md` and `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md` — EXPO*PUBLIC*\* inlining mechanics behind the `_inlined` guard
