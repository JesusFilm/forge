---
date: 2026-03-27
topic: mobile-quiz-button
---

# Mobile Quiz Button Component

## Problem Frame

The CMS `ComponentSectionsQuizButton` data type exists and renders on web, but the mobile app silently drops it — `sectionMapper.ts` has no case for it. Users on mobile never see the quiz CTA.

## Requirements

- R1. Render a `QuizButton` component when the section mapper encounters `ComponentSectionsQuizButton`.
- R2. Style the button to match the design reference: amber-to-red gradient background, "QUIZ" badge on the left, `buttonText` in the center, right-pointing arrow icon.
- R3. Tapping the button opens a **full-screen modal** containing a `WebView` loaded with the `iframeSrc` URL.
- R4. The modal includes a visible close button (top-right) to dismiss and return to the experience screen.

## Success Criteria

- Quiz button appears in the Easter experience on mobile wherever it appears on web.
- Tapping it loads the quiz URL in-app without leaving the app.
- The button style matches the screenshot reference (gradient, badge, arrow).

## Scope Boundaries

- No new GraphQL fragment needed — `iframeSrc` and `buttonText` are already queried via the existing section dynamic zone.
- No deep-linking or quiz result handling — just host the iframe URL.
- Web implementation unchanged.

## Key Decisions

- **Full-screen modal over bottom sheet or external browser**: Maximizes quiz space and matches web behavior.
- **WebView over expo-web-browser**: Keeps the user in-app for a seamless experience.

## Next Steps

→ `/ce:plan` for structured implementation planning
