---
title: "Bumping the Candidate application revision invalidates the live serving pin"
date: 2026-08-29
category: integration-issues
module: admin_watch_search_candidate
problem_type: integration_issue
component: service_object
symptoms:
  - "Every canonical-browser Watch search returned INTERNAL_SERVER_ERROR for 36 minutes after an application-revision bump merged."
  - "Admin logged: candidate generation candidate-revision-v2-runtimefix-20260817t034500z is not compatible with application revision watch-search-candidate/v3."
  - "The Railway deploy reported SUCCESS and the healthcheck stayed green while every MODERN request failed."
  - "SSR first paint rendered normally because it sends no Origin header; only the second and later client-side searches in a session failed."
  - "The failing response was HTTP 200 with a null watchSearch payload and an errors array, so a status-code smoke stayed green."
root_cause: incorrect_assumption
resolution_type: config_change
severity: critical
related_components:
  - "candidate generation lifecycle"
  - "Typesense Watch search serving pin"
  - "Railway service configuration"
  - "offline search evaluation runner"
tags:
  - "watch-search"
  - "typesense"
  - "candidate-generation"
  - "application-revision"
  - "serving-pin"
  - "production-outage"
  - "deployment-sequencing"
---

# Bumping the Candidate application revision invalidates the live serving pin

## Problem

`TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION`
(`apps/admin/src/services/typesense-watch-search-candidate-identity.ts:20`) is
compared for exact equality against the revision stored on whichever Typesense
generation is serving. Bumping it does not gate the next operator rebuild — it
reclassifies every already-built generation as incompatible, including one
currently serving production traffic.

PR #2100 bumped it from `watch-search-candidate/v2` to `watch-search-candidate/v3`
for a genuine projection change. Production was pinned to a promoted candidate,
not the `CURRENT` lane the plan assumed, so the bump invalidated the live index
and took canonical-browser Watch search down for 36 minutes on 2026-08-29
(12:37:12Z to 13:13:13Z).

## Symptoms

- Every canonical-browser Watch search returned `INTERNAL_SERVER_ERROR`.
- `GraphQLError: candidate generation candidate-revision-v2-runtimefix-20260817t034500z is not compatible with application revision watch-search-candidate/v3`.
- The deploy reported `SUCCESS`; `/api/health` returned 200 throughout.
- The first search of a session worked and later ones failed.
- Requests returned HTTP 200 carrying `"data": {"watchSearch": null}` plus an `errors` array.

## What Didn't Work

**Reasoning about production configuration from the repository.** The plan
stated "Production's CURRENT lane is not gated by that revision." Every input to
that sentence came from the repo: `apps/admin/src/config/env.ts:771` defaults
`WATCH_SEARCH_TYPESENSE_PROFILE` to `"CURRENT"`, and no override exists in any
tracked file — because Railway service variables are not in the repo. The
deployed value was
`CANDIDATE:candidate-revision-v2-runtimefix-20260817t034500z`.

The same plan asserted `WATCH_SEARCH_PRIMARY_MODE` was at its `MODERN` default
by identical reasoning, and happened to be right. A default-shaped guess that
holds for one variable says nothing about its neighbour.

**Following the existing repo learning on this constant.** The prior doc
`watch-search-candidate-generation-stable-application-revision.md` already said
to "deliberately bump `TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION`
and rebuild the generation" when the projection changes. PR #2100 did exactly
that. The rule covers _when_ to bump; it says nothing about _what a bump
invalidates_ or _in what order to ship it_, which is the gap this incident
exposed.

**Assuming "fails closed" meant degradation.** The runbook said an incompatible
pin "fails closed," which reads like a fallback to the PostgreSQL lane. It is a
total outage: `isTypesenseUnavailable`
(`apps/admin/src/services/typesense-watch-search.service.ts:2899`) matches
`TypesenseRequestError` and `TypesenseWatchSearchUnavailableError` — not
`CandidateGenerationCompatibilityError` — and the `watchSearch` resolver awaits
the service with no try/catch.

**Verifying with a probe that omitted the discriminator.** `curl` without an
`Origin` header resolves the DEFAULT lane and returns healthy results. An
earlier measurement taken that way is what produced the false premise in the
first place.

**Moving one environment variable to repair the pin.** After building a
replacement generation, setting `WATCH_SEARCH_TYPESENSE_PROFILE` alone still
failed with `candidate generation <id> has no exact passing qualification`,
because `findExactAuthorizedQualification` also matches on `qrelsRevision`,
supplied from `env.WATCH_SEARCH_SERVING_QRELS_REVISION`
(`apps/admin/src/services/index.ts:182`), which still held the old value.

## Solution

Immediate mitigation was the runbook's traffic rollback, not a deploy rollback:

```bash
WATCH_SEARCH_PRIMARY_MODE=DEFAULT   # redeploy; expect searchMode: watch-search
```

This was chosen deliberately. The DEFAULT PostgreSQL lane already carried the
user-facing fix from PR #2098, so a deploy rollback would have restored search
_by reinstating the bug the deploy was fixing_. The config flip restored search
and kept the fix.

Recovery then required, in this order:

```bash
# 1. Build a generation on the new revision (in-service, not a workstation).
pnpm --filter @forge/admin index:typesense-watch-search-candidate

# 2. Produce relevance evidence WITHOUT reading through the broken SERVING pin.
#    Override the eval runner's endpoint to the EVALUATION pointer.

# 3. Qualify, then CAS-pin the generation to SERVING.

# 4. Move BOTH variables — the qualification lookup is a conjunction over both.
WATCH_SEARCH_TYPESENSE_PROFILE=CANDIDATE:<new-generation-id>
WATCH_SEARCH_SERVING_QRELS_REVISION=<that qualification's qrelsRevision>

# 5. Restore MODERN, then run the acceptance smoke and the no-Origin control.
WATCH_SEARCH_PRIMARY_MODE=MODERN
```

