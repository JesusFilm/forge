---
title: "Restoring a compile shim re-arms every guard it silently disabled — and inherits the retired endpoint's contracts"
date: 2026-07-23
problem_type: best_practice
component: frontend_stimulus
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
module: "apps/tv search + category-thumbnail data layer (watchSearch migration off retired Query.search)"
applies_when:
  - "Shipping a compile shim — a stub, `return []`, or TODO no-op that preserves an exported signature while removing a real I/O call"
  - "Restoring any shim, especially one that removed the module's only `await`"
  - "A provider-side endpoint retirement with more than one consumer app migrating on different schedules"
  - "Reviewing a PR that deletes a contract assertion alongside the code it asserted on"
  - "Two files coupled by a string literal — GraphQL operation names, route keys, cache keys, event names"
symptoms:
  - "Restoring a real awaited call surfaces multiple concurrency races at once in a hook whose concurrency design nobody changed"
  - "An error classifier returns `unknown` for the one failure the migration made more likely"
  - "A bearer attaches to nothing after an operation rename; both halves typecheck and search still works"
  - "A second shim in the same app is found only when a user reports the visual symptom"
tags:
  - compile-shim
  - graphql-migration
  - dead-code-rearm
  - operation-name-binding
  - error-classifier-drift
  - contract-test-deletion
  - concurrency
  - meta-pattern
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md"
  - "docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md"
  - "docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md"
  - "docs/solutions/best-practices/admin-watch-search-production-rollout-20260720.md"
---

# Restoring a compile shim re-arms every guard it silently disabled

## Context

Admin PR #1622 (`feat(search): replace watch search with multilingual ranking`) replaced GraphQL `Query.search` with `watchSearch(input: WatchSearchInput!)`. `apps/web` migrated in the same PR. `apps/tv` and `apps/mobile` were not P0, so both were left with **compile shims** — code that keeps the module's exported contract but returns a constant empty result.

TV's shim replaced the whole Apollo round-trip with two lines:

```ts
// TODO(feat-254): Temporary non-P0 compile shim. TV keeps the search
// hook contract while Admin replaces the legacy Query.search surface.
const items: SearchResult[] = []
```

That reads as inert. It is not. The shim removed the only `await` in an `async` function, so `useSemanticSearch` ran start-to-`finally` inside a single synchronous execution. Every guard in the hook — the in-flight guard, the stale-response guard, the 12s safety timeout, the unmount guard — became unreachable code that still typechecked and still passed its unit tests.

