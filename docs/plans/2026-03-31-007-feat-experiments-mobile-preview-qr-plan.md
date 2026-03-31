---
title: "feat: Add Mobile App Preview QR Code to Experiments Page"
type: feat
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-experiments-mobile-preview-requirements.md
---

# feat: Add Mobile App Preview QR Code to Experiments Page

## Overview

Replace the "Coming Soon" badge on the Mobile App experiment card with a "View Demo" button that expands inline to reveal a QR code and plain-language instructions for opening the app preview in Expo Go. Non-technical stakeholders should be able to go from the experiments page to running the app on their phone by following the on-screen instructions alone.

## Problem Statement / Motivation

The Mobile App card on `/experiments` currently shows a "Coming Soon" badge, but an EAS Update preview has been published to the `preview` channel. Stakeholders need a simple, self-service way to try the app without developer assistance. (See origin: `docs/brainstorms/2026-03-31-experiments-mobile-preview-requirements.md`)

## Proposed Solution

### Data Model Changes

Add an optional `preview` field to the `Experiment` type in `apps/roadmap/lib/experiments.ts` to support the expand-to-reveal pattern without hardcoding to experiment "03":

```typescript
// apps/roadmap/lib/experiments.ts
export type ExperimentPreview = {
  expoProjectId: string
  channel: string
}

export type Experiment = {
  // ... existing fields
  comingSoon?: boolean
  preview?: ExperimentPreview // new field — replaces comingSoon when set
}
```

Update the Mobile App experiment entry:

```typescript
// apps/roadmap/lib/experiments.ts — experiment 03
{
  number: "03",
  title: "Mobile App",
  description: "A native mobile app built on top of the experience platform, bringing curated and AI-generated content directly to phones. Currently in preview as we prepare for wider release.",
  team: ["urim"],
  links: [],
  comingSoon: false,  // no longer coming soon
  preview: {
    expoProjectId: "7759da20-79e5-4d06-bb88-0a7474617676",
    channel: "preview",
  },
  accent: "text-amber-400",
  accentBg: "bg-amber-500/10",
  accentBorder: "border-l-amber-500",
  buttonClass: "bg-amber-600 hover:bg-amber-500",
}
```

### New Client Component

Create `apps/roadmap/components/ExpoPreviewPanel.tsx` — a `'use client'` component that handles:

1. **Toggle state** — `useState(false)` for expand/collapse, matching the Sidebar pattern
2. **"View Demo" button** — styled with the experiment's `buttonClass`, toggles to "Close Preview" when expanded
3. **Expanded panel contents:**
   - Step-by-step instructions in plain language
   - App Store and Play Store links for Expo Go (always show both, with platform icons)
   - QR code generated from `exp://u.expo.dev/{projectId}?channel-name={channel}` using `qrcode.react`
   - "Open in Expo Go" direct link button for mobile/same-device users (see origin: critical gap from SpecFlow analysis)
   - Note to update Expo Go to latest version
4. **Accessibility** — `aria-expanded` on button, `aria-controls` pointing to panel `id`, standard disclosure pattern

```tsx
// apps/roadmap/components/ExpoPreviewPanel.tsx
"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"

type Props = {
  projectId: string
  channel: string
  buttonClass: string
}

export function ExpoPreviewPanel({ projectId, channel, buttonClass }: Props) {
  const [open, setOpen] = useState(false)
  const expoUrl = `exp://u.expo.dev/${projectId}?channel-name=${channel}`
  const panelId = "expo-preview-panel"

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg ${buttonClass} px-6 py-3 text-sm font-semibold text-white transition-colors duration-200`}
      >
        {open ? "Close Preview" : "View Demo"}
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-6 rounded-lg border border-[var(--color-border)] bg-black/20 p-6"
        >
          {/* Step-by-step instructions */}
          <h3 className="mb-4 text-sm font-semibold text-white">
            How to preview the app on your phone
          </h3>
          <ol className="mb-6 space-y-3 text-sm text-gray-400">
            <li>
              <span className="font-medium text-gray-300">Step 1:</span>{" "}
              Download the free "Expo Go" app on your phone:
              <div className="mt-2 flex gap-3">
                <a
                  href="https://apps.apple.com/app/expo-go/id982107779"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                >
                  App Store (iPhone)
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                >
                  Play Store (Android)
                </a>
              </div>
            </li>
            <li>
              <span className="font-medium text-gray-300">Step 2:</span> Open
              your phone's camera and point it at the QR code below. A prompt
              will appear to open the app in Expo Go.
            </li>
            <li>
              <span className="font-medium text-gray-300">Tip:</span> Make sure
              Expo Go is updated to the latest version for the best experience.
            </li>
          </ol>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={expoUrl} size={200} />
            </div>

            {/* Direct link for mobile/same-device users */}
            <a
              href={expoUrl}
              className="text-xs text-gray-500 underline hover:text-gray-400"
            >
              Or open directly in Expo Go on this device
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
```

### Page Integration

Update `apps/roadmap/app/(public)/experiments/page.tsx` to render `ExpoPreviewPanel` when an experiment has the `preview` field:

