# Plan: RFC 8628 Device Authorization for TV Sign-In — 2025-2026 Status

## Topic restated

Is the OAuth 2.0 Device Authorization Grant (RFC 8628) — QR code + 8-char user code flow —
still the recommended/industry-standard approach for TV app sign-in in 2025-2026? What hardening
does the IETF OAuth Security BCP (RFC 9700) require? What do major identity vendors recommend?
Are FIDO2/passkey cross-device (hybrid/CTAP2.2) flows a viable replacement or complement?
Any notable phishing incidents/deprecations affecting device-code flow?
Context: Jesus Film TV app (tvOS + Android TV), auth.jesusfilm.org better-auth OIDC provider,
QR + 8-char code, no web view, no third-party buttons on TV itself.

## Search angles

1. RFC 8628 device authorization grant 2025 2026 status / still recommended
2. RFC 9700 OAuth Security Best Current Practice device authorization requirements
3. IETF Cross-Device Flows Security Best Current Practice draft (draft-ietf-oauth-cross-device-security)
4. Device code phishing attacks 2024 2025 (Storm-2372 / Microsoft threat intel)
5. Auth0 device authorization flow TV best practices 2025
6. AWS Cognito device grant TV app guidance
7. Google Identity Services TV device flow / Android TV sign-in
8. Microsoft Entra ID device code flow warning restrict
9. FIDO2 passkey hybrid transport CTAP2.2 QR cross-device sign-in TV
10. Apple tvOS sign in with Apple / passkey TV limitations
11. Android TV Credential Manager passkey
12. User code entropy rate limiting best practice device flow
13. verification_uri_complete QR code phishing remote consent

## Languages

English only (this is an IETF/vendor technical topic, no Thai angle).

## Source priority

1. IETF RFCs/drafts (datatracker.ietf.org) — RFC 8628, RFC 9700, cross-device-security draft
2. Vendor official docs (Auth0/Okta, AWS, Google, Microsoft) 2025-2026
3. Security research/threat intel (Microsoft MSTIC, Okta security blog, Volexity) on device code phishing
4. FIDO Alliance official specs/blog on hybrid transport
5. Apple/Google official TV platform docs
6. Skip SEO content farms

## Output

Technical assessment report, ~1200-1800 words, for internal engineering use (feeds into TV auth
implementation decision). Structured findings + recommendation on whether QR+code device auth
remains right baseline for this app, with hardening checklist.
