---
title: "Retiring a shared contract while leaving consumers as compile shims produces an invisible outage"
date: "2026-07-23"
category: "workflow-issues"
module: "apps/mobile + apps/tv + apps/admin + packages/admin-graphql"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
related_components:
  - "admin-graphql-schema"
  - "gql-tada-codegen"
  - "watchSearch"
applies_when:
  - "A shared GraphQL/API contract is being retired or renamed across multiple client consumers"
  - "Not every consumer can migrate in the same PR or timeframe as the primary consumer"
  - "The temporary compile shim returns a valid-but-empty result instead of erroring"
symptoms:
  - "CI stays fully green after the contract-retiring PR merges"
  - "UI renders a plausible empty state instead of an error"
  - "gql.tada typechecks an invalid or removed GraphQL field without complaint"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
tags:
  - "graphql"
  - "contract-retirement"
  - "compile-shim"
  - "gql-tada"
  - "silent-failure"
  - "schema-validation"
---

# Retiring a shared contract while leaving consumers as compile shims produces an invisible outage

## Context

Admin PR #1622 retired the GraphQL field `Query.search` and replaced it with a
richer multilingual field. In the current schema only the replacement exists —
`watchSearch(input: WatchSearchInput!): WatchSearchResponse`
(`apps/admin/schema.graphql:1042`, input type at `:1967`); `Query.search` is
gone.

`apps/web` was migrated in that same PR. `apps/mobile` and `apps/tv` were not.
Both were left as **compile shims**: the network call was deleted, the
surrounding hook contract was kept, and a hardcoded empty value was substituted
for the response. The TV shim is still in the tree today:

```ts
// apps/tv/src/lib/search.ts:200-205
// TODO(feat-254): Temporary non-P0 compile shim. TV keeps the search
// hook contract while Admin replaces the legacy Query.search surface
// for Watch web first.
void locale
void limit
const items: SearchResult[] = []
```

That empty array flows straight into the hook's ordinary success path — the
`items.length === 0` branch sets state to `"empty"`
(`apps/tv/src/lib/search.ts:231-233`), which is the same state a genuine
zero-result query produces. TV search returns "no results" for every query ever
typed, and reports it as a normal empty search.

Mobile had the same shim in its Watch tab
(`git show b99e7ae6:"apps/mobile/app/(tabs)/watch.tsx"`, lines 214-218):

```ts
// TODO(feat-254): Temporary non-P0 compile shim while Admin replaces
// the legacy Query.search contract for Watch web first.
if (requestIdRef.current !== thisRequest) return

setResults([])
```

Mobile is fixed on this branch (`apps/mobile/src/lib/queries.ts:44` defines the
`WatchSearch` operation; `apps/mobile/app/(tabs)/watch.tsx:295` and `:418` call
it). **TV is not.**

Three things made the damage larger than "one screen is broken":

1. **A second surface was shimmed the same way and nobody noticed.**
   `useCategoryThumbnails` was reduced to writing `null` for every browse topic
   (`git show b99e7ae6:apps/mobile/src/hooks/useCategoryThumbnails.ts:21-25`):

   ```ts
   for (const topic of BROWSE_TOPICS) {
     if (thumbnailCache.has(topic.searchTerm)) continue
     thumbnailCache.set(topic.searchTerm, null)
     next[topic.searchTerm] = null
   }
   ```

   All six browse categories (`apps/mobile/src/lib/browseTopics.ts:15-45`)
   silently lost their artwork. The search screen was the surface everyone was
   thinking about; the thumbnails were collateral, and nothing pointed at them.

2. **The TODO pointed at a ticket that could close without it.** Both shims cite
   `feat-254`. That ticket is `status: "complete"`
   (`docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md:6`)
   and explicitly scoped mobile and TV out: _"Do not require mobile or TV
   adoption in P0."_ (`:68`). The ticket the shims are waiting on has been done
   for days, and no follow-up ticket exists.

