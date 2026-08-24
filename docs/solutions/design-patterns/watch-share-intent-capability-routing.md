---
title: "Route Watch sharing by user intent and content capability"
date: "2026-08-24"
category: "design-patterns"
module: "apps/web/watch"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "A single action exposes link sharing, embedding, downloads, or permission-gated reuse"
  - "Different content owners expose different sharing capabilities"
tags:
  - "watch"
  - "sharing"
  - "jobs-to-be-done"
  - "capability-routing"
  - "licensing"
  - "accessibility"
---

# Route Watch sharing by user intent and content capability

## Context

A flat Share surface makes unlike actions look interchangeable. A Facebook
link post, a website iframe, an offline download, and republication of media
bytes are different jobs with different inputs and permission boundaries.
Showing every mechanism together encourages users to choose an attractive but
inapplicable tool, such as pasting iframe HTML into an ordinary social post.

The Watch share redesign in pending PR #2003 starts with the user's intended
outcome and reveals only the mechanisms relevant to that outcome. It preserves
the existing URL, embed, download, and licensing destinations rather than
inventing new policy.

## Guidance

Model navigation as two separate decisions:

1. **Intent:** what the user wants to accomplish, such as posting socially,
   sending a link, showing content offline, or using it in a website or
   production.
2. **Capability:** what the current content can actually provide, such as a
   canonical Watch URL, an embed snippet, or a page-owned download callback.

Keep the permission boundary explicit. Link sharing and website embedding can
give concrete steps immediately. Native social upload, republication, and clip
reuse must route to the approved licensing intake without asserting whether a
specific use will be approved.

In `apps/web/src/components/watch/ShareModal.tsx`, capability presence selects
the safe entry state:

```tsx
const activeView =
  view !== "choose"
    ? view
    : shareableUrl
      ? "choose"
      : embedSnippet
        ? "embed"
        : null
```

This makes link-capable videos start at the intent chooser, embed-only content
start at the usable embed result, and content with neither capability remain a
close-only dialog instead of presenting dead-end actions. The generic Series
caller supplies `usageGuidanceScope="generic"`, so it can offer link sharing
without implying video-download or reuse rights.

## Why This Matters

Intent-first routing answers the user's question before exposing tools. The
capability gate prevents empty or misleading screens when a caller cannot
supply every mechanism. Keeping downloads page-owned preserves existing access
rules, while a single approved licensing destination prevents permission
language and intake routes from drifting between social upload and clip reuse.

The state model also provides low-cardinality analytics without personal data:
events record only the selected static intent, guidance scope, surface, or
reuse type.

## When to Apply

- A UI label such as Share has accumulated mechanisms with different platform
  constraints.
- The same modal is reused by callers with different content capabilities.
- Some outcomes are self-service while others require an existing approval or
  licensing channel.
- Analytics must describe funnel choices without recording titles, URLs, or
  other content-derived values.

## Examples

- **Facebook:** provide the canonical Watch URL, explain that the action creates
  a link post, and route native-video upload questions to licensing.
- **YouTube or Instagram:** provide a Watch link and licensing guidance; do not
  recommend iframe HTML.
- **Website:** provide iframe HTML only when an embed snippet exists.
- **Offline:** invoke the page owner's download flow rather than duplicating
  download eligibility inside the modal.
- **Series:** offer link sharing, but omit video-specific embed, download, and
  reuse claims.

## Related

- [Watch modal close buttons must remain viewport-fixed and inside the accessible dialog tree](../ui-bugs/watch-modal-close-button-viewport-accessibility.md)
- [Watch Share action renders on individual video hero, not Watch home](../ui-bugs/watch-video-hero-share-action-placement.md)
- [Public Watch URL two-segment contract](../conventions/public-watch-url-two-segment-contract-20260608.md)
- [FGE-64 roadmap ticket](../../roadmap/platform/feat-412-watch-share-usage-guidance.md)
