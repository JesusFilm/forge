# Library Tab — Experience Selector

**Date:** 2026-04-08
**Status:** Draft
**Author:** Urim (brainstormed with Claude)

## Problem

The mobile app currently hardcodes a single experience (`"easter"`) in `ExperienceShell.tsx`. Users have no way to browse or switch between the experiences created in the CMS. The Library tab exists but is a placeholder. This feature turns it into an experience browser that drives the Home tab's content.

## Goals

1. Display all published Experience objects from the CMS in the Library tab as a scrollable list.
2. When the user taps an experience card, switch the active experience and navigate to the Home tab, which re-renders with the selected experience's content.
3. Persist the selected experience across app restarts.

## Non-Goals

- Search or filtering within the Library (future iteration).
- Offline-first experience caching beyond Apollo's existing cache.
- Experience preview/detail screen before committing to selection.
- Favoriting or bookmarking experiences.

## User Flow

1. User opens the Library tab.
2. Library shows a scrollable list of experience cards, each displaying:
   - **Thumbnail** (`ogImage` from Experience)
   - **Title** (`title`)
   - **Description** (`metaDescription`)
3. The currently active experience is visually indicated (e.g., checkmark, highlight, or "Now Playing" badge).
4. User taps an experience card.
5. The app sets the new experience slug as active, navigates to the Home tab.
6. Home tab shows a loading state briefly, then renders the new experience's SDUI content.
7. On next app launch, the persisted slug is read from AsyncStorage before the first render — Home shows the correct experience immediately with no flicker.

## Data Requirements

### New GraphQL Query: List Experiences

A lightweight query that fetches experience metadata **without blocks** (blocks are expensive and only needed when rendering the home page):

```graphql
query ListExperiences($locale: I18NLocaleCode!) {
  experiences(locale: $locale) {
    documentId
    slug
    title
    metaDescription
    ogImage {
      url
      alternativeText
      width
      height
    }
  }
}
```

### Experience Fields Used

| Field             | Card Usage                                |
| ----------------- | ----------------------------------------- |
| `slug`            | Unique key, used to set active experience |
| `title`           | Card title                                |
| `metaDescription` | Card description/subtitle                 |
| `ogImage`         | Card thumbnail                            |
| `documentId`      | React key                                 |

## Behavior Details

### Active Experience State

- Currently hardcoded as `DEFAULT_SLUG = "easter"` in `ExperienceShell.tsx`.
- Needs to become dynamic state, shared via context, and persisted to `AsyncStorage`.
- On first launch (no persisted value), default to the experience with `isHomepage: true`, falling back to the first experience in the list.

### Navigation on Selection

- Tapping a card sets the active slug and programmatically navigates to the Home tab using Expo Router.
- If the tapped experience is already active, just navigate to Home (no refetch).
- `ExperienceShell` reacts to slug changes and refetches the full experience with blocks.

### Loading & Error States

- **Library tab loading:** Skeleton cards while the list query loads.
- **Home tab after switch:** The existing loading state in `HomeScreen` handles this — `ExperienceProvider` already exposes `loading` and `error`.
- **Failed list fetch:** Show error state with retry button in Library tab.
- **Failed experience fetch:** Existing error handling in `ExperienceShell` covers this.

### Edge Cases

- **Empty list:** Show a message like "No experiences available" (shouldn't happen in practice since CMS always has content).
- **Deleted experience:** If the persisted slug no longer exists in the list, fall back to `isHomepage: true` or first available experience.
- **Image missing:** Use a fallback gradient or placeholder for cards without `ogImage`.

## Visual Design

- **Layout:** Vertical scrollable list using `FlashList` for performance.
- **Card style:** Thumbnail on the left or top, title + description text. Consistent with the app's dark theme and system font conventions.
- **Active indicator:** A subtle visual distinction (accent border, badge, or checkmark) on the currently active experience card.
- **Spacing:** Consistent with existing section spacing patterns in the app.

## Success Criteria

1. All published CMS experiences appear in the Library tab.
2. Tapping an experience navigates to Home, which renders the correct experience content.
3. The selected experience persists across app restarts.
4. The active experience is visually indicated in the Library list.
5. Loading and error states are handled gracefully.

## Open Questions

None — ready for planning.
