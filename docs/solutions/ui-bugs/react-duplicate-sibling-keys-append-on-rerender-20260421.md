---
title: "React appends duplicate sibling subtrees when two Fragment siblings share the same key"
date: "2026-04-21"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: web
severity: high
symptoms:
  - "/demo-search grew extra 8-card grids on every Generate click — +2 grids per click, scaling unbounded"
  - "Duplicated subtrees were identical copies of a sibling component, not the one whose state changed"
  - "Repro independent of API outcome: POST returned 200 but DOM still accumulated"
  - "Initial page load was clean; bug only manifested on client-side re-render after user interaction"
root_cause: framework_misuse
resolution_type: code_fix
related_components:
  - apps/web/src/app/demo-search/page.tsx
  - apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx
  - apps/web/src/components/demo-search/DemoSearchResults.tsx
github_prs:
  - "#809"
  - "#815"
tags:
  - react
  - react-keys
  - reconciliation
  - nextjs
  - app-router
  - demo-search
  - compound-engineering
  - ce-review-regression
---

# React appends duplicate sibling subtrees when two Fragment siblings share the same key

## Problem

`/demo-search` rendered a growing stack of identical 8-card grids. One grid on initial load; after the first Generate click, three grids; after the second, five; and so on. Each click added exactly +2 grids.

The duplication happened regardless of whether the `POST /api/demo-search/generate` call succeeded or failed. Removing the Server Action (#813), fixing the basePath on the fetch URL (#814), and replacing `useTransition` with plain `useState` all left the duplication intact — none of them were the cause.

## Symptoms

- Headless Chromium repro against prod:

  | State          | `.mt-8` children | visible grids |
  | -------------- | ---------------- | ------------- |
  | Initial load   | 2                | 1             |
  | After 1 click  | 4                | 3             |
  | After 2 clicks | 6                | 5             |

- `MutationObserver` on the Suspense boundary confirmed `[ADD] DIV` events fired on every state change of the sibling component — 14 ms after click (first re-render for `setIsPending(true)`), then again ~3.8 s later (second re-render for `setState('success')`).
- No `[REMOVED]` events — React was appending, never reconciling.

## What Didn't Work

1. **Removing the Server Action** (PR #813). The RSC-revalidation-on-Server-Action theory was plausible but wrong: the bug still reproduced with a plain POST Route Handler.
2. **Fixing the basePath on the fetch URL** (PR #814). Real bug — the fetch was 404ing — but unrelated. Even with a 200 response, duplication persisted.
3. **Unit-testing the component in isolation.** The same-key collision only manifested inside the specific Fragment ordering in `page.tsx`. Component-level tests never caught it.

## Solution

Give each sibling its own distinct key:

```tsx
// Before (broken)
<DemoSearchResults key={query} ... />
<AiExperienceGeneratorDemo key={query} ... />

// After (fixed)
<DemoSearchResults key={`results-${query}`} ... />
<AiExperienceGeneratorDemo key={`ai-${query}`} ... />
```

The `query`-based key is preserved on both so they still remount cleanly when the query changes (resetting their `useState`) — the only thing that changed is the namespace prefix so the keys no longer collide.

## Why This Works

React's reconciler matches children by key within a parent. When two siblings share the same key, React's matching is undefined: it does not raise a hard error or even (in production builds) log a warning. What it does do — empirically, reproducibly — is append a copy of the non-re-rendered sibling to the parent on every re-render of the keyed sibling.

The bug required all three of these to line up:

1. Two siblings of different types (`DemoSearchResults`, `AiExperienceGeneratorDemo`) inside the same parent/Fragment.
2. Both carrying the same key value.
3. One of the two having local state that triggers re-renders (`isPending` + `state` in `AiExperienceGeneratorDemo`).

Each state change → React re-reconciles the Fragment → the keyed matcher mis-pairs the re-rendered element with its same-keyed sibling → reconciler can't reuse the existing DOM node so it creates a new one → the old sibling doesn't get unmounted because it's still in the tree under a different identity → net effect: one `append`, no `remove`. Two state changes per click → +2 nodes per click.

## Prevention

**Rule: keys must be unique among siblings, not just among array items.** This is documented in React's official docs but is easy to miss when Fragment children are static JSX rather than `.map()`-generated lists — developers assume "key is only for lists." It is not.

**Grep pattern for the same mistake:** search for two `key={` on sibling JSX elements that share the same expression:

```bash
rg -U 'key=\{[^}]+\}[^<]*(\n[^\n<]*)*<[A-Z].*\n[^<]*key=\{[^}]+\}' apps/web/src
```

**When a ce:review / follow-up adds a `key={...}` to an existing component, audit all siblings** in the same parent/Fragment for existing keys. PR #809 gave `DemoSearchResults` its `key={query}`; the ce:review fix at commit `740ce41` added the same key to `AiExperienceGeneratorDemo` in isolation, without noticing the sibling collision. Agent-native review needs an explicit "sibling-key scan" step when adding a key to a component in a multi-sibling parent.

**Verify UI fixes in a real browser, not just tests.** The repro was trivial in headless Chromium (one `page.evaluate` + `MutationObserver`) but invisible to unit tests. When a UI bug is reported and not reproduced after a code change, run the actual browser before claiming the fix — don't trust theory-of-mind.

## Prior Theories That Were Wrong (for future diagnosis)

Write these down so the next person doesn't re-run the same dead ends:

- **"Next.js 16 Server Actions auto-revalidate the RSC tree and append."** Server Actions _do_ revalidate the current route, but they replace, not append. Removing the Server Action did not fix the bug.
- **"The basePath-less fetch is 404ing and the error path is re-mounting."** Error paths in `useState` don't mount siblings. 404s are unrelated.
- **"`<Link>` prefetching is merging foreign RSC trees into the current page."** Hovering `<Link>`s without clicking Generate does not reproduce the duplication. Prefetching is innocent.
- **"Next.js 16 Suspense-boundary streaming is appending resolved content twice."** The SSR HTML is clean — one resolved grid inside `<div hidden id="S:1">`, replaced by `$RC("B:1","S:1")`. The bug is purely client-side after hydration.

## Related Documentation

- PR #809 — original `/demo-search` feature (introduced the first `key={query}`).
- PR #813 — Server Action → Route Handler migration (ruled out as cause, but standalone improvement).
- PR #814 — basePath fix for the `/watch/api/demo-search/generate` fetch URL (unrelated bug also discovered during this investigation).
- PR #815 — the fix for this bug.
- Commit `740ce41` — ce:review follow-up that introduced the second `key={query}` on the sibling.
