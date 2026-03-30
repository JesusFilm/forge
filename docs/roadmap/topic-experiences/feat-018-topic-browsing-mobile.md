---
id: "feat-018"
title: "Topic Browsing — Mobile"
owner: "urim"
priority: "P1"
status: "not-started"
timeline: "Week 5-8"
depends_on:
  - "feat-016"
  - "feat-013"
blocks: []
tags:
  - "mobile"
---

## Entry Points — Read These First

1. `apps/mobile/src/screens/WatchHomeScreen.tsx` — home screen pattern
2. `apps/mobile/src/screens/ExperienceScreen.tsx` — how Experiences render on mobile. Topic detail will reuse this.
3. Feature 4 above — web implementation. Mobile should be functionally equivalent.

## Grep These

- `ExperienceScreen|useExperience` in `apps/mobile/src/` — Experience rendering pattern
- `Stack.Screen|Tabs.Screen` in `apps/mobile/src/` — navigation registration

## What To Build

1. Topic list screen: `apps/mobile/src/screens/TopicListScreen.tsx`
   - SectionList grouped by parent topics
   - Topic cards with name, description, video count
   - Pull-to-refresh

2. Topic detail screen: `apps/mobile/src/screens/TopicDetailScreen.tsx`
   - Topic header (name, description, video count)
   - Renders the linked Experience using existing section renderer system
   - Child topic chips/links
   - Back navigation to topic list

3. Navigation entry point — add Topics tab or button on home screen.

4. Reuse `SearchResultCard` from Feature 3 where applicable (video cards within topics).

## Constraints

- Reuse the existing Experience section rendering from `ExperienceScreen`. Do NOT duplicate section renderer logic.
- Use SectionList (not FlatList) for grouped topic list — parent topics as section headers.
- Do NOT add a tab bar just for topics if the app doesn't have one. Match the existing navigation pattern.

## Verification

- Navigate to Topics screen → topics load grouped by parent
- Tap a topic → detail screen with Experience sections
- Pull-to-refresh → data updates
- Back button → returns to topic list
- Sections render identically to ExperienceScreen