3. **Rewiring later lost a detail the original had earned.** When mobile was
   rewired, the obvious input hardcoded `displayLanguageSlug: "en"`. Admin wants
   a `language.slug`, not a BCP-47 tag. Measured against production: `"en"`
   returned 0/10 playable results, `"english"` returned 10/10. The trap itself is
   documented in
   `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
   — the point here is that a shim's eventual replacement is written from the
   field signature, not from the working code it replaced, so hard-won details
   die with the deleted call.

## Guidance

### 1. A retirement PR owns every consumer, or the field does not get retired

Enumerate consumers by _operation_, not by app. Grep the schema symbol across
every client (`git grep -n 'Query\.search\|[^a-zA-Z]search(' -- apps packages`),
and list each call site. "Web is migrated" is not "the retirement is done" in a
monorepo where three apps share one client package.

### 2. If a consumer must be deferred, break it loudly — never shim it silently

A shim is worse than a broken call, because a broken call is detectable. Ranked
best to worst for a deferred consumer:

1. **Leave the old operation in place** and let it fail against the new schema —
   the operation-validation check in §5 flags it, loudly, in CI.
2. **Delete the surface**: hide the search entry point behind a flag, or render
   an explicit "Search is unavailable in this version" state.
3. **Throw** from the deleted call path so the error state fires.
4. **Substitute a plausible empty value.** This is the shim. Do not do this.

The failure mode of #4 is specific: an empty array is indistinguishable from a
legitimate empty result, so the app renders a _correct-looking_ screen. Users see
"No results", assume the content isn't there, and don't report it.

### 3. Never let a shim return a value the success path accepts

If you write a shim anyway, make it structurally impossible to mistake for
success. `throw new Error("search shim")` in the try block would have surfaced
the TV state as `"error"` on the first manual test. `const items: SearchResult[]
= []` slots into the same branch a real empty result takes.

### 4. A shim's TODO must name a ticket that cannot close while the shim lives

`TODO(feat-254)` on a ticket whose own scope section says mobile and TV are out
of scope is a dangling pointer by construction. Either:

- file the consumer's own ticket (`feat-NNN: rewire apps/tv search to
watchSearch`) and cite _that_, and add it to the retiring ticket's `blocks`; or
- add a "consumers still shimmed" checklist to the retiring ticket and refuse to
  set `status: complete` until it is empty.

### 5. Validate every client operation against the real schema in CI

This is the check that catches schema drift in a client query. CI today
regenerates artifacts and diffs them — `admin-graphql-generate`
(`.github/workflows/ci.yml:78`), `admin-schema-drift` (`:97`) — and runs
per-service `typecheck` (`:178`). None of those validate a client _operation_
against the SDL, and typecheck does not do it either (see §Why This Matters).

Recipe, verified working against this tree:

```js
// validate-ops.mjs — run from inside a package that has `graphql` installed.
// node validate-ops.mjs <schema.graphql> <file-or-dir> [...]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { buildSchema, parse, validate, specifiedRules, Kind } from "graphql"

const [schemaPath, ...targets] = process.argv.slice(2)
const schema = buildSchema(readFileSync(schemaPath, "utf8"))

function files(p, acc = []) {
  if (statSync(p).isDirectory())
    for (const e of readdirSync(p)) files(join(p, e), acc)
  else if (/\.tsx?$/.test(p)) acc.push(p)
  return acc
}

