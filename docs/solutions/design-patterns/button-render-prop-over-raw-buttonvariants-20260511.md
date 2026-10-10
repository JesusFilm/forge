---
title: "Use Button render prop instead of raw buttonVariants() on anchor elements"
date: "2026-05-11"
category: design-patterns
module: apps/web
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Styling an <a>, <Link>, or other non-button element with a Button variant (pill, ghost, etc.)"
  - "Consuming buttonVariants() directly as className outside of the Button component"
  - "Any element that needs Button visual styles but must render as a different HTML tag"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - apps/web/src/components/ui/button.tsx
  - apps/web/src/components/watch/WatchStudyQuestions.tsx
  - apps/web/src/components/sections/RelatedQuestions.tsx
  - apps/web/src/components/watch/BibleQuotesSection.tsx
tags:
  - tailwind-merge
  - cva
  - class-variance-authority
  - base-ui
  - button-component
  - render-prop
  - anchor-link
  - pill-variant
  - class-conflict
---

# Use Button render prop instead of raw buttonVariants() on anchor elements

## Context

When adding an external-link CTA that should visually match a pill button, the natural reach is `buttonVariants()` — the exported `cva` factory from `apps/web/src/components/ui/button.tsx`. It looks like the right escape hatch: it returns the same class string the `Button` component uses, so you can apply it directly to any element.

```tsx
// naive approach — looks correct, breaks visually
<a className={buttonVariants({ variant: "pill" })}>Chat with a person</a>
```

This is exactly what happened with the `CHAT_WITH_PERSON_URL` and `ASK_BIBLE_QUESTION_URL` CTAs in `WatchStudyQuestions.tsx` before the fix. The links rendered as `rounded-lg` rectangles instead of pill capsules, mismatching the Download / Ask Yours / Share buttons on the same page.

The same anti-pattern was introduced on the `BibleQuotesSection` promo-card CTA in an earlier session (2026-04-30 → 2026-05-04, branch `main`) with the comment "Using `buttonVariants` to style an anchor as a pill (preserves the new-tab semantics naturally)." That session also fixed a _separate_ CVA conflict — pill buttons capping at `h-8` because the size variant's `h-8 px-2.5` overrode pill padding, requiring a `compoundVariants` entry in `button.tsx`. The corner-radius variant of the same conflict went unnoticed because nothing on screen visually adjacent to the promo card surfaced the mismatch. (session history)

## Guidance

Use `<Button render={<a />}>` with `nativeButton={false}` instead of applying `buttonVariants()` directly to an `<a>` tag.

**Before (broken):**

```tsx
<a
  className={buttonVariants({ variant: "pill" })}
  href={CHAT_WITH_PERSON_URL}
  target="_blank"
  rel="noopener noreferrer"
>
  Chat with a person
</a>
```

**After (correct):**

```tsx
<Button
  variant="pill"
  nativeButton={false}
  render={
    <a href={CHAT_WITH_PERSON_URL} target="_blank" rel="noopener noreferrer" />
  }
>
  Chat with a person
</Button>
```

The `render` prop is a Base UI pattern: `ButtonPrimitive` substitutes the rendered element while keeping the `Button` wrapper's logic intact. On the Base UI version in use as of this writing (`@base-ui/react/button`), passing `nativeButton={false}` silences a runtime warning that the rendered element is not a `<button>`. If Base UI drops or renames this prop in a future version, the rest of the pattern still works — `nativeButton` is an opt-out signal, not a load-bearing part of the class-dedup fix.

## Why This Matters

The `buttonVariants` `cva` declaration in `button.tsx` sets `rounded-lg` in the **base** string and `rounded-full` in the **`pill` variant**:

```ts
const buttonVariants = cva(
  "... rounded-lg ...", // base — always included
  {
    variants: {
      variant: {
        pill: "... rounded-full ...", // added on top
      },
    },
  },
)
```

`cva` concatenates these; it does not deduplicate. The raw output of `buttonVariants({ variant: "pill" })` contains **both** `rounded-lg` and `rounded-full`. In a raw class string (no further processing), CSS cascade order determines the winner — and because Tailwind emits utilities in a generated order that is not lexicographic with respect to user expectations, `rounded-full` is not guaranteed to appear after `rounded-lg`. The observed result was `rounded-lg` winning, producing a rectangle.

