# Plan: Verify RFC 8628 device auth as TV sign-in baseline (2026)

## Restated topic

Adversarially test whether RFC 8628 device authorization grant (QR + user code,
approve-on-phone) is still the correct industry-standard baseline for TV app
sign-in in 2026 (Apple TV + Android TV), vs alternatives: native platform sign-in,
passkey hybrid/cross-device flows, in-app browser flows.

## Search angles

1. Microsoft Entra device code flow phishing restrictions 2025 2026
2. IETF OAuth Cross-Device Flow Security BCP / draft-ietf-oauth-cross-device-security
3. RFC 8628 device authorization grant security best practices 2025
4. Okta Auth0 device authorization grant guidance 2025 2026
5. Google Android TV sign-in Credential Manager 2025 2026
6. Apple tvOS sign in with Apple / AccountAuthentication framework 2025 2026
7. Passkey hybrid transport cross-device QR sign-in TV 2025 2026 FIDO
8. device code phishing attack Storm-2372 real-world
9. TV app sign-in best practice 2026 streaming apps
10. FIDO Alliance TV passkey QR sign-in
11. OAuth device flow rate limiting entropy user code best practice
12. Netflix Disney+ TV sign-in flow QR code review

## Source types

- IETF drafts/RFCs (primary)
- Microsoft security blog / Entra docs (vendor primary)
- Okta/Auth0 developer docs & blog
- Google Android developer docs
- Apple developer docs
- FIDO Alliance
- Security researcher reports (Volexity, Microsoft MSTIC on Storm-2372)

## Output

Adversarial verification report via StructuredOutput - refuted true/false,
reasoning, nuances, counterEvidence with sources. No file report needed per
instructions (structured output only), but keep this scratch plan for process.
