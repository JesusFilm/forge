---
artifactType: plan
sourceIssueNumber: 458
sourceIssueTitle: "fix(mobile-ios): CTA renderer visual parity with reference website"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/458"
linkedPrs: []
---

# Plan Artifact: #458

## Objective

`CTAView` renders a single button with an orange-to-red gradient background, white text, and rounded corners. The section itself has no background color (transparent).

## Planned approach

1. Remove `.background(Color(.systemGroupedBackground))` from the section VStack
2. Replace `.buttonStyle(.borderedProminent)`/`.buttonStyle(.bordered)` with a custom gradient button using `LinearGradient` (orange → red)
3. Apply `.clipShape(Capsule())` or `RoundedRectangle` for rounded corners
4. Use `.foregroundStyle(.white)` on button text
5. Add horizontal padding and min-height for comfortable tap target

## Validation

- [x] CTA button uses an orange-to-red `LinearGradient` background instead of system `.borderedProminent`/`.bordered` styles
- [x] Button has white text, rounded corners, and appropriate padding
- [x] Section has no background color (remove `systemGroupedBackground`)
- [x] Primary and secondary variants retain distinct styling while using gradient approach
- [x] Heading and body text still render when provided by CMS
- [x] SwiftLint passes; VoiceOver accessibility preserved
- [x] Visual parity confirmed against reference: https://www.jesusfilm.org/watch/easter.html/english.html

## Source links

- Issue: [#458](https://github.com/JesusFilm/forge/issues/458)
- PRs:
- None
