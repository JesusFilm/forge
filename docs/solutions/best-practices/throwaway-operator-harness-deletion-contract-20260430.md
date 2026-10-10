---
title: Throwaway operator harness with explicit deletion contract — pattern for canary / parity / migration tooling with a known retirement date
date: 2026-04-30
tags: [patterns, design, migration, demo, lifecycle, deletion-contract]
category: best-practices
severity: low
---

## Problem

Migration-era tooling — A/B canaries, parity diff dashboards, manual
verification harnesses, side-by-side-the-old-system comparisons —
gets built fast under pressure, ships to operators, and then **stays
in the codebase long after its purpose is gone**. Twelve months
later it shows up in a PR diff, nobody remembers whether deleting
it is safe, the implicit env vars and external API keys it depends
on still sit in Doppler/Railway/dashboards, and one day someone
reactivates the route by accident or refactors around it instead of
removing it.

The natural failure mode of "we'll delete it later" is that "later"
arrives without a checklist of what to delete.

## Symptoms

- Demo / canary / preview routes that hung around past their
  intended retirement event
- Env vars in production that nobody can confidently remove because
  nobody can grep for the consumer
- Server-layer or service-layer code that was "supposed to be
  temporary" but grew imports, became a shared dependency, and is
  now load-bearing
- PRs that delete one piece of the harness but leave its env-var
  configuration / its Doppler secret / its Railway dashboard tile
- Migration completion declared "done" while the parity harness is
  still serving traffic

## What Didn't Work

- **Inline TODO comments** ("remove at X cutover") — searchable, but
  no enforcement; routinely outlive their author's tenure.
- **GitHub issues / Linear tickets** — orthogonal to the code; the
  issue closes without the deletion happening, or the issue stays
  open indefinitely as background noise.
- **Feature flags** — overkill for a demo, and the flag itself
  becomes another thing that has to be removed; nests the same
  problem one layer deeper.
- **"Just delete it when we're done"** without a contract — relies on
  human memory across a multi-week or multi-month migration.

## Solution

Treat throwaway tooling as a **first-class architectural choice**
with an explicit deletion contract. Five rules:

### 1. Co-locate everything in one deletable folder

All code for the harness lives under a single directory whose name
encodes its purpose. The entire folder is one `rm -rf` away from
deletion. No service-layer entries, no GraphQL types, no shared
helpers promoted to `src/lib`, no `src/services` cross-reaches.

```
apps/admin/src/app/watch/demo-keyword-search/
├── page.tsx
├── demo-search-client.tsx
├── algolia-action.ts          # throwaway server action
├── algolia-action.test.ts
├── diff.ts
└── diff.test.ts
```

If a helper from the harness becomes useful enough to share with
permanent code, **promote it deliberately** — and at that point
admit it isn't throwaway anymore. The decision is forced, not drifted.

### 2. State the lifetime in the file headers AND the commit body

The file's docstring is the load-bearing artifact:

```ts
/**
 * Throwaway operator harness — server action backing the third
 * column of /watch/demo-keyword-search.
 *
 * Lifetime: this exists only while we refine admin's hybrid +
 * keyword-first ranking. At R8 cutover, delete this file, drop
 * the Algolia env vars from Doppler / Railway, and remove the
 * third pane from `demo-search-client.tsx`. No service layer,
 * no GraphQL surface, no REST endpoint — that is the point.
 */
```

The commit message restates the lifetime + repeats the cleanup
checklist. Two anchors so a future engineer reading either can find
the deletion contract.

### 3. Prefer Server Actions / non-addressable surfaces over public REST

When a Next.js Server Action will do, **do not create a `/api/foo`
route**. Server actions are framework-internal POSTs with no
externally-visible URL. They:

- Carry no documented contract for third parties to bind to
- Cannot be invoked by anything outside the app
- Disappear cleanly when the calling component is removed
- Don't need a deprecation period

A public REST route, by contrast, becomes a permanent maintenance
burden the moment it ships — even if nobody uses it, you can't
prove nobody uses it without an Apache-log audit.

The same logic applies to GraphQL: don't add fields to the public
schema for a temporary surface.

### 4. Enumerate every deletion target at write time

The cleanup checklist lives in the harness itself (file docstring +
commit body). It must include:

- **Code**: which files / which sections of which files
- **Tests**: companion test files
- **Configuration**: env vars in every relevant Doppler project
  config (dev / stg / prd), Railway dashboard entries, Cloudflare
  rules if any
