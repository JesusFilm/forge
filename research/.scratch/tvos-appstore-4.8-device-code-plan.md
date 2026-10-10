# Plan: tvOS App Store precedent for QR/device-code-only sign-in (Guideline 4.8)

## Restated topic

Jesus Film TV app (tvOS + Android TV) is implementing RFC 8628 device authorization
(QR code + 8-char code, no in-app third-party login buttons, no webview). Need to
find real-world precedent: do major tvOS streaming apps use this pattern? Do any
ALSO offer native "Sign in with Apple" on the TV itself? Are there documented
App Store rejections under Guideline 4.8 for apps whose only third-party login
was an out-of-app device-code/QR flow? What do Apple forums/DTS say about whether
4.8 applies when auth happens on another device?

## Search angles

1. YouTube tvOS activation code sign-in flow
2. Disney+ Apple TV activation code / QR sign-in
3. Spotify Apple TV device code sign-in
4. Twitch Apple TV activation code
5. Prime Video Apple TV sign-in code
6. HBO Max / Max Apple TV activation
7. Plex Apple TV sign-in code
8. Crunchyroll Apple TV sign-in
9. Apple App Review Guideline 4.8 official text (Sign in with Apple requirement + exemption)
10. Apple Developer Forums Guideline 4.8 rejection tvOS
11. App Store rejection "4.8" device code / magic link / companion app sign in
12. Stack Overflow / HN rejection Sign in with Apple tvOS
13. Apple DTS "Sign in with Apple" required device authorization grant
14. "Sign in with Apple" tvOS exemption "sign in exclusively"
15. Small indie tvOS app rejected 4.8 QR code

## Languages

English only (Apple policy, US developer forums/blogs).

## Source types priority

1. Apple's own official Guideline 4.8 text (developer.apple.com)
2. Apple Developer Forums threads (official Apple domain, DTS engineers reply)
3. Documented rejection blog posts/case studies from indie devs (dated, specific)
4. News/analysis of Sign in with Apple mandate for tvOS
5. Screenshots/descriptions of major apps' actual sign-in UX on Apple TV (support docs, help articles from Google/Disney/Spotify/etc, or credible reviews/tutorials)

## Output

Medium report (~1200-1800 words), structured with:

- TL;DR
- Background on Guideline 4.8
- Table of major apps' actual tvOS sign-in method + whether Sign in with Apple appears
- Rejection cases section with concrete URLs/dates
- Forum/DTS guidance section
- Where sources disagree
- Limitations
- Recommendation for Jesus Film TV app
