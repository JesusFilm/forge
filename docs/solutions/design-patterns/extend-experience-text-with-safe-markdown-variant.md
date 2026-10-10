---
title: "Extend Experience text with a safe Markdown variant before adding a new block type"
date: "2026-07-14"
category: "design-patterns"
module: "apps/admin Experience Builder and apps/web Experience rendering"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "Adding an editorial text treatment when TextBlock already carries the required content fields"
  - "Building a design-rich Experience section from existing composable blocks"
  - "Accepting Markdown that must remain crawlable, server rendered, and safe by default"
  - "Changing an Admin block enum consumed through packages/admin-graphql"
related_components:
  - "apps/admin"
  - "apps/web"
  - "packages/admin-graphql"
tags:
  - "experience-editor"
  - "text-block"
  - "markdown"
  - "server-rendering"
  - "content-composition"
  - "graphql"
  - "seo"
  - "content-safety"
---

# Extend Experience text with a safe Markdown variant before adding a new block type

## Context

The Watch home Experience needed a substantial, promotional text section so
editors could add descriptive copy for viewers and search crawlers. The
existing `TextBlock` already supported headings, subtitles, paragraph arrays,
and presentation variants at both the top level and inside a `SectionBlock`.
The missing capability was a discoverable long-form authoring mode and a richer
Web presentation, not another persisted content shape.

Adding a new block discriminator would have expanded the persistence union,
Pothos union, generated client contract, editor switch, and every consumer
dispatcher for content that was still fundamentally text. Accepting raw HTML
would also have made the CMS input a scripting and markup-injection boundary.

## Guidance

### Prefer a variant when the content semantics already exist

Extend `TextBlock` with a presentation variant when the requested capability
uses the same heading, subtitle, and text-body semantics. Reserve a new block
discriminator for content with a genuinely different data model, lifecycle, or
consumer behavior.

For the promotional treatment, the only persisted contract change is the new
enum value:

```ts
variant: z.enum(["default", "lead", "small", "promotional"]).optional()
```

Mirror the value in the Pothos enum, regenerate the Admin SDL, and regenerate
the `packages/admin-graphql` gql.tada introspection artifact in the same
change. Do not hand-edit either generated contract.

### Make the block-library starter a composition

Presentation concerns such as background color, opacity, overlay texture, and
content width already belong to `SectionBlock`. The editor's “Promotional
Story” starter should therefore create an ordinary section containing a
promotional text block:

```ts
{
  t: "section",
  backgroundColor: "purple",
  backgroundOpacity: 1,
  staticOverlay: true,
  content: [
    {
      t: "text",
      headingLevel: "h2",
      contentParagraphs: ["### Add a descriptive subheading", "Write copy…"],
      variant: "promotional",
    },
  ],
}
```

This keeps the visual shell composable and leaves the text renderer responsible
only for typography and Markdown semantics.

### Preserve the existing storage field

Keep `contentParagraphs: string[]` as the durable field. For promotional text,
split editor input on blank lines so Markdown blocks remain intact, then join
the stored strings with blank lines before rendering. Retain the legacy
line-by-line behavior for existing variants.

This is a variant-specific serialization rule, so test both directions:

- editor text to `contentParagraphs`;
- `contentParagraphs` back to editor text;
- legacy newline behavior remains unchanged;
- empty input produces an empty array.

### Render Markdown through an explicit server-side allowlist

Use the existing `react-markdown` dependency in the Server Component, with
explicit renderers for headings, paragraphs, lists, blockquotes, emphasis, and
links. Keep the library's default HTML handling and URL transform:

```tsx
<Markdown
  components={PROMOTIONAL_MARKDOWN_COMPONENTS}
  urlTransform={defaultUrlTransform}
>
  {markdown}
</Markdown>
```

Do not add `rehype-raw`, `dangerouslySetInnerHTML`, or a client boundary. Raw
HTML then remains visible, inert copy instead of executable markup, and unsafe
link protocols are neutralized by the URL transform. Tests should assert the
rendered semantic structure, literal raw-HTML text, absence of injected script
nodes, and handling of unsafe links.

### Prove authoring, rendering, and load impact separately

The verification contract spans three boundaries:

1. Admin tests prove the block-library entry is visible, inserts the expected
   section composition, and round-trips Markdown.
2. Web SSR tests prove semantic markup, safety, and unchanged legacy variants.
3. Browser proof checks desktop/mobile layout, initial server HTML, browser
   errors, horizontal overflow, and whether the section adds media, requests,
   hydration, or client initialization.

For a server-only text section, the page-load evidence is structural: no new
client component, no media elements, no section-owned fetch, and the authored
copy is present in the first HTML response.

## Why This Matters

Variant-first extension keeps Experience content compatible across consumers
and avoids multiplying switch cases for semantically identical data. A
composed starter still gives editors a one-click, design-rich section while
preserving the established separation between section backgrounds and nested
content.

Safe server-side Markdown produces real headings, paragraphs, lists, and links
for accessibility and crawling without turning editorial content into trusted
HTML. Keeping the section server rendered also avoids spending the Watch
page's hydration and page-load budget on static copy.

## When to Apply

- The existing block already owns the requested content fields.
- The change is primarily a presentation or authoring treatment.
- A section shell can compose the necessary background and nested blocks.
- Editors need structured prose, but arbitrary HTML, scripts, embeds, and
  custom CSS are out of scope.
- The Admin GraphQL enum is consumed by generated clients and must change in
  lockstep with its artifacts.

Create a new block discriminator instead when the content has distinct fields,
validation rules, lifecycle, or rendering behavior that cannot be expressed as
an existing block variant.

## Examples

Avoid creating a parallel `PromotionalTextBlock` with a duplicate heading and
body contract:

```ts
type PromotionalTextBlock = {
  t: "promotionalText"
  heading: string
  body: string
}
```

Prefer the existing contract plus a variant and a starter composition:

```ts
type TextBlock = {
  t: "text"
  heading?: string
  contentParagraphs: string[]
  variant?: "default" | "lead" | "small" | "promotional"
}
```

Consumers that do not implement the promotional presentation can still read
the same text field, while Web applies the richer Markdown treatment.

## Related

- [Admin experience media picker should persist asset IDs and resolve app URLs at read boundaries](../best-practices/admin-asset-backed-experience-media-picker-pattern-20260707.md)
- [Frontend changes require page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
- [Fix TextRenderer paragraph separation for JSON array content](../mobile/text-renderer-paragraph-type-mismatch.md)
