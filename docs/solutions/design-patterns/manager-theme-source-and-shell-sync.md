---
title: "Keep Manager theme ownership outside the user menu"
date: "2026-08-20"
category: "design-patterns"
module: "apps/manager"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "A client-rendered shell follows the operating-system color scheme until a user makes an explicit choice"
  - "The control that changes a persistent preference is mounted only while a menu or dialog is open"
  - "Browser storage may be unavailable while the current-page preference must still remain stable"
tags:
  - "manager"
  - "dark-mode"
  - "theme"
  - "system-preference"
  - "local-storage"
  - "use-sync-external-store"
---

# Keep Manager Theme Ownership Outside the User Menu

## Context

Manager's theme switch belongs in the top-right user menu, but the menu is not
the lifecycle owner of the theme. If system-preference and cross-tab listeners
exist only inside that switch, closing the menu unsubscribes the page from both
sources. The page can then drift from the operating-system preference until the
menu is opened again.

Storage failure creates a second ownership trap. An explicit click still needs
to remain authoritative for the current page even when `localStorage.setItem`
throws. Re-reading storage on the next system event would otherwise erase the
user's in-memory choice.

## Guidance

Separate theme initialization, synchronization, and editing:

- Run a small pre-hydration initializer in the root layout so the first painted
  document already has `data-theme` and `data-theme-source`.
- Mount a listener-only synchronization component in the persistent shell,
  outside conditional menus and dialogs.
- Let the menu switch edit the document state, mark its source as `user`, make a
  best-effort persistence write, and notify subscribers.
- Follow `prefers-color-scheme` changes only while the source remains `system`.
- Route initializer and live-event decisions through the same pure theme
  resolver so their fallback semantics cannot drift.

The persistent owner is intentionally renderless:

```tsx
export function StudioThemeSync() {
  useSyncExternalStore(
    subscribeToManagerTheme,
    getManagerThemeSnapshot,
    () => "light",
  )

  return null
}
```

The source marker is separate from persistence state. On an explicit click,
set it before attempting storage:

```tsx
document.documentElement.dataset.theme = nextTheme
document.documentElement.dataset.themeSource = "user"

try {
  window.localStorage.setItem(MANAGER_THEME_STORAGE_KEY, nextTheme)
} catch {
  // The current-page choice remains explicit even without persistence.
}
```

## Why This Matters

The component visible to the user is often shorter-lived than the preference
it controls. Giving the conditional control responsibility for system events
makes behavior depend on whether a dropdown happens to be open. A persistent,
renderless shell subscriber keeps lifecycle ownership aligned with the page
whose appearance it governs.

Tracking `user` versus `system` independently also distinguishes an unavailable
storage mechanism from the absence of user intent. That preserves the user's
current-page choice without pretending the failed write persisted across a
reload.

## When to Apply

- A preference defaults from `matchMedia` but becomes explicit after a user
  action.
- The editing control is conditionally rendered.
- The preference must synchronize across tabs or react to system changes.
- The application must remain usable in privacy modes that disable storage.

## Examples

The focused test suite should mount the synchronization component with the menu
closed and exercise browser events directly. At minimum, verify that a system
change updates a system-owned theme, that a stored or in-memory user choice
blocks later system changes, that a storage event updates theme and source, and
that unmount removes every listener.

## Related

- `apps/manager/src/lib/manager-theme.ts`
- `apps/manager/src/features/shell/manager-shell.tsx`
- `apps/manager/src/features/shell/manager-theme-sync.test.ts`
- `docs/roadmap/platform/feat-401-manager-dashboard-dark-mode.md`
