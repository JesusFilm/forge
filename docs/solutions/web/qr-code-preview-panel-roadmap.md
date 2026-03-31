---
title: "Add Expo mobile preview QR code panel to roadmap experiments page"
category: "web"
severity: "low"
date: "2026-03-31"
tags:
  - "next.js"
  - "expo"
  - "qr-code"
  - "eas-update"
  - "client-component"
  - "css-grid-animation"
  - "roadmap"
  - "stakeholder-preview"
module: "apps/roadmap"
problem_type: "feature_implementation"
---

# QR Code Preview Panel for Expo Mobile App on Roadmap Experiments Page

## Problem

Non-technical stakeholders needed a way to preview the Expo mobile app directly from the roadmap experiments page (`/experiments`) without requiring developer tools, CLI access, or knowledge of Expo's update system. The existing experiment card showed only a "Coming Soon" badge with no actionable path to the preview.

## Approach

Add an expandable inline panel to experiment cards that have a preview build available. The panel provides platform-specific Expo Go installation instructions, a scannable QR code for desktop users, and a direct deep link for mobile users. The solution keeps the experiments page server-rendered by isolating interactivity into a single `'use client'` component, and uses Expo's channel-based update URL so the QR code remains stable across all future `eas update` publishes.

## Implementation

### Data Model Extension

Added `ExperimentPreview` type to `apps/roadmap/lib/experiments.ts`:

```typescript
export type ExperimentPreview = {
  expoProjectId: string
  channel: string
}

export type Experiment = {
  // ...existing fields
  preview?: ExperimentPreview // replaces comingSoon when set
}
```

Updated the Mobile App experiment entry from `comingSoon: true` to a `preview` object with the EAS project ID and channel name.

### Client Component

Created `apps/roadmap/components/ExpoPreviewPanel.tsx` as a `'use client'` component:

- `useState(false)` toggle for expand/collapse
- `qrcode.react` `QRCodeSVG` renders the QR code from the stable channel URL
- CSS grid `grid-template-rows: 0fr/1fr` animation for smooth height transition
- Returns a React fragment (`<>`) so the button stays inline in the parent flex row while the panel takes full width below
- Dynamic `panelId` derived from `projectId` to prevent duplicate DOM IDs
- `encodeURIComponent` on URL parameters for defensive encoding
- Inline SVG icons (Apple, Play Store, Expo) as module-level functions
- `aria-expanded` and `aria-controls` for accessibility

### Page Integration

The experiments page (`apps/roadmap/app/(public)/experiments/page.tsx`) remains a Server Component. A new ternary branch renders `ExpoPreviewPanel` when `experiment.preview` exists, before the existing `comingSoon` and links branches.

## Key Code Patterns

### CSS Grid Height Animation

The modern way to animate height to/from auto without JavaScript measurement:

```tsx
<div
  style={{
    display: "grid",
    gridTemplateRows: open ? "1fr" : "0fr",
  }}
  className="transition-[grid-template-rows] duration-300 ease-in-out"
>
  <div className="overflow-hidden">{/* content */}</div>
</div>
```

This avoids the classic `max-height: 999px` hack (delayed start, abrupt end) and doesn't require `ResizeObserver` or content height measurement. The inner wrapper must have `overflow: hidden` for the collapse to work.

### Fragment Return for Flex Layout Control

Returning `<>button + panel</>` from a component inside a flex container lets the button stay inline while the panel breaks onto its own line with `w-full`:

```tsx
return (
  <>
    <button>{/* stays in flex row */}</button>
    <div className="w-full">{/* takes full width, wraps to next line */}</div>
  </>
)
```

This is fragile -- a future developer wrapping in a `<div>` will break the parent flex layout. Consider adding a comment at the return site.

### Channel-Based Expo URL for QR Stability

```typescript
const expoUrl = `exp://u.expo.dev/${encodeURIComponent(projectId)}?channel-name=${encodeURIComponent(channel)}`
```

This URL always resolves to the latest update published to the channel. Unlike `groupId`-based URLs (which change per `eas update`), the QR code never goes stale.

### Dynamic ARIA IDs from Data

```typescript
const panelId = `expo-preview-${projectId}`
```

Derives panel ID from a unique prop to prevent duplicate DOM IDs if multiple preview panels exist. Never hardcode ARIA IDs in list-rendered components.

## Review Findings Fixed

1. **Hardcoded `panelId`** -- Would cause duplicate DOM IDs if a second experiment gained a `preview` field. Fixed by deriving from `projectId`.
2. **URL params not encoded** -- `projectId` and `channel` interpolated without `encodeURIComponent`. Fixed with defensive encoding.
3. **Missing `rel="noopener noreferrer"`** on the `exp://` deep link. Fixed for consistency with other external links.

## Prevention Strategies

### For Future Interactive Panels

- **Always derive ARIA IDs from unique props.** Never default to a static string like `"panel-id"`. This prevents duplicate ID bugs in any list-rendered interactive component.
- **Comment fragment return patterns.** Add `// Fragment required: parent relies on direct flex children` to prevent future developers from wrapping in a div and breaking layout.
- **Colocate toggle state.** For self-contained expand/collapse panels, keep `useState` inside the component. Lift state only when an external consumer actually needs it.

### For Client Components in Server Component Pages

- The `'use client'` boundary is viral downward. Don't import server-only utilities into client components.
- Props from Server Components must be serializable (strings, numbers, plain objects). No functions or class instances.
- Consider `dynamic(() => import('./Component'), { ssr: false })` for components with no server-side rendering value.

### For QR Codes

- Minimum scannable size: ~120x120 CSS pixels. Safe default: 200x200.
- Use `level="M"` (medium error correction) unless embedding a logo (use `"H"`).
- Encode individual URL parameter values, not the entire URL string.
- For long-lived QR codes, consider a stable redirect URL you control that 302-redirects to the target.

### For Animations

- Transition `grid-template-rows` specifically, not `all`.
- Consider `prefers-reduced-motion` media query for accessibility.

## Related Documentation

- [EAS Update Stakeholder Preview Setup](../mobile/eas-update-stakeholder-preview-setup.md) -- Infrastructure this feature depends on. Note: that doc uses `groupId`-based URLs (`qr.expo.dev`); this feature uses channel-based URLs (`exp://u.expo.dev`) for stability.
- [Next.js Monorepo Railway Deployment](../deployment/nextjs-pnpm-monorepo-railway-standalone.md) -- Roadmap app deployment constraints (no `output: "standalone"`).
- [Server-Side Strapi Queries in Next.js](../graphql/server-side-strapi-queries-nextjs.md) -- Server-fetch-then-pass-as-props pattern used throughout.
- Plan: `docs/plans/2026-03-31-007-feat-experiments-mobile-preview-qr-plan.md`
- Requirements: `docs/brainstorms/2026-03-31-experiments-mobile-preview-requirements.md`
- Related PR: #592 (EAS Update infrastructure)
