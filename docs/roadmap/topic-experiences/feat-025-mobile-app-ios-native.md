---
id: "feat-025"
title: "Mobile App — iOS Native"
owner: "urim"
priority: "P0"
status: "complete"
start_date: "2026-02-25"
duration: 16
depends_on:
  - "feat-022"
  - "feat-026"
blocks: []
tags:
  - "mobile"
  - "ios"
---

## Problem

A native iOS app was built as a proof-of-concept to evaluate SwiftUI for rendering CMS experiences. It demonstrated that the GraphQL contract and section component model work across completely different technology stacks (Swift vs JavaScript).

## Entry Points — Read These First

1. `apps/mobile/ios/` — the Xcode/Swift iOS app (if still present)
2. Section renderers: VideoHeroView, TextView, CTAView, CardView, BibleQuotesCarouselView, RelatedQuestionsView, VideoView, MediaCollectionView, SectionWrapperView, ContainerView, EasterDatesView
3. GraphQL client and codegen for Swift

## Grep These

- `SwiftUI` in iOS source files — SwiftUI view implementations
- `GraphQL\|Apollo` in iOS source files — GraphQL client usage
- `SectionRenderer\|SectionView` in iOS source files — section dispatch pattern

## What Was Built

1. Scaffolded native Xcode/Swift iOS app.
2. Built GraphQL client and codegen for typed CMS queries in Swift.
3. Implemented SwiftUI section renderers for all 12 CMS section types.
4. Added blur effects, translucent hero backgrounds, video autoplay, and native animations.
5. Completed as a proof-of-concept — the team consolidated on Expo (feat-024) as the primary mobile target.

## Verification

- iOS app source exists in the repo
- All 12 section renderer views were implemented in SwiftUI
- The app served its purpose as a technology validation before consolidating on Expo