```tsx
// In the CTA section (replacing lines 80-107)
{experiment.preview ? (
  <ExpoPreviewPanel
    projectId={experiment.preview.expoProjectId}
    channel={experiment.preview.channel}
    buttonClass={experiment.buttonClass}
  />
) : experiment.comingSoon ? (
  <span className="inline-flex items-center gap-2 rounded-full border ...">
    Coming Soon
  </span>
) : (
  // existing links rendering
)}
```

### New Dependency

Add `qrcode.react` to `apps/roadmap/package.json`:

```bash
cd apps/roadmap && pnpm add qrcode.react
```

This is a lightweight (~12KB gzipped), well-maintained library that renders QR codes as SVG. It supports React 19 and works as a client component. SVG scales perfectly at any display size.

## Technical Considerations

- **Server vs Client Component**: The experiments page stays as a Server Component. Only the new `ExpoPreviewPanel` is `'use client'`, following the roadmap app convention (see `apps/roadmap/CLAUDE.md`: "Server Components by default. Only use `'use client'` for interactivity").
- **QR Code URL format**: Using `exp://u.expo.dev/{projectId}?channel-name={channel}` — a channel-based URL that stays stable across `eas update` publishes. If `exp://` scheme proves unreliable on some devices, can fall back to `https://expo.dev/preview/update?...` format. Verify during implementation. (See origin: deferred question)
- **EAS channel**: The `preview` channel is confirmed in `apps/mobile/eas.json` and documented in `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md`.
- **QR code sizing**: 200x200px SVG with white padding ensures scannability from ~30cm distance on standard displays.
- **No deployment impact**: The roadmap app doesn't use `output: "standalone"` (per `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`), so the new client component and dependency will bundle normally.

## Acceptance Criteria

- [ ] **R1.** "Coming Soon" badge on Mobile App card replaced with "View Demo" button in amber theme (see origin: R1)
- [ ] **R2.** Clicking "View Demo" expands the card inline with: Expo Go download instructions (App Store + Play Store links), QR code, and explanation (see origin: R2)
- [ ] **R3.** Instructions are in plain, non-technical language suitable for ministry stakeholders (see origin: R3)
- [ ] **R4.** QR code is generated at render time from stable channel URL — no static image files (see origin: R4)
- [ ] **R5.** "Open in Expo Go" direct link provided for mobile/same-device users alongside QR code (see origin: R5 + SpecFlow gap)
- [ ] **R6.** Clicking "View Demo" again collapses the panel (toggle behavior)
- [ ] **R7.** Expand/collapse is keyboard accessible with proper ARIA attributes (`aria-expanded`, `aria-controls`)
- [ ] **R8.** Scanning the QR code on a phone with Expo Go installed opens the app preview

## Success Metrics

- A non-technical person can go from the experiments page to running the app on their phone by following the on-screen instructions alone (see origin: success criteria)
- The QR code stays valid across future `eas update --channel preview` publishes

## Dependencies & Risks

- **New dependency**: `qrcode.react` — well-maintained, 3M+ weekly downloads, MIT licensed. Low risk.
- **Expo URL format**: The `exp://` channel-based URL needs verification that it works on both iOS and Android Expo Go. Mitigation: test before merging, fall back to `https://` format if needed.
- **Expo Go version mismatch**: If a user has an outdated Expo Go, the preview may fail. Mitigation: instructions include "make sure Expo Go is updated."

## Scope Boundaries

- No changes to home page (`/`) or about page (`/about`) experiment cards — out of scope for this plan, can be a fast follow-up (see origin: scope boundaries)
- No app install flow beyond Expo Go — no TestFlight, no APK sideloading
- No deep linking to specific screens within the app
- No analytics on QR code scans

## Files to Create/Modify

| File                                             | Action | Description                                                        |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| `apps/roadmap/lib/experiments.ts`                | Modify | Add `ExperimentPreview` type, add `preview` field to experiment 03 |
| `apps/roadmap/components/ExpoPreviewPanel.tsx`   | Create | New client component for expand/collapse QR code panel             |
| `apps/roadmap/app/(public)/experiments/page.tsx` | Modify | Import `ExpoPreviewPanel`, add `preview` rendering branch          |
| `apps/roadmap/package.json`                      | Modify | Add `qrcode.react` dependency                                      |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-31-experiments-mobile-preview-requirements.md](docs/brainstorms/2026-03-31-experiments-mobile-preview-requirements.md) — Key decisions: inline expand (not modal), generated QR code (not static image), channel-based URL for stability
- Existing experiments page: [apps/roadmap/app/(public)/experiments/page.tsx](<apps/roadmap/app/(public)/experiments/page.tsx>)
- Experiment data model: [apps/roadmap/lib/experiments.ts](apps/roadmap/lib/experiments.ts)
- EAS config: [apps/mobile/eas.json](apps/mobile/eas.json) — confirms `preview` channel
- EAS Update solution: [docs/solutions/mobile/eas-update-stakeholder-preview-setup.md](docs/solutions/mobile/eas-update-stakeholder-preview-setup.md)
- Roadmap app conventions: [apps/roadmap/CLAUDE.md](apps/roadmap/CLAUDE.md)
