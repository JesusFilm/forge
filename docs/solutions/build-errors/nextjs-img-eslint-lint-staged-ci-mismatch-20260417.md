---
module: "apps/web"
date: "2026-04-17"
problem_type: "build_error"
component: "tooling"
severity: "medium"
symptoms:
  - "CI lint job (@forge/web) fails with @next/next/no-img-element warning exceeding --max-warnings=0"
  - "Pre-commit lint-staged errors with 'Definition for rule @next/next/no-img-element was not found' when eslint-disable-next-line comment is present"
  - "Stuck state: disable comment satisfies CI but breaks lint-staged; removing it satisfies lint-staged but breaks CI"
  - "Raw <img> tag in a web component only triggers the Next.js rule under full-project ESLint config load"
root_cause: "wrong_api"
resolution_type: "code_fix"
related_components:
  - "development_workflow"
tags:
  - "nextjs"
  - "eslint"
  - "lint-staged"
  - "next-image"
  - "ci-local-mismatch"
  - "pre-commit"
  - "husky"
  - "app-router"
---

# Next.js `<img>` ESLint Deadlock: lint-staged vs CI Config Mismatch

## Problem

The repo's pre-commit hook (lint-staged running `eslint <file>`) and CI (`eslint . --max-warnings=0`) disagree on whether the Next.js rule `@next/next/no-img-element` is defined. This creates a deadlock where any raw `<img>` tag can neither be suppressed (pre-commit rejects the `eslint-disable-next-line` comment as an unknown rule) nor left un-suppressed (CI fails on the warning with `--max-warnings=0`).

## Symptoms

- **CI** `lint (@forge/web)` fails with: `Using <img> could result in slower LCP and higher bandwidth... @next/next/no-img-element` → `✖ 1 problem (0 errors, 1 warning)` → job fails because of `--max-warnings=0`.
- **Pre-commit** lint-staged fails (when the disable comment is present) with: `Definition for rule '@next/next/no-img-element' was not found` as an **error** (not warning).
- The two checks produce contradictory requirements: CI requires suppression or removal of the `<img>`; pre-commit rejects the suppression comment as an unknown-rule error.
- Affected files historically: `apps/web/src/components/SiteHeader.tsx` (Apr 15, 2026), `apps/web/src/components/sections/NavigationCarousel.tsx` (Apr 17, 2026).

## What Didn't Work

**Attempt 1 — Restore the eslint-disable comment:**

```tsx
// eslint-disable-next-line @next/next/no-img-element
<img src={item.imageUrl} alt={item.title} />
```

Pre-commit lint-staged rejected this immediately because `eslint <file>` invoked per-file does not resolve the Next.js ESLint plugin (`eslint-config-next/core-web-vitals`) from the repo root. The rule was reported as undefined → hard error.

**Attempt 2 — Remove the disable comment entirely:**

```tsx
<img src={item.imageUrl} alt={item.title} />
```

Pre-commit passed (no unknown-rule comment to flag), but CI failed because `eslint .` from the repo root resolved the plugin correctly and surfaced the `no-img-element` warning, which `--max-warnings=0` promoted to a failure.

**Attempt 3 (from session history, Apr 15)** — `next/image` with `unoptimized` on a static SVG logo. Lint passed on both sides, but the image 404'd at runtime because `next/image` does NOT auto-prepend `basePath: /watch` to `src` for unoptimized/SVG sources in SSR HTML. Required a follow-up commit that manually included `/watch` in the `src` path. (session history)

## Solution

Replace the raw `<img>` with `next/image`, eliminating the rule trigger entirely so neither lint context needs a suppression comment.

**Before:**

```tsx
{
  isFirst && item.imageUrl ? (
    <Image fill sizes="200px" src={item.imageUrl} alt={item.title} />
  ) : item.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imageUrl} alt={item.title} />
  ) : null
}
```

**After:**

```tsx
{
  isFirst && item.imageUrl ? (
    <Image fill sizes="200px" src={item.imageUrl} alt={item.title} priority />
  ) : item.imageUrl ? (
    <Image fill sizes="200px" src={item.imageUrl} alt={item.title} />
  ) : null
}
```

