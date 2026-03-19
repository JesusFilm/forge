---
title: "Restoring upstream UI verbatim — copy first, adapt minimally"
category: platform
date: 2026-03-19
tags:
  - ui-restoration
  - videoforge
  - manager
  - monorepo
---

# Restoring upstream UI verbatim

## Problem

When porting UI from the original VideoForge repo into the Forge monorepo, AI agents over-adapted the components — stripping headers, language badges, step icons, and page structure. The result looked very different from the original.

## Solution

**Copy original files verbatim, then make only the minimum changes needed:**

1. Clone the original repo locally (`git clone --depth 1`)
2. Copy files directly (`cp`) instead of fetching and rewriting
3. Make only these surgical changes:
   - **Import paths** for data sources (`@/data/job-store` → `@/lib/state`)
   - **API response unwrapping** (Forge wraps in `{ jobs: [...] }` / `{ job: {...} }`)
   - **Route paths** (`/jobs` → `/dashboard/jobs`)
   - **Type extensions** (add `muxPlaybackId` to `JobRecord`)

4. Keep the original's full type union even if not all values are used — this lets all original UI code compile unchanged

## Key Patterns

### Type superset strategy

The original has 12 `WorkflowStepName` values but Forge only uses 5. Rather than narrowing the type (which breaks original UI components), keep the full union and only create the 5 Forge steps in `buildInitialSteps()`. The UI renders whatever steps are in `job.steps[]`.

### API response adapter

The original expects `JobRecord[]` from `/api/jobs` but Forge returns `{ jobs: JobRecord[] }`. Fix at the client parse site, not the API:

```typescript
// Original: const payload = (await response.json()) as JobRecord[]
// Forge:
const raw = (await response.json()) as { jobs: JobRecord[] }
const payload = raw.jobs
```

### Hydration flash prevention

Client components that read `sessionStorage` in `useState` lazy initializers cause hydration mismatches. Fix: initialize with defaults, hydrate in `useEffect`, and gate interactive elements behind `useHydrated()`:

```typescript
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}
```

### Parallel step failure handling

When running steps in parallel with `Promise.all`, wrap each step individually so failures mark the correct step:

```typescript
async function runParallelStep<T>(stepName, fn): Promise<T> {
  try {
    const result = await fn()
    await markStepComplete(jobId, stepName)
    return result
  } catch (err) {
    await markStepFailed(jobId, stepName, err.message)
    throw err
  }
}
```

### Root .gitignore gotcha

The root `.gitignore` has `coverage/` which catches `src/features/coverage/`. Use `git add -f` for files in directories named `coverage`. Consider narrowing the ignore to `/coverage/` (root only).

## Files

- PR: https://github.com/JesusFilm/forge/pull/506
