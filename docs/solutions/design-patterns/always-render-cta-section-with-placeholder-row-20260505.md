---
title: "Always-render CTA section with placeholder row when editorial content is empty"
date: 2026-05-05
category: docs/solutions/design-patterns
module: apps/web
problem_type: design_pattern
component: frontend_stimulus
severity: low
related_components:
  - WatchStudyQuestions
  - WatchBody
  - BibleQuotesSection
tags:
  - watch-page
  - related-questions
  - ask-yours
  - placeholder-row
  - cta
  - conditional-rendering
  - ui-pattern
  - design-pattern
  - react
  - next-js
applies_when:
  - "Section contains both editorial content (data-driven list) and an always-relevant CTA"
  - "CMS or upstream data may legitimately return zero editorial items"
  - "Hiding the entire section would also hide the CTA, stranding the user"
---

# Always-render CTA section with placeholder row when editorial content is empty

## Context

The watch page on `apps/web` renders a "Related Questions" section in the right column, populated by editorial study questions from Strapi, plus an "Ask Yours" CTA that opens a modal letting the viewer pose their own question to the creator. The original gating was:

```ts
// WatchBody.tsx — original
const hasRightColumn = prompts.length > 0
return (
  <section data-has-right-column={hasRightColumn ? "true" : "false"}>
    <div className={hasRightColumn ? "md:col-span-8" : "md:col-span-12"}>
      {/* left column */}
    </div>
    {hasRightColumn ? (
      <div data-testid="watch-body-right">
        <WatchStudyQuestions prompts={prompts} onAskYoursClick={...} />
      </div>
    ) : null}
  </section>
)
```

For videos with no editorial study questions in the CMS (e.g., the Lumo Mark 3:20–4:41 chapter), the entire right column was hidden — including the always-relevant "Ask Yours" CTA. The reference design at jesusfilm.org always shows the section with a single placeholder row inviting the user to engage:

> If you could ask the creator of this video a question, what would it be?

The placeholder row is non-interactive (no hidden answer to expand), but the "Ask Yours" pill in the section header is always live.

The same shape appears elsewhere on the watch page: `BibleQuotesSection` already follows this pattern — its "Join Our Bible Study" promo card always renders even when `bibleCitations` is empty. The fix below brings `WatchStudyQuestions` into alignment with that precedent.

## Guidance

When a section combines editorial content with an always-relevant CTA, gate the section on **the CTA's relevance**, not on **the editorial content's presence**. Use a placeholder fallback for the editorial portion when it is empty.

Two practical rules:

1. **Section visibility decisions live above the editorial conditional.** Whether the section renders is a parent-level question (driven by CTA relevance, layout intent, or product decision). Whether the inside renders editorial vs placeholder is a child-level question. Keep these two decisions in different files / different scopes; do not couple them through a single `prompts.length > 0` gate.
2. **The placeholder row matches the editorial row's visual contract.** Same `<li>` shape, same icon, same className — so the layout does not shift when CMS data flips between empty and populated.

```tsx
// WatchBody.tsx — right column always renders
<div data-testid="watch-body-right" className="md:col-span-4">
  <WatchStudyQuestions prompts={prompts} onAskYoursClick={onAskYoursClick} />
</div>
```

```tsx
// WatchStudyQuestions.tsx — the empty/populated branch lives inside the section
const PLACEHOLDER_QUESTION =
  "If you could ask the creator of this video a question, what would it be?"

const hasPrompts = prompts.length > 0

return (
  <section>
    <header>
      <h4>Related Questions</h4>
      <Button onClick={onAskYoursClick}>Ask yours</Button>
    </header>
    <ul>
      {hasPrompts ? (
        prompts.map((prompt, index) => (
          <li
            key={`${index}-${prompt}`}
            data-testid="watch-study-questions-item"
          >
            <p>
              <QuestionIcon />
              {prompt}
            </p>
          </li>
        ))
      ) : (
        <li data-testid="watch-study-questions-placeholder">
          <p>
            <QuestionIcon />
            {PLACEHOLDER_QUESTION}
          </p>
        </li>
      )}
    </ul>
  </section>
)
```

## Why This Matters

- **Stranded CTAs.** A CTA's relevance rarely depends on whether its sibling editorial content exists. Gating both on the same condition silently hides one of them. A user who happens to land on a video without editorial prompts loses the entire path to engage with the creator.
- **Layout consistency.** When sections appear and disappear based on CMS data, the surrounding layout reflows in ways editors and ops cannot preview. An always-rendered placeholder row keeps the layout stable across content states — what an editor sees while authoring matches what a viewer sees on a freshly-published video.
- **Accessibility contract preservation.** The placeholder row should preserve the same a11y guarantees as the populated row: no `aria-haspopup`, no `aria-expanded`, decorative SVGs only (`aria-hidden="true"`, no `rotate-` / `transition` classes that imply expandability), no nested interactive elements. Otherwise the empty-state UX silently regresses the contract pinned by the populated-state tests.
- **Dead conditional signals.** A `data-has-X={cond ? "true" : "false"}` attribute that ends up always emitting `"true"` after this refactor is dead code. Remove it; do not leave a hardcoded literal that trains future readers (or future Playwright selectors) to expect variability that no longer exists.

