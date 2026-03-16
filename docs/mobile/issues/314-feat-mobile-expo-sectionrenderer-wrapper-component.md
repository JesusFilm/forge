---
artifactType: issue
issueNumber: 314
issueTitle: "feat(mobile-expo): SectionRenderer wrapper component"
issueUrl: "https://github.com/JesusFilm/forge/issues/314"
state: "CLOSED"
closedAt: "2026-03-11T00:46:03Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #314

## Background

The `Section` type is a wrapper that groups nested content with a background color and optional blur hash. It does not render its own visible content — instead it wraps child sections (via a nested `content` dynamic zone) and applies styling. The SectionDispatcher must already be functional with leaf renderers before this wrapper can render nested content.

## Expected outcome

- A `SectionRenderer` component that applies wrapper styling and recursively renders nested content via the SectionDispatcher.
- Accepts typed props from the data layer (Section model from #304).

## Acceptance criteria

- [ ] Applies `backgroundColor` styling: dark, default, light, primary (mapped to theme colors).
- [ ] Uses `blurHash` as a placeholder/background effect when present.
- [ ] Renders nested `content` array by calling the SectionDispatcher for each child item.
- [ ] Handles empty content array gracefully.
- [ ] Replaces the Section stub in SectionDispatcher.
- [ ] Does not break if nested content contains another Section or Container (recursive).

## Possible solution(s)

1. View with backgroundColor style derived from the enum value; children rendered by mapping content array through SectionDispatcher.
2. BlurHash rendered as background image using a blur hash library (e.g. `react-native-blurhash`) or skipped in v1.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold), leaf renderer sub-issues (so nested content can render)
- Schema: `ComponentSectionsSection` — backgroundColor (dark/default/light/primary), blurHash, sectionKey, content[] → `SectionContentDynamicZone` (line 1131)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
