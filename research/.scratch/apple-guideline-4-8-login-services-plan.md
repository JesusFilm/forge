# Plan: Apple App Store Review Guideline 4.8 (Login Services) — current text 2025-2026

## Restated topic

Determine the exact, current (2025-2026) text and requirements of App Store Review
Guideline 4.8 ("Login Services") from Apple's official guidelines page, plus Apple's
official Sign in with Apple / "offering login services" developer documentation.
Need to establish: trigger condition, equivalent-option privacy criteria, official
exceptions, platform scope (does it apply to tvOS?), and whether it addresses WHERE
login UI is presented (in-app vs. companion device/out-of-band web page such as an
RFC 8628 device-authorization flow). This directly informs whether the Jesus Film TV
app's device-code + QR + web-approval sign-in flow (no third-party buttons or webview
in the TV binary) is compliant.

## Search angles

1. "App Store Review Guideline 4.8" exact wording 2026
2. developer.apple.com App Store Review Guidelines site:developer.apple.com
3. Sign in with Apple developer documentation "offering login services"
4. Guideline 4.8 exceptions "education" "enterprise" "government" apps
5. Sign in with Apple "equivalent privacy" criteria list (data minimization, etc.)
6. Guideline 4.8 tvOS / Apple TV third-party login requirement
7. Sign in with Apple requirement change 2022 "no longer required" equivalent option
8. Apple TV app QR code device login sign in with Apple requirement (community/dev forum context, lower weight)
9. App Store Review Guidelines 4.8 "third-party client" exception
10. Human Interface Guidelines / developer docs on device authorization / TV sign-in flow (tvOS specific Apple guidance if any)

## Languages

English only (Apple official docs are English; this is a US/global developer policy topic).

## Source priority

1. developer.apple.com official guidelines page (primary, authoritative)
2. developer.apple.com Sign in with Apple documentation pages (primary)
3. Apple Developer Forums / official Apple statements (if relevant, lower tier but still Apple)
4. Reputable dev-community analysis (MacRumbles, 9to5mac, indie dev blogs) — only for context/history, not for the authoritative text itself; must corroborate against Apple's own text.

## Output

- Not a saved report file for this task per instructions (structured output only).
- Precise quotes with URLs, confidence levels, and explicit "not found" markers for
  anything the guidelines don't address (e.g., tvOS-specific carve-outs, out-of-band
  device flow language) — do not speculate beyond sources.