## When to Apply

Apply this pattern when **all** of:

- The section contains both editorial content (data-driven list, fetched item, or similar) and a CTA / always-on invite.
- The CTA is meaningful even when editorial content is empty.
- Hiding the entire section would feel like a missing feature, not a clean empty state.

Do not apply when:

- The CTA itself depends on the editorial content (e.g., a "share these prompts" button that has nothing to share without prompts).
- The section is purely informational with no user action — there, just hide it on empty.
- The empty case is degenerate and the page should re-arrange around it (different layout entirely).

## Examples

### Before — section gated on editorial content (`WatchBody.tsx`)

```tsx
const hasRightColumn = prompts.length > 0

return (
  <section data-has-right-column={hasRightColumn ? "true" : "false"}>
    <div className={hasRightColumn ? "md:col-span-8" : "md:col-span-12"}>
      {/* left column */}
    </div>
    {hasRightColumn ? (
      <div data-testid="watch-body-right">
        <WatchStudyQuestions prompts={prompts} onAskYoursClick={...} />
      </div>
    ) : null}
  </section>
)
```

### After — section always renders, branch is internal

```tsx
return (
  <section>
    <div className="md:col-span-8">
      {/* left column */}
    </div>
    <div data-testid="watch-body-right">
      <WatchStudyQuestions prompts={prompts} onAskYoursClick={...} />
    </div>
  </section>
)
```

### After — `WatchStudyQuestions.tsx` owns the empty case

```tsx
{
  prompts.length > 0 ? (
    prompts.map((prompt, index) => (
      <li key={`${index}-${prompt}`} data-testid="watch-study-questions-item">
        <p>
          <QuestionIcon />
          {prompt}
        </p>
      </li>
    ))
  ) : (
    <li data-testid="watch-study-questions-placeholder">
      <p>
        <QuestionIcon />
        {PLACEHOLDER_QUESTION}
      </p>
    </li>
  )
}
```

The "Ask Yours" CTA in the section header renders unconditionally above the list.

### Test contract — pin the placeholder branch against the same UX-regression rules

The populated branch is already pinned by `WatchBody.test.tsx > "WatchStudyQuestions — UX regression: no false-affordance chevrons"`. Add a sibling test for the empty branch so the contract holds across both states:

```tsx
it("placeholder row (empty prompts) is non-interactive: no nested button/anchor, decorative SVG only, and Ask Yours stays the only button", () => {
  render(<WatchStudyQuestions prompts={[]} onAskYoursClick={vi.fn()} />)

  const placeholder = screen.getByTestId("watch-study-questions-placeholder")
  expect(placeholder.tagName.toLowerCase()).toBe("li")
  expect(placeholder.hasAttribute("aria-haspopup")).toBe(false)
  expect(placeholder.hasAttribute("aria-expanded")).toBe(false)
  expect(placeholder.querySelector("button")).toBeNull()
  expect(placeholder.querySelector("a")).toBeNull()

  for (const svg of placeholder.querySelectorAll("svg")) {
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    const cls = svg.getAttribute("class") ?? ""
    expect(cls).not.toMatch(/\brotate-/)
    expect(cls).not.toMatch(/\btransition\b/)
  }

  // Real prompt rows must be absent in the placeholder branch.
  expect(screen.queryAllByTestId("watch-study-questions-item").length).toBe(0)

  // Singleton-button contract holds across the empty-prompts path too.
  const buttons = screen
    .getByTestId("watch-study-questions")
    .querySelectorAll("button")
  expect(buttons.length).toBe(1)
  expect(buttons[0]?.getAttribute("data-testid")).toBe(
    "watch-study-questions-ask-yours",
  )
})
```

The textContent of the placeholder should also be asserted against the constant in at least one parent-level test so that silent edits to `PLACEHOLDER_QUESTION` get caught:

```tsx
expect(
  screen.getByTestId("watch-study-questions-placeholder").textContent,
).toContain(
  "If you could ask the creator of this video a question, what would it be?",
)
```

## Related

- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` — same watch-page architecture; documents the route-bound block model (`useRouteVideo` / `itemsSource`) that backs `WatchBody`'s data shape.
- `docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md` — sibling fix from the same release branch; same symptom class ("CMS absence causes silent UX failure").
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` — same `apps/web/src/components/watch/` directory; documents the sticky-hero layout the right column lives inside.