Step 2 is the non-obvious one. The evaluation posts to
`/api/internal/search-eval/serving-search`, whose handler resolves the `SERVING`
pointer (`route.ts:22`, `source: "SERVING"`) and returns 503 when resolution
fails — so while the pin was stale, the evidence needed to repair the pin could
only be produced through the pin. `runAbsoluteSearchEval` accepts a
`servingUrl` option
(`apps/mastra/src/services/offline-search-eval/absolute-runner.ts:128`); pointing
it at `/api/internal/search-eval/candidate-search` (`route.ts:22`,
`source: "EVALUATION"`) resolves the `EVALUATION` pointer, which already
referenced the new generation.

For future changes, sequence any revision bump as an ordered merge that cannot
be reordered:

1. Set `WATCH_SEARCH_PRIMARY_MODE=DEFAULT`; confirm the canonical-origin smoke
   reports `searchMode: "watch-search"`.
2. Merge the application change. MODERN is dark, so the now-invalid pin serves
   nothing.
3. Build, qualify, and CAS-pin a fresh generation on the new revision.
4. Restore `WATCH_SEARCH_PRIMARY_MODE=MODERN` and re-run the acceptance smoke.

## Why This Works

An exact-equality compatibility constant is a retroactive invalidator, not a
forward gate. Bumping it does not start requiring the new shape from now on; it
reclassifies every artifact that already exists. Nothing about the artifact
changed — the predicate moved underneath it. So the deploy-time question is not
"will future builds pick this up?" but "which persisted artifacts does this
constant currently bless, and is any of them on the request path right now?"

Darkening MODERN before the merge works because it removes the invalidated pin
from the request path for the window in which it is invalid. The pin is still
incompatible during steps 2 and 3; it just is not serving anyone.

A promoted pin is a normal steady state, not a transient one. Once a candidate
is qualified and promoted it stays pinned indefinitely, and publishing newer
candidates moves only the `EVALUATION` pointer, never `SERVING`. So "we are
probably still on the baseline lane" gets less true with every successful
promotion — which is exactly why the repo-derived assumption aged into a wrong
one.

## Prevention

- **Read deployed configuration; do not derive it.** "No override is visible in
  the repo" is not evidence about production. Before reasoning about which
  artifact production serves:

  ```bash
  railway variables --service "@forge/admin" --environment production --kv \
    | grep -E '^WATCH_SEARCH_(TYPESENSE_PROFILE|PRIMARY_MODE)='
  ```

- **Run an acceptance smoke that reproduces the discriminator and asserts on the
  body.** MODERN is selected only for an anonymous request whose `Origin`
  exactly equals `WEB_CANONICAL_ORIGIN` (`isCanonicalWebBrowserRequest`,
  `apps/admin/src/graphql/queries/watch-search.ts:44`). A GraphQL resolver throw
  returns HTTP 200, so a `2xx` check passes through the whole outage.

  ```bash
  resp=$(curl -s -X POST https://admin.jesusfilm.org/api/graphql \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://www.jesusfilm.org' \
    -d '{"query":"{ watchSearch(input:{query:\"Easter\",limit:3}) { searchMode } }"}')
  echo "$resp" | grep -q '"searchMode":"watch-search-typesense"' || exit 1
  echo "$resp" | grep -q '"errors"' && exit 1
  ```

  Run it after every deploy that touches Watch search, not only on promotion.
  Keep the no-`Origin` control: it must still report `watch-search`.

- **Write down whether a fail-closed throw is classified into a fallback or
  propagates.** Put the consequence next to the check. A reader who sees
  `throw new CompatibilityError(...)` and assumes a fallback exists will
  under-price the change.

- **Confirm no step of a replacement procedure resolves through the artifact
  being replaced.** Evidence for the next generation should read the
  `EVALUATION` pointer by construction. Keep the endpoint injectable — that
  override was the difference between a bounded incident and a deadlock.

- **Enumerate every input the authorizing predicate keys on, from the
  predicate's source.** The promotion command's argument list is not the key
  set. There is no atomicity between two Railway variables, so expect a window
  where one has moved and the other has not.

- **Prefer the mitigation that preserves the fix.** When both a deploy rollback
  and a traffic/config rollback are available, ask which one keeps the most
  recent correct behavior. A deploy rollback is coarse.

## Related Issues

- `docs/solutions/integration-issues/watch-search-candidate-generation-stable-application-revision.md`
  — part one of this arc: it stabilized the identity source so ordinary deploys
  could not invalidate a generation. Its Prevention rule ("bump deliberately for
  projection changes") was followed here and still caused an outage, because it
  covers when to bump, not what a bump invalidates. Read both together.
- `docs/solutions/best-practices/precomputed-hybrid-search-serving-index-20260803.md`
  — designs the CURRENT/EVALUATION/SERVING lifecycle. Its promotion runbook
  still reads as if `CURRENT` were the standing production posture; PR #2104
  corrected that premise in the operations runbook and the plan, but not here.
- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — sibling instance of the same higher-order rule: a fail-closed check's blast
  radius depends on whether traffic can already be rolled away from it.
- `docs/operations/typesense-watch-search-production-readiness.md` — now opens
  Rollout and Rollback with the "does this change move the application
  revision?" precondition and the ordered sequence above (PR #2104).
- Linear FGE-109; PRs #2098, #2100, #2104.