- **External**: any third-party resources (Algolia search keys,
  feature-flag definitions, monitoring dashboards) that should be
  revoked
- **Documentation**: any README sections, CLAUDE.md notes, brainstorm
  files that should be retired

The checklist is mechanical: a future engineer (or AI agent) should
be able to execute it without judgment calls.

### 5. Don't let "soft-fail" disguise abandonment

Throwaway code usually has a `if (!env.X) { return null }` style
soft-fail so a missing config doesn't 500 the page. That's correct
defensive coding. The risk: if everyone forgets to set the env vars,
the soft-fail makes the harness invisibly dead — present in code,
serving zero value, costing review time on every diff.

Mitigations:

- A startup log line at module load if the harness is "active"
  (env vars present), so it's visible in deploy logs whether the
  harness is doing anything
- A scheduled agent (e.g., `/schedule`) at the planned retirement
  date that opens a deletion PR automatically
- An entry in the project's roadmap with the expected deletion
  trigger so it's tracked alongside the rest of the work

## Why This Works

The pattern works because it makes deletion **the cheapest path**.
Every other approach makes deletion as expensive as the original
build. By co-locating, avoiding new public surfaces, and
enumerating the cleanup, the only judgment call at retirement is
"has the trigger event happened?" — not "what does this code touch?"

The throwaway-with-contract framing also pre-commits the team to a
specific scope. If during build someone is tempted to refactor the
harness's helpers into a service-layer abstraction, the contract
forces the question: are we still throwaway? Either the work
properly graduates (and the deletion contract is voided), or the
abstraction is cut.

## Prevention

### Checklist before merging a "temporary" surface

- [ ] All code in one folder under a clearly-named directory
- [ ] No imports from outside the folder reach into it (verify with
      `grep -r "from.*<folder>" apps/`)
- [ ] No new public REST routes (`/api/*`)
- [ ] No new GraphQL types/fields exposed to consumers
- [ ] File docstring states retirement trigger + cleanup steps
- [ ] Commit body restates retirement trigger + cleanup steps
- [ ] Env vars (Doppler + Railway) listed in cleanup steps
- [ ] Soft-fail behavior documented (what happens when env unset)

### When the contract is voided

If the harness becomes load-bearing during its lifetime (a permanent
consumer adopts it, a helper graduates to service-layer, etc.),
**explicitly** void the contract:

- Update the file docstring to remove the throwaway framing
- Move the harness out of the demo folder if appropriate
- Open a follow-up PR that promotes its helpers to permanent locations
- Treat the surface as you would any other production feature

The voiding step is the same shape as graduation in any other
prototype-to-production transition.

## Where this pattern showed up

PR #864 (admin `/watch/demo-keyword-search` + Algolia parity column,
merged 2026-04-30). The harness compares admin's hybrid +
keyword-first search rankings against the watch project's Algolia
stg index. Designed to run only until R8 cutover (when admin
replaces Algolia on the watch site). All five rules applied:

- Single folder: `apps/admin/src/app/watch/demo-keyword-search/`
- Lifetime in file docstring + commit body
- Server Action (`algolia-action.ts` with `"use server"`), no public route
- Cleanup enumerated: file deletion + 3 env vars + 1 component
  pane in `demo-search-client.tsx`
- Soft-fail: muted "Algolia disabled" banner when env unset

The ce:review of the PR scored agent-native parity as **PASS** with
a non-recommendation: "do not wire agent tooling around a throwaway
harness." That's a deliberate inversion of the agent-native default,
and it's the right call for code with a known retirement date.

## Anti-patterns to avoid

- **"We'll add it to a service-layer once we see if it works"** — by
  the time you "see if it works", you've already coupled callers to
  a contract that's now hard to remove
- **Public REST endpoint for a demo** — the URL becomes a public
  contract the moment it ships
- **Sharing a helper between throwaway and permanent code** — the
  helper now has two halves of its userbase with different lifetimes
- **Linking to the harness from documentation** — readers will find
  it after retirement and assume it's permanent

## Related

- `apps/admin/src/app/watch/demo-keyword-search/` — the canonical example
- `apps/admin/CLAUDE.md` (R-stage migration playbook section) — context
  for what R8 cutover means in this codebase
- `docs/solutions/best-practices/nextjs-server-action-error-redaction-prod-20260430.md`
  — sibling lesson from the same PR
- `docs/solutions/integration-issues/algolia-server-key-vs-public-key-cross-domain-20260430.md`
  — sibling lesson on the Algolia integration choice
- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md`
  — related guidance on migration-era code