The original architectural intent (avoid over-prioritizing off-screen images) is preserved by omitting the `priority` prop on non-first items — `next/image` lazy-loads by default.

**Caveat for static SVGs / basePath apps:** If the app uses `basePath: /watch` and `next/image` needs `unoptimized` for SVG support, manually include the basePath in `src` (e.g., `src="/watch/images/logo.svg"`). `next/image` does NOT auto-prepend basePath to unoptimized sources. (session history)

## Why This Works

- `next/image` does not trigger `@next/next/no-img-element`, so the rule never fires in either context — no disable comment needed, no warning emitted.
- The root cause of the deadlock is the differing ESLint plugin-resolution scope between the two invocations:
  - **`eslint .`** (CI, from repo root via `pnpm --filter @forge/web run lint`) walks up and resolves `eslint-config-next` with its plugins loaded → `no-img-element` is defined.
  - **`eslint <file>`** (lint-staged, per-file) resolves the config relative to the file path within a pnpm workspace, which in this monorepo does not reliably pull in the Next.js plugin → `no-img-element` appears undefined and disable comments for it become errors.
- Removing the `<img>` removes the need to resolve the rule at all, side-stepping the context mismatch.

## Prevention

1. **Default to `next/image` everywhere in `apps/web/`.** The `apps/web/CLAUDE.md` already mandates "no raw `<img>` tags" — treat any raw `<img>` as a smell, not an exception. This problem has now recurred twice (SiteHeader Apr 15, NavigationCarousel Apr 17) because the rule wasn't enforced in code review. (session history — both sessions hit this deadlock)

2. **Do not add `eslint-disable-next-line` comments for plugin-provided rules.** If suppression is truly unavoidable, use a file-level `/* eslint-disable */` block with a comment explaining the plugin-resolution issue — but the correct fix is usually to remove the construct (use `next/image`) so the rule never fires.

3. **When a lint failure contradicts local pre-commit success (or vice versa), check plugin-resolution scope first.** The fix is usually to remove the offending construct, not to toggle disables.

4. **Align lint-staged and CI invocations long-term.** Consider changing the root `package.json` lint-staged config from:

   ```json
   "*.{ts,tsx}": ["eslint --max-warnings=0", "prettier --write"]
   ```

   to invoking the workspace's actual lint script scoped to changed files, so both contexts resolve the Next.js config identically. This eliminates the whole class of "rule defined in one context but not the other" bugs documented here and in [`nextjs-search-overlay-ui-patterns-20260415.md`](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md) Section 5.

5. **Run the full CI lint command locally before pushing** when a worktree commit bypasses the pre-commit hook or when eslint behavior looks suspicious:

   ```bash
   pnpm --filter @forge/web run lint --max-warnings=0
   ```

## Cross-References

- **[`nextjs-search-overlay-ui-patterns-20260415.md`](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md) Section 5** — Same root cause (lint-staged ESLint config divergence), different symptom (`<style jsx global>` rule not found). First recorded instance of this mismatch class.
- **[`jest-mock-import-first-lint-ordering.md`](../mobile/jest-mock-import-first-lint-ordering.md)** — Same `--max-warnings=0` CI gating mechanism, different rule (`import/first`). Prevention tips overlap.
- **[`codeql-tainted-output-striphtml-console-error-20260414.md`](../security-issues/codeql-tainted-output-striphtml-console-error-20260414.md) Prevention #4** — Notes that worktree commits bypass pre-commit hooks; the manual-lint prevention tip applies here too.

## Session History Note

Per session history search, this exact deadlock was discovered in session `2fabf22c` (Apr 15, 2026) on `feat/search-ui-web` with `SiteHeader.tsx`. The fix path was rediscovered from scratch in session `5704e43d` (Apr 17, 2026) on `feat/cross-platform-qa-pipeline` with `NavigationCarousel.tsx` because no solution doc existed. This doc captures the pattern so the third occurrence takes minutes instead of an hour of investigation.
