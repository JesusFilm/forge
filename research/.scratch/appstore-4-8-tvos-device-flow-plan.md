# Plan: Adversarial verification of App Store 4.8 applicability to tvOS device-flow QR sign-in

## Restated topic

Verify/refute the claim that a tvOS app using RFC 8628 device authorization (QR code + user code,
third-party buttons living on a companion web page, not in the tvOS binary) is exempt from Apple's
App Store Guideline 4.8 Sign in with Apple requirement, and that the web page's Sign in with Apple
option satisfies the "equivalent option" obligation.

## Search angles

1. Exact current text of App Store Review Guideline 4.8 (Sign in with Apple)
2. Whether 4.8 explicitly addresses tvOS / limited-input-device apps
3. App Store rejections citing 4.8 for QR-code-only / device-code login apps
4. Apple Developer Forums threads on Sign in with Apple + tvOS / device flow
5. Netflix/Hulu/Disney+/other tvOS apps precedent - do they show login buttons on TV or just device code?
6. Guideline 2.5.6 (native APIs) interplay and any recent revisions 2024-2026
7. Apple's own "Sign in with Apple for TV device flow" docs/WWDC sessions
8. App Review Board appeal outcomes concerning 4.8
9. Whether "equivalent option" must be IN the app per Apple guidance (developer relations quotes)
10. Any 2025/2026 changelog to guideline 4.8 tightening or loosening

## Languages

English only (Apple guidelines are English; no Thai relevance).

## Source priority

1. Apple's official App Store Review Guidelines page (primary)
2. Apple Developer documentation / HIG for Sign in with Apple + device flow
3. Apple Developer Forums (developer.apple.com/forums) official Apple engineer replies
4. Established tech press covering App Store rejections (9to5Mac, TechCrunch, MacRumors)
5. Stack Overflow / community only as corroboration, not primary evidence
6. Skip SEO farms

## Output

Structured verdict via StructuredOutput tool - refuted true/false, reasoning, nuances, counterEvidence.
No report file needed for this adversarial-verification task type (per instructions, no report .md).