// gql.tada call sites: adminGraphql(`...`) — first template literal argument.
const CALL = /adminGraphql\(\s*`([\s\S]*?)`/g

const docs = []
for (const target of targets)
  for (const file of files(target))
    for (const m of readFileSync(file, "utf8").matchAll(CALL))
      // @_unmask is a gql.tada client directive; the server schema rejects it.
      docs.push({ file, text: m[1].replace(/@_unmask/g, "") })

const defs = docs.flatMap((d) =>
  parse(d.text).definitions.map((def) => ({ ...d, def })),
)
const fragments = defs
  .filter((d) => d.def.kind === Kind.FRAGMENT_DEFINITION)
  .map((d) => d.def)

// Bundling every fragment with each operation makes NoUnusedFragments fire on
// all the ones this operation legitimately does not use. Note the `Rule` suffix:
// specifiedRules entries are named `NoUnusedFragmentsRule`.
const rules = specifiedRules.filter((r) => r.name !== "NoUnusedFragmentsRule")

let failures = 0
for (const { file, def } of defs) {
  if (def.kind !== Kind.OPERATION_DEFINITION) continue
  const doc = { kind: Kind.DOCUMENT, definitions: [def, ...fragments] }
  for (const err of validate(schema, doc, rules)) {
    failures++
    console.error(`INVALID ${file} [${def.name?.value}]: ${err.message}`)
  }
}
process.exit(failures > 0 ? 1 : 0)
```

Four details are load-bearing:

- **Strip `@_unmask`.** It is a gql.tada client directive; the server SDL has no
  such definition and every fragment carrying it fails `KnownDirectives`.
- **Attach all fragments to every operation.** Client fragments live in
  `packages/admin-graphql/src/fragments/`, not next to the operation, so the
  operation alone does not resolve its spreads.
- **Filter `NoUnusedFragmentsRule`** — not `"NoUnusedFragments"`. Bundling every
  fragment with every operation makes that rule fire on all the unused ones. With
  the wrong name in the filter this run reported 154 spurious errors; with the
  right one, 0.
- **Run a negative control.** Inject a bogus field, confirm the check fails, then
  revert. Without it you cannot tell a passing check from a check that scanned
  nothing.

### 6. When you finally rewire, port the details — don't rewrite from the signature

Read what the deleted call actually sent. If the original is already gone, treat
the first rewrite as unverified until it is checked against production data, and
pin whatever you learn with a guard test.
`apps/mobile/src/lib/__tests__/watchSearchInput.guard.test.js` is the shape: a
source scan asserting the language-input keys appear only inside
`buildWatchSearchInput` (`ALLOWED` at `:13`), with a positive-control case
proving the detector flags real violations (`:63-98`).

## Why This Matters

**Every green signal you have is blind to this.**

- The shim **compiles** — it satisfies the same type as the deleted call.
- The shim **typechecks**.
- The shim **passes tests** — the deleted network call had no test, so nothing
  went red.
- **CI is green.**
- The **UI looks fine** — a plausible empty state, not an error.

And here is the sharpest part: **typecheck would have caught this — the shim is
what silenced it.** Point the live operation at a root field the schema no longer
has (rename `watchSearch(input: $input)` to `search(input: $input)` in
`apps/mobile/src/lib/queries.ts`) and `tsc --noEmit` fails at every consuming
read:

```
app/(tabs)/watch.tsx(311,24): error TS2339: Property 'watchSearch' does not
exist on type '{ search: unknown; }'.
```

Renaming a _selected_ field that consuming code reads fails the same way
(`TS2339: Property 'title' does not exist on type '{ … titleRenamed: unknown … }'`).
So gql.tada does protect a client against a field being removed or renamed
underneath it — provided the query still exists.

Deleting the call is what removed that protection. There was no operation left to
typecheck and no read left to fail, so the strongest existing detector went quiet
precisely because the shim was written to keep the build green.

The residual gap is narrower than "gql.tada doesn't validate": an unknown field
_added_ to a selection set types as `unknown` rather than erroring, so it is only
caught if something downstream is structurally pinned to the exact response shape.
That is what the §5 validator covers directly:

```
INVALID src/lib/queries.ts [WatchSearch]: Cannot query field
"bogusFieldThatDoesNotExist" on type "WatchSearchResult".
```

The economics are what make it expensive. The shim is a two-minute edit during a
PR that is already large, taken to keep CI green. What it buys is an outage with
no detector, no owner, and no clock: mobile search returned nothing for every
query, six browse categories lost their artwork with no one aware they were
connected to search at all, and TV is _still_ in that state while the ticket both
shims cite reads `complete`.

Note the asymmetry in what §5 can catch. The validator catches a **stale**
operation — a query the client still sends that the schema no longer accepts. It
cannot catch a **deleted** one, because there is nothing left to validate. That
is the argument for §2 stated precisely: keeping the broken call is _detectable_;
shimming it away removes the only artifact a machine could have checked. The
complementary control for shims is human: a grep-able marker plus an owned
ticket (§4).

## When to Apply

- Any PR that removes or renames a field, type, or argument in
  `apps/admin/schema.graphql` — the consumers are `apps/web`, `apps/mobile`,
  `apps/tv`, and anything else importing `@forge/admin-graphql`.
- Any PR that leaves a consumer "for later" behind a `TODO`, a `void arg`, or a
  hardcoded empty return.
- Any time you are about to write `const x: T[] = []` or `return null` in place
  of a real call to keep a build green.
- Reviewing a cross-app migration PR: check the consumer count, not the diff
  size. A retirement touching one app in a three-consumer monorepo is the signal.
- Picking up any surface that reads "no results", "no data", or renders blank
  artwork with no error — check whether the call still exists before debugging
  the data.

## Examples

**Shim (do not do this)** — `apps/tv/src/lib/search.ts:200-205`, still live:

```ts
// TODO(feat-254): Temporary non-P0 compile shim. TV keeps the search
// hook contract while Admin replaces the legacy Query.search surface
// for Watch web first.
void locale
void limit
const items: SearchResult[] = []
```

Renders as a normal empty search. No error, no log, no metric.

**Loud deferral** — same situation, detectable:

```ts
// feat-NNN: TV is not yet on watchSearch. Fail visibly rather than
// render an empty result set indistinguishable from a real one.
throw new SearchUnavailableError("tv-not-migrated")
```

State goes to `"error"`, the existing error copy and Retry render, and the
`watch_search` log emits `outcome: "failed"` — the same telemetry path a real
outage uses.

**Silent collateral** — `useCategoryThumbnails` before the fix
(`git show b99e7ae6:apps/mobile/src/hooks/useCategoryThumbnails.ts:9-29`). The
docstring says "Temporarily no-ops while Watch search is rebuilt for web first",
and the body writes `null` for every topic. Nothing in the browse UI is named
"search", so nobody connected the blank cards to the retirement.

**Running the validator** against this tree:

```
$ node validate-ops.mjs ../admin/schema.graphql \
    src/lib/queries.ts ../../packages/admin-graphql/src/fragments
8 operations, 25 fragments, 0 errors

# negative control — inject a bogus field, re-run:
INVALID src/lib/queries.ts [WatchSearch]: Cannot query field
"bogusFieldThatDoesNotExist" on type "WatchSearchResult".
8 operations, 25 fragments, 1 errors
```

## Related

- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
  — the specific detail the shim's replacement got wrong (`language.slug`, not
  BCP-47).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — same family: a check that passes because nothing real is exercised. The
  negative control in §5 is that doc's "falsify each guard once" applied to
  schema validation.
- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`
  — the discipline for scaffolding meant to be torn down at a known trigger;
  §4 here is the same idea for the consumer side of a retirement.
- `docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md` — the
  retiring ticket, `status: complete` with mobile/TV explicitly out of P0 scope
  (`:68`).