Restoring the real call on branch `fix/tv-search-watchsearch` (PR #1701, open at time of writing) re-armed all four at once, and surfaced four more failure classes that had been dormant for the same reason. This doc is the generalisable shape of that: **a shim does not just pause a feature, it disables every invariant downstream of the call it removed, and it silently inherits contracts from the endpoint it replaced.**

## Guidance

### 1. Treat "restore the shim" as re-enabling concurrency, not as a one-line swap

Before restoring, enumerate every guard in the shimmed module and ask which ones had anything to guard while the shim was live. On TV, `apps/tv/src/lib/search.ts` carries four:

| Guard                                       | Line                            | Dead under the shim because                   |
| ------------------------------------------- | ------------------------------- | --------------------------------------------- |
| In-flight double-submit (`isSubmittingRef`) | `apps/tv/src/lib/search.ts:167` | set true and false in the same tick           |
| Stale-response (`requestIdRef`)             | `apps/tv/src/lib/search.ts:266` | no response could arrive out of order         |
| 12s safety timeout                          | `apps/tv/src/lib/search.ts:208` | request always settled before the timer armed |
| Unmount invalidation                        | `apps/tv/src/lib/search.ts:146` | nothing was in flight at unmount              |

Restoring the `await` at `apps/tv/src/lib/search.ts:230` made all four live in one commit. The first concurrency fix layered on top then introduced three P1 races — the guards were newly reachable, and the code around them had never been exercised.

### 2. Prefer deleting state to patching its call sites

The three races all came from the same root: the in-flight bail **captured** the dropped query so a settle path could retry it.

- The skip-next-debounce flag was released on the in-flight bail, so the still-queued debounce fired a duplicate request.
- The captured query could be stranded by the safety timeout and then resurrected on an unrelated later search.
- The re-fire never revalidated against the query the user had since typed.

The shipped fix **deleted the captured-query state** and re-reads the live query at settle time. Two of the three races stop being representable:

```ts
// apps/tv/src/lib/searchQueue.ts:38
export function shouldRefireLiveQuery(
  liveQuery: string,
  justRanTrimmed: string,
  debounceScheduled: boolean,
): boolean {
  if (debounceScheduled) return false
  const live = liveQuery.trim()
  return live.length > 0 && live !== justRanTrimmed
}
```

Called from the `finally` block at `apps/tv/src/lib/search.ts:322` against `queryRef.current` — a live mirror, never a snapshot. An abandoned term cannot resurrect because it is never stored. A still-scheduled debounce owns its own retry, so the re-fire yields to it rather than racing it.

The general move: when a concurrency bug needs a fix at three call sites, look for the piece of state all three read. Removing it is usually smaller than guarding it, and it converts "we handled the three known orderings" into "the other orderings do not exist".

The extracted decisions live in a React-free module (`apps/tv/src/lib/searchQueue.ts`) precisely because they became testable only once they were reachable — TV has no `@testing-library/react-native`, so pure extraction is the only way to pin them.

### 3. Audit every contract inherited from the retired endpoint — including one copied in from a sibling

A shim inherits its predecessor's field selection and operation name by doing nothing. Both can be wrong the moment the endpoint changes, and neither fails to compile.

There is a second, less obvious inheritance path: **copying from a sibling app that has not migrated yet.** When several consumers migrate on different schedules, the unmigrated sibling is still written against the retired endpoint, so lifting code from it imports the old contract into the new one.

**Error classifier (inherited by copying).** TV had no domain-code branching before this migration — its pre-`#1622` catch block was a generic `catch → log → setState("error")` (`git show 504eaf3e^:apps/tv/src/lib/search.ts`, line 248). The `extensions.code` assumption arrived when TV's new classifier was modelled on `apps/mobile`'s `parseSearchError`, which branched on `RATE_LIMITED` / `UNAUTHENTICATED` from the `Query.search` era. Neither code is emitted by the new surface:

- `@envelop/rate-limiter@10.0.1` stamps only `extensions: { http: { statusCode: 429 } }` (`node_modules/.pnpm/@envelop+rate-limiter@10.0.1_@envelop+core@5.5.1_graphql@16.13.1/node_modules/@envelop/rate-limiter/esm/index.js:146`). There is no domain `code`.
- `watchSearch` is `authScopes: { public: true }` (`apps/admin/src/graphql/queries/watch-search.ts:262`), and an unrecognised bearer falls through admin's resolution chain to `user = null` (`apps/admin/src/graphql/context.ts:83`) rather than throwing. A bad token never produces `UNAUTHENTICATED` on this field.

So the classifier returned `"unknown"` for rate limiting — the one failure the migration made _more_ likely, since every device now shares whichever bucket admin assigns. Corrected at `apps/tv/src/lib/watchSearch.ts:141`, branching on what is actually sent:

```ts
const status = (extensions?.http as { statusCode?: unknown } | undefined)
  ?.statusCode
if (status === 429) return "rate_limited"
if (typeof status === "number" && status >= 500) return "server_error"
```

**Operation name.** `apps/tv/src/lib/authHeaders.ts:29` attaches the fleet bearer only when `operationName === SEARCH_OPERATION_NAME`. #1622 renamed the document but left the constant at `"SemanticSearch"`; the restore renamed it to `WatchSearch` (`apps/tv/src/lib/queries.ts:391`). Both halves typecheck in every intermediate state. The only symptom of a mismatch is that the bearer attaches to nothing and every device silently falls into admin's coarse per-IP rate-limit bucket — invisible until a fleet-wide 429.

**Field selection.** #1622 deleted the assertion that the search document selects `label` and `childCount`. At the time of this restore those two fields drove series routing via `isSeriesSearchResult`, so when the new document stopped selecting them, every series result would have degraded to the `/watch` hop with nothing failing. Restored at `apps/tv/src/lib/queries.test.ts:44`. **Superseded 2026-07-28 (PR #1767):** `isSeriesSearchResult` is deleted; TV routes on `label` alone (`apps/tv/src/components/search/searchResultPath.ts`) and `childCount` is display-only. Both fields are still selected, so the restored assertion stands — only its rationale changed. See [a record's own children are not a container signal](../logic-errors/tv-childcount-not-a-series-container-signal.md).

### 4. Bind cross-file couplings with a source-scanning guard test

A constant in one file that must equal a string inside a GraphQL document in another file has no type-level relationship. Pin it by scanning both sources (`apps/tv/src/lib/watchSearch.guard.test.js:96`):

```js
const doc = queries.split("export const WATCH_SEARCH")[1]
const declared = readOperationNames(doc)[0]
const constant = authHeaders.match(/SEARCH_OPERATION_NAME\s*=\s*"([^"]+)"/)?.[1]
expect(constant).toBe(declared)
```

Two properties make this trustworthy rather than decorative:

- Each guard ships a **positive control** proving the extractor/detector flags something it is given (`apps/tv/src/lib/watchSearch.guard.test.js:65` and `:125`). Without it, a broken regex or a wrong root path makes the real-tree assertion pass with zero scanning.
- Whole-tree scans assert a floor on the number of files read (`expect(files.length).toBeGreaterThan(50)` at `apps/tv/src/lib/watchSearch.guard.test.js:53`) so an empty scan cannot vacuously pass.

The file is plain JS because the RN tsconfig has no Node types and the guard needs `fs`/`path`.

### 5. Shims travel in packs — enumerate them from the shim PR itself

The restore's first pass missed a second shim: `useCategoryThumbnails`, which wrote `null` for every browse-topic card. It was only found when the user reported the visual symptom (topic cards showing bare gradients). Grep is the wrong tool — a shim's defining property is that it no longer mentions the thing you would grep for.

The authoritative enumeration is the shim PR's own file list:

```bash
git log --oneline --all --grep='#1622'
git show <sha> --name-only -- 'apps/tv/*'
```

which returns exactly five files: `useCategoryThumbnails.ts`, `authHeaders.ts`, `queries.test.ts`, `queries.ts`, `search.ts`. Every one needed a change; four of the five held a defect described above.

### 6. Static analysis covers a class multi-persona review misses

The restore introduced a hand-rolled `stripHtml` to reduce CMS-authored snippets to plain text for RN `<Text>`. A multi-persona `/ce-code-review` pass did not flag it. CI's CodeQL flagged two high-severity alerts:

- `js/incomplete-multi-character-sanitization` — one tag-strip pass rebuilds a tag from surrounding fragments, so `"<scr<script>ipt>"` left a live `"<script"`.
- `js/double-escaping` — decoding `&amp;` then `&lt;` turns `&amp;lt;` into a real `<`.

Both are mechanical string-rewriting flaws that read as correct at review speed. The fix (`apps/tv/src/lib/watchSearch.ts:64`) decodes every entity in one pass via a lookup map, strips tags to a fixed point, then drops any residual angle bracket. Do not treat a green multi-persona review as covering sanitizer-shaped code; wait for CodeQL, and write the tests as security _properties_ (no surviving tag token, no angle brackets) rather than exact expected strings.

The same two rules are **still open on `main`** against `apps/web/src/lib/search.ts:234` (alerts #72 and #73), introduced by #1622 itself. A per-app sanitizer written for the same migration carries the same flaw in every app that hand-rolls it — when one consumer's copy is flagged, check the siblings rather than assuming the alert is local.

## Why This Matters

Shims are proposed as the low-risk option, and their risk is genuinely low _while they are in place_ — the feature is off, so nothing can break. The cost is deferred entirely to the restore, and it is not proportional to the diff:

- **Guard decay is invisible and total.** Dead guards keep their tests, their comments, and their reviewers' confidence. TV's four guards had comments describing races that could not occur. The restore brought back the races and the untested handling of them simultaneously — three P1 concurrency defects in one commit, in a hook nobody had changed the concurrency design of.
- **Inherited contracts fail open, not closed.** Every one of the three contract defects (error codes, operation name, field selection) degrades silently. The rate-limit classifier returns `"unknown"`, the bearer attaches nowhere and search still works, series results still render but route to the wrong screen. None throws. None fails a typecheck. Two of the three were only findable by reading the _other side_ of the wire.
- **Shim PRs delete their own tripwires.** #1622 removed the `label`/`childCount` contract test in the same commit that made it fail. That is the natural thing to do — the test referenced a deleted export — but it means the shim period runs with strictly less coverage than either the before or after state, and the restore has no test telling it what the old document guaranteed.
- **Missed shims are found by users, not by tooling.** The second shim on TV was reported as a visual symptom after the "restore" was believed complete. `apps/mobile` is still in exactly this state on `origin/main`: `apps/mobile/src/hooks/useCategoryThumbnails.ts:23` writes `null` for every topic, and `apps/mobile/src/lib/authHeaders.ts:14` still gates the bearer on the retired `"Search"` operation name. Its restore is in flight as PR #1697 (open at time of writing).

The mocked-shape-vs-real-contract discipline (`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`) covers the adjacent trap where a test passes because only one branch can match. A shim is the more extreme case: it is a production-code stand-in whose mocked shape _is_ the shipped behaviour, so no test — mocked or real — is even asking the question.

## When to Apply

- Shipping a compile shim: a stub, `return []`, `return null`, or a `TODO` no-op that preserves an exported signature while removing a real I/O call.
- Restoring any shim, especially one that removed the module's only `await`.
- Any provider-side endpoint retirement with more than one consumer app, where consumers migrate on different schedules.
- Reviewing a PR that deletes a contract/shape assertion alongside the code it asserted on.
- Any two files coupled by a string literal — GraphQL operation names, route keys, cache keys, event names.
- Introducing hand-rolled sanitization or escaping, at any size.

## Examples

### Enumerate the shims before writing any restore code

```bash
# The shim PR's file list is authoritative; grep is not — a shim's
# defining property is that it no longer names what you would search for.
git log --oneline --all --grep='#1622'
git show 504eaf3e --name-only -- 'apps/tv/*'
```

### Audit the inherited error contract against the provider, not the consumer

```bash
# What the provider actually stamps on a rate-limited error.
grep -n "statusCode\|extensions" \
  node_modules/.pnpm/@envelop+rate-limiter@*/node_modules/@envelop/rate-limiter/esm/index.js

# Whether the new field can produce an auth error at all.
grep -n "authScopes" apps/admin/src/graphql/queries/watch-search.ts
```

Before (inherited from `Query.search`, matches nothing the new surface sends):

```ts
const code = error.errors[0]?.extensions?.code
if (code === "RATE_LIMITED") return "rate_limited"
if (code === "UNAUTHENTICATED") return "unauthenticated"
return "unknown"
```

After (`apps/tv/src/lib/watchSearch.ts:141`) — branch on the transport status the rate limiter actually stamps, and drop the auth branch a public field can never reach.

### Delete the state instead of guarding it

Before — the bail captures the dropped query, and three separate paths must now agree about its lifetime:

```ts
if (isSubmittingRef.current) {
  pendingQueryRef.current = q
  skipNextDebounceRef.current = false
  return
}
```

After (`apps/tv/src/lib/searchQueue.ts:24` and `apps/tv/src/lib/search.ts:167`) — nothing is captured, the flag stays armed, and the settle path re-reads the live query:

```ts
const admission = admitRunSearch(q, isSubmittingRef.current)
// An in-flight bail must KEEP the skip flag: the settle path re-fires from
// the live query, so releasing it here would let the debounce duplicate.
if (releasesSkipFlag(admission)) skipNextDebounceRef.current = false
if (admission.kind === "in-flight") return
```

### Guard test with a positive control

```js
it("SEARCH_OPERATION_NAME is the operation name declared in WATCH_SEARCH", () => {
  const doc = queries.split("export const WATCH_SEARCH")[1]
  expect(constant).toBe(readOperationNames(doc)[0])
})

it("positive control: the extractor reads a name it is given", () => {
  expect(
    readOperationNames("= graphql(`\n  query Renamed($input: X!) {\n")[0],
  ).toBe("Renamed")
})
```

Full source at `apps/tv/src/lib/watchSearch.guard.test.js:96`. Falsify each guard once before trusting it — rename the constant, confirm the test goes red, put it back.

## Related

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — mocked tests prove branch shape, real fixtures prove production contract. A shim is the degenerate case where the mock _is_ production.
- `docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md` — the prose half of the same retirement problem: code sweeps are blind to forward-looking instructions naming the retired mechanism as live.
- Admin PR #1622 (`feat(search): replace watch search with multilingual ranking`) — the retirement that created the shims.
- PR #1701 (`fix(tv): restore Watch search on admin's watchSearch contract`) — the TV restore this doc is drawn from.
- PR #1697 (`fix(mobile): restore Watch search on admin's watchSearch contract`) — the sibling mobile restore, open at time of writing. `apps/mobile` remains shimmed on `origin/main`; the same five failure classes apply to it.
