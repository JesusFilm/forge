---
title: "Manager kitchen sink must cover production button surfaces"
category: ui-bugs
date: 2026-05-03
severity: medium
tags:
  - manager
  - design-system
  - kitchen-sink
  - tailwind
  - visual-parity
  - buttons
affected_components:
  - apps/manager/src/features/design-system/design-system-kitchen-sink.tsx
  - apps/manager/src/features/coverage/LanguageGeoSelector.tsx
  - apps/manager/src/components/ui/button.tsx
  - apps/manager/src/app/globals.css
related_docs:
  - docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md
  - docs/solutions/ui-bugs/manager-tailwind-reference-branch-visual-parity-20260429.md
  - docs/solutions/integration-issues/manager-coverage-language-persistence-20260501.md
---

# Manager Kitchen Sink Must Cover Production Button Surfaces

## Problem

A hidden Manager design-system kitchen sink page was added to show Tailwind tokens, shared UI primitives, form states, tables, feedback, layout utilities, and native elements. When comparing it to the real Subtitles/Coverage page, the "Select languages" button did not appear to match anything in the kitchen sink.

The confusing part was that the kitchen sink did show black primary buttons, but not the exact button used by the Subtitles language picker.

## Symptoms

- The real Coverage/Subtitles language picker renders a black "Select languages" button with a language icon.
- The hidden kitchen sink shows shared `<Button variant="primary">` examples instead.
- The visual match is close enough to look related, but not exact enough to use as a reliable parity reference.
- A developer inspecting only `src/components/ui/button.tsx` would miss the production `.geo-confirm` button class used by Coverage.

## Root Cause

Manager still has two active button systems:

1. Shared Tailwind-backed primitives under `apps/manager/src/components/ui/`, especially `button.tsx`.
2. Production screen-specific global classes in `apps/manager/src/app/globals.css`, including `.geo-confirm`, `.jobs-primary-button`, `.translation-primary`, and `.login-button`.

The Subtitles button comes from `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`:

```tsx
<button
  type="button"
  className="geo-confirm"
  ref={primaryActionRef}
  onClick={handlePrimaryAction}
  disabled={isLoading}
>
  {isPickerExpanded ? (
    <Check className="icon" aria-hidden="true" />
  ) : (
    <Languages className="icon" aria-hidden="true" />
  )}
  {isPickerExpanded ? "Confirm" : "Select languages"}
</button>
```

That class is styled in the Studio button rollout block:

```css
.jobs-primary-button,
.geo-confirm,
.translation-primary,
.login-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 8px 13px;
  color: #ffffff;
  font: inherit;
  font-weight: 500;
  line-height: 1.2;
  text-decoration: none;
  background: var(--ds-black);
  border: 1px solid var(--ds-black);
  border-radius: var(--ds-radius);
}
```

The kitchen sink, by contrast, imported and rendered the shared primitive:

```tsx
<Button variant="primary">
  <Plus aria-hidden="true" />
  Create job
</Button>
```

That primitive is useful, but it does not prove coverage for every production button style while legacy/global surface classes still exist.

## Solution

Treat a Manager kitchen sink page as an inventory of real rendered surfaces, not only the ideal shared component library.

When adding or reviewing the hidden kitchen sink:

1. Search production Manager screens for button-like selectors and component primitives:

   ```bash
   rg -n "className=.*button|className=.*confirm|geo-confirm|jobs-primary-button|translation-primary|login-button|<Button" apps/manager/src
   ```

2. Include both groups on the page:
   - Shared primitives: `Button`, `Badge`, `Input`, `SegmentedControl`, `Stepper`, `Card`, etc.
   - Production-specific classes that still exist: `.geo-confirm`, `.jobs-primary-button`, `.translation-primary`, `.login-button`, and any active screen-specific variants.

3. Label legacy/screen-specific examples as "production global classes" so the page does not imply they are the preferred API for new work.

4. If a production class should no longer exist, migrate the real screen to the shared primitive first, verify the real screen, then remove the production-only kitchen sink sample.

For the "Select languages" case, either add a production-surface sample:

```tsx
<button type="button" className="geo-confirm">
  <Languages className="icon" aria-hidden="true" />
  Select languages
</button>
```

or migrate `LanguageGeoSelector` to the shared button primitive and verify the Coverage/Subtitles page still matches the intended Studio visual language.

## Verification

Do not trust the kitchen sink by itself. Verify at least one real screen and the hidden route:

```bash
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager test
```

Then use a browser to compare:

- `/dashboard/coverage` with the language picker visible
- `/dashboard/design-system-kitchen-sink`

The hidden page should remain URL-only. Do not add it to the Studio sidebar or primary navigation unless product explicitly asks for a visible system page. A previous Manager design-system page was intentionally removed from PR scope, so the safer default is hidden diagnostic access.

## Prevention

- Before calling a design-system kit complete, grep for active production classes, not only shared `src/components/ui` primitives.
- Keep the kit as an audit surface for migration gaps. If the kit needs a legacy selector sample, that selector is a candidate for future migration.
- For user-facing visual parity, compare browser screenshots from real routes. A diagnostic page can reveal missing coverage, but it cannot prove the production route is correct by itself.
- When a user asks why a real screen does not match the kit, start by tracing the exact rendered class/component on the real screen.

## Related

- `docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md` — Tailwind migration scope and the goal of moving screen-level styling into shared primitives.
- `docs/solutions/ui-bugs/manager-tailwind-reference-branch-visual-parity-20260429.md` — why Manager visual work needs browser parity checks and why kitchen sink routes should stay out of production parity PRs unless explicitly requested.
- `docs/solutions/integration-issues/manager-coverage-language-persistence-20260501.md` — related Coverage language selector behavior and URL/session-state contract.