Inside the `Button` component, the class string is passed through `cn(buttonVariants(...))`. `cn` is a `clsx` + `tailwind-merge` wrapper. `tailwind-merge` recognises that `rounded-lg` and `rounded-full` target the same CSS property and keeps only the last one, so `rounded-full` wins. **That deduplication only runs inside the `Button` component.** Calling `buttonVariants()` and assigning the raw result directly to a `className` attribute bypasses `tailwind-merge` entirely. (`buttonVariants` itself is compatible with `tailwind-merge` — it just needs to be wrapped in `cn(...)` at the call site, which the `Button` component does for you.)

The same mechanic applies to every other CVA conflict (e.g., the `h-8` height vs pill padding bug fixed via `compoundVariants` in the April session): raw `buttonVariants()` carries the merged class string without dedup, and the rendered element silently inherits the wrong winner.

## When to Apply

Use `<Button render={<a />} nativeButton={false}>` any time you need:

- An external link (`target="_blank"`) styled as a button
- A download link (`<a href="..." download>`) styled as a button
- In-app `<a>` navigation (e.g., Next.js `<Link>`) with a button appearance — prefer `<Button render={<Link href="..." />} nativeButton={false}>` as the render target
- Any case where the semantic element must not be `<button>` but the visual treatment must exactly match a `Button` variant

If you only need the class names without the `tailwind-merge` dedup (e.g., building a className dynamically for a third-party component that wraps its own element), call `cn(buttonVariants({ variant }))` explicitly rather than `buttonVariants(...)` raw — the `cn` import lives in `@/lib/utils`.

## Examples

**Existing precedent — `RelatedQuestions.tsx` (line ~149):**

```tsx
<Button
  variant="pill"
  aria-label={ctaLabel || "Ask a question"}
  render={<a href={ctaLink} target="_blank" rel="noopener noreferrer" />}
>
  <MessageCircleIcon />
  <span>{ctaLabel || "Ask yours"}</span>
</Button>
```

Note: `nativeButton` is omitted at this older callsite — the Base UI version in use when it was written did not surface the warning. Adding `nativeButton={false}` is still the safe default and silences a runtime warning on newer Base UI.

**Fixed CTAs — `WatchStudyQuestions.tsx`:**

Both `CHAT_WITH_PERSON_URL` and `ASK_BIBLE_QUESTION_URL` buttons use the `render={<a />} + nativeButton={false}` pattern. The `BibleQuotesSection` promo-card "Join our Bible study" CTA was also migrated to the same pattern in the same PR.

**Verification:** A computed-style probe across all five pill controls on the watch page (Download, Ask Yours, Share, Chat with a person, Ask a Bible question) returned **identical** `border-radius`, `height`, `padding`, `font-size`, `font-weight`, and `background-color` values — confirming that routing through `Button`'s `cn()` call is the only correct path for per-variant class deduplication.

## Prevention

- **Lint rule (proposed):** flag direct uses of `buttonVariants(` outside of `button.tsx`. The legitimate consumers are the `Button` component itself; everything else should go through `<Button render={...}>`.
- **Code-review checklist:** when reviewing a new external-link CTA, look for `className={buttonVariants(` on a non-Button element. If found, request a refactor to `<Button render={<a/>} nativeButton={false}>`.
- **Visual regression coverage:** the watch-page pill controls now share a computed-style probe (see CDP smoke script). Any new pill-styled control on that surface should be added to the probe so a regression of this shape is caught visually.

## Related

- Base UI `Button` `render` prop documentation — https://base-ui.com/react/components/button (substitutes the rendered element via React composition)
- `class-variance-authority` README — concatenation semantics that this pattern works around
- `tailwind-merge` README — explains class-conflict resolution that `cn()` provides
- The `compoundVariants` entry in `apps/web/src/components/ui/button.tsx` (April 2026) — same CVA-conflict family, applied to the `h-8` × pill-padding collision
