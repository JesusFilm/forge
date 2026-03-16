---
artifactType: issue
issueNumber: 458
issueTitle: "fix(mobile-ios): CTA renderer visual parity with reference website"
issueUrl: "https://github.com/JesusFilm/forge/issues/458"
state: "CLOSED"
closedAt: "2026-03-13T04:37:39Z"
labels: ["fix", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #458

## Background

The CTA section renderer (`CTAView`) does not visually match the CTA component on the reference website ([jesusfilm.org/watch/easter](https://www.jesusfilm.org/watch/easter.html/english.html)). The current iOS implementation uses a plain light-gray system background (`systemGroupedBackground`) and default iOS `.borderedProminent`/`.bordered` button styles (blue tint), instead of a single gradient button with no section background.

**Key visual differences:**

| Aspect             | Reference website                                     | Current iOS `CTAView`                                       |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| Button             | Orange-red gradient fill, white text, rounded corners | System `.borderedProminent` / `.bordered` — iOS tinted blue |
| Section background | None (transparent)                                    | `systemGroupedBackground` (light gray), full-width          |

Parent: #100

## Expected outcome

`CTAView` renders a single button with an orange-to-red gradient background, white text, and rounded corners. The section itself has no background color (transparent).

## Acceptance criteria

- [x] CTA button uses an orange-to-red `LinearGradient` background instead of system `.borderedProminent`/`.bordered` styles
- [x] Button has white text, rounded corners, and appropriate padding
- [x] Section has no background color (remove `systemGroupedBackground`)
- [x] Primary and secondary variants retain distinct styling while using gradient approach
- [x] Heading and body text still render when provided by CMS
- [x] SwiftLint passes; VoiceOver accessibility preserved
- [x] Visual parity confirmed against reference: https://www.jesusfilm.org/watch/easter.html/english.html

## Possible solution(s)

1. Remove `.background(Color(.systemGroupedBackground))` from the section VStack
2. Replace `.buttonStyle(.borderedProminent)`/`.buttonStyle(.bordered)` with a custom gradient button using `LinearGradient` (orange → red)
3. Apply `.clipShape(Capsule())` or `RoundedRectangle` for rounded corners
4. Use `.foregroundStyle(.white)` on button text
5. Add horizontal padding and min-height for comfortable tap target

## References

- Parent: #100
- Current implementation: `mobile/ios/Sources/ForgeMobile/Views/Sections/CTAView.swift`
- Reference website: https://www.jesusfilm.org/watch/easter.html/english.html
- Related: #107 (original CTA renderer issue, PR #332)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
