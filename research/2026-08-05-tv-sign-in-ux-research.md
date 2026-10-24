# TV Sign-In UX and Protocol Research — Forge TV (feat-322)

**Date:** 2026-08-05
**Scope:** How TV apps should do sign-in in 2026, what each platform requires, and what feat-322 must change.
**Ticket:** `docs/roadmap/platform/feat-322-tv-auth-sign-in-profile.md`
**Method:** External research (platform HIGs, developer docs, RFCs, store policy, first-hand SDK/header inspection). Every substantive claim is cited. Claims that could not be verified are marked **UNVERIFIED**.

---

## 1. Recommendation

**The core bet in feat-322 is correct and should not be reopened.** RFC 8628 device authorization against our own IdP, with a QR plus a human-readable code shown on the TV, is the right primary flow for Apple TV, Android TV/Google TV, and every HTML5 smart-TV platform we might add later. Google and Amazon publish this exact pattern as their own recommended TV sign-in mechanism ([Google](https://developers.google.com/identity/protocols/oauth2/limited-input-device), [Amazon CBL](https://developer.amazon.com/docs/login-with-amazon/other-platforms-cbl-docs.html)), and Apple's tvOS HIG independently endorses the same user-experience shape.

What the research changes is **not the mechanism but the scope**. Five things are missing from the ticket, four of which are cheap and one of which is a hard store requirement.

### Build order

**Phase 0 — settle before any code (1 day, needs the feat-121 owner)**

0.1 **Route A vs B.** Nothing in Apple's or Google's guidance constrains this choice. The security research does: route A's translation endpoint is a _second_ place where `client_id` and `scope` can drift away from what was bound at device-code issuance, and that exact drift was a real universal-account-takeover bug in Google's own IdP, fixed 2026-03-28 ([disclosure](https://weirdmachine64.github.io/research/google-oauth-device-code-hijacking.html)). **Prefer route B** (device grant inside the oauth-provider layer) if `@better-auth/oauth-provider` has grown one or the upstream shape is small. If route A wins on effort, the translation step must re-validate `client_id` and `scope` against what was persisted at issuance, and that must be a named test.
0.2 **Route C is dead** — see §3.1 for the corrected reason. Strike it from the ticket rather than leaving it as "only viable if Apple TV is dropped from scope"; Android TV has the same problem.
0.3 **Decide the user-code charset** (§4.1) and the **verification URL** (§4.2). The URL is an infrastructure decision with a lead time, not a code change.
0.4 **Write down the single-account-per-TV decision** (§6.4). It determines the secure-store layout and is expensive to retrofit.

**Phase 1 — the shippable v1 (this is feat-322)**

1. **Device grant on `auth.jesusfilm.org`**, hard-restricted to the `tv` client via `validateClient`, with `client_id` + `scope` bound to the `device_code` at issuance and re-validated at approval. Never `admin`, `manager`, `mastra-studio`, or `admin-mcp`.
2. **A short, memorable verification URL** — `jesusfilm.org/tv` 302 → the better-auth device endpoint. Every major service uses a 12–22 character vanity path; `auth.jesusfilm.org/device` is longer than all of them and leaks an infrastructure hostname to end users.
3. **A hardened approval page**: names the app and the device, re-displays the user code for the human to compare, makes Deny at least as prominent as Approve, caps attempts at ~5 per code, accepts lowercase/separators/paste, is localized and screen-reader friendly.
4. **TV-side polling** wired to the real endpoints with RFC 8628 §3.5 semantics encoded as pure testable functions, `expo-secure-store` persistence, **write-before-discard** refresh, and **single-flight** refresh.
5. **In-app account deletion.** This is App Store guideline 5.1.1(v) and Google Play policy. It is currently absent from the ticket and is the single most likely review rejection for this feature.
6. **Sign-out on the Profile screen + server-side "sign out all TVs"** in the web profile. This is the entire recovery story for a phished or abandoned grant, and it is cheap once the grant exists.
7. **Anonymous → account merge** for `viewer-id`, one-time and idempotent (§6.2).

**Phase 2 — explicitly deferred, write them down as deferred so they don't creep in**

Sign in with Apple (tvOS 13+), the tvOS 15 nearby-iPhone password handoff, passkeys / FIDO cross-device (tvOS 16+, Android TV since July 2026), Android Credential Manager, Cast Connect `setAtvCredentials`, Engage SDK Watch clusters, DPoP sender-constrained tokens, Roku.

**Phase 3 — eliminated, do not investigate**

Apple TV Provider SSO and the tvOS 26 Automatic Sign-In API are both gated behind Apple-granted MVPD / media-subscription entitlements a free ministry app has no basis to receive ([entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.video-subscriber-single-sign-on), [Automatic Sign-In](https://developer.apple.com/documentation/videosubscriberaccount/signing-people-in-to-media-apps-automatically)). CIBA is ranked above the device grant by the IETF BCP but requires the TV to obtain a user identifier — i.e. typing an email on a D-pad — which the ticket already rules out ([BCP §6.2.2.5](https://www.ietf.org/archive/id/draft-ietf-oauth-cross-device-security-16.txt)). Record all three as considered-and-rejected so nobody re-derives them.

### Why this order

The device flow is the only mechanism that works on every platform we ship to now and every platform we might ship to later, from one backend. **The reusable asset is the verification web page and the RFC 8628 endpoints, not the TV UI** — design them platform-agnostically and a future Tizen/webOS/VIDAA build is a UI project, not an auth project. Every platform-native accelerator (SIWA, passkeys, Credential Manager, Cast) is an N+1 integration with its own SDK, token model, and backend work, and none of them replaces the device flow. Android TV's passkey support shipped in Google Play services v26.28 on 2026-07-20 — roughly two weeks ago — and Google's own developer docs still do not list TV as a Credential Manager form factor ([release notes coverage](https://9to5google.com/2026/07/27/july-2026-google-system-updates/), [form-factor guide](https://developer.android.com/identity/form-factors)). Treating any of these as v1 scope would be a sequencing error.

---

## 2. How the big services actually do it

| Service                                             | Primary TV flow                                                    | Code format                                           | QR?                       | Notable detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **YouTube**                                         | Code + `yt.be/activate`, or QR                                     | short code                                            | Yes                       | The closest analog to Forge TV: fully usable signed out, sign-in is an optional personalization upgrade. Frames the choice as "Sign in with your phone" vs "Sign in with your remote", with an explicit "If one of these options isn't working for you, try the other one" fallback line. [src](https://support.google.com/youtube/answer/3015415?hl=en)                                                                                                                                |
| **Netflix**                                         | Three paths: QR, `netflix.com/tv2` (`/atv` on Apple TV), or remote | **8 digits, numeric** (`<input type="tel">`, 8 boxes) | Yes                       | `netflix.com/tv2` **is** a code-entry page — headline "Match the code on your TV", subhead "Confirm or enter the code below". The QR path is codeless only because the QR carries the code. The remote path branches into "Send Sign-In Link" (passwordless email, **not available on all TVs**) or "Use Password Instead". Secondary profiles have their own email identity and _cannot_ use a password — link only. [src](https://help.netflix.com/en/node/311830241325668)           |
| **Apple TV app** (on non-Apple TVs)                 | QR, or code at `link.apple.com`                                    | short code                                            | Yes                       | Apple runs the QR + short-code pattern itself across Roku, Fire TV, Android TV, Google TV, Samsung, LG, Sony, Panasonic, VIZIO, Hisense, VIDAA. Dedicated subdomain, no path. Strongest precedent that App Review will not object to the pattern. [src](https://support.apple.com/en-us/102472)                                                                                                                                                                                         |
| **Google (reference device flow)**                  | Code at `google.com/device`                                        | `GQVQ-JKEC` — 8 alnum + hyphen, case-sensitive        | Not documented, but works | Response fields are `device_code`, `user_code`, `verification_url` (non-standard spelling), `expires_in` 1800, `interval` 5. **No `verification_uri_complete`.** But `google.com/device?user_code=XXXX-XXXX` 302s to a pre-filled "Match the code on your TV" confirm page — the capability exists, the contract does not. Requires `client_secret` in the device binary; scopes hard-limited to 7. [src](https://developers.google.com/identity/protocols/oauth2/limited-input-device) |
| **Amazon Prime Video**                              | Code at `amazon.com/code` / `primevideo.com/mytv`                  | 5–6 chars                                             | Yes (some devices)        | Login with Amazon CBL: `POST /auth/o2/create/codepair` with `response_type=device_code`, redeem at `/auth/o2/token` with `grant_type=device_code`, RFC 8628 polling with `authorization_pending` / `slow_down`. [src](https://developer.amazon.com/docs/login-with-amazon/other-platforms-cbl-docs.html)                                                                                                                                                                                |
| **Max**                                             | 6-digit code at `max.com/signin` / `hbomax.com/signin`             | 6 digits                                              | UNVERIFIED                | Naming hazard: Max _also_ uses a separate 6-digit emailed OTP ("Time Sensitive: Your One-Time HBO Max Code"). Two different 6-digit codes in one product. [src](https://help.hbomax.com/us-en/Answer/Detail/000002552)                                                                                                                                                                                                                                                                  |
| **Plex**                                            | 4-character code at `plex.tv/link`                                 | 4 chars                                               | No                        | "This allows you to connect to your account without having to laboriously enter login credentials via an on-screen keyboard." **Forced to remove this on Roku** — see §3.3. [src](https://support.plex.tv/articles/203395277-connect-app-to-your-plex-account/)                                                                                                                                                                                                                         |
| **PBS**                                             | 7-char alphanumeric at `PBS.org/tv`                                | 7 alnum                                               | UNVERIFIED                | One code endpoint across Roku, Apple TV, Fire TV, smart TVs. Web page offers PBS account / Google / Facebook / Apple — the Apple option is what satisfies App Store guideline 4.8 (§3.1). [src](https://help.pbs.org/support/solutions/articles/5000668088-how-do-i-activate-the-pbs-app-)                                                                                                                                                                                              |
| **Crunchyroll**                                     | 6-char code at `crunchyroll.com/activate`                          | 6 chars                                               | Yes                       | Single code endpoint plus a QR variant. [src](https://help.crunchyroll.com/hc/en-us/articles/24488824632724-QR-Code-Sign-in)                                                                                                                                                                                                                                                                                                                                                            |
| **Uscreen** (white-label, many TV stores)           | "Easy Sign-In": code + `site.com/connect`                          | case-**insensitive**                                  | UNVERIFIED                | One flow across Roku, Android TV, Fire TV, Apple TV, Samsung. Their Roku claim conflicts with Roku's published rules — likely private/non-certified channels. [src](https://help.uscreen.tv/en/articles/7974466-tv-app-easy-sign-in)                                                                                                                                                                                                                                                    |
| **Disney+ / Hulu / Peacock / Paramount+ / Spotify** | Code + vanity URL                                                  | 6–8, varies                                           | Mixed                     | **UNVERIFIED** — official pages were geo-blocked or JS-rendered. Paramount+ reportedly varies code length _per platform_ (6–8, plus a 7-digit Roku variant), producing user reports of a TV code that won't fit the web field. Cautionary tale for a multi-platform rollout.                                                                                                                                                                                                            |
| **Roku** (platform, not an app)                     | `roku.com/link`                                                    | link code                                             | No                        | **This is hardware activation, not app sign-in.** It binds a Roku device to a Roku account. It is not callable by apps. Do not model our flow on it. [src](https://support.roku.com/article/activate-your-streaming-device)                                                                                                                                                                                                                                                             |

**Three patterns worth stealing.** (a) Activation URLs are aggressively short vanity paths — `yt.be/activate` is 15 characters, `link.apple.com` is 14. (b) The visual hierarchy is consistent everywhere: QR first and largest, short URL second, code third, remote-typed last. (c) Every service treats forced re-authentication as a defect — Netflix publishes a troubleshooting article titled "Netflix asks for sign-in every time it's opened" ([src](https://help.netflix.com/en/node/1894)).

**One pattern to reject.** Netflix, Disney+, Max, Hulu, Peacock, Paramount+, Prime Video and Apple TV+ all gate content behind sign-in, so their device flow is a mandatory first-run wall against a captive, motivated user. Forge TV is free with no paywall. **Benchmark against YouTube, not Netflix.** For a gated service, activation drop-off is a lost subscriber. For us, a user who abandons sign-in just keeps watching anonymously — which means the flow must be interruptible and re-enterable, and its value must be _argued_ rather than assumed.

---

## 3. Per-platform requirements

### 3.1 Apple TV / tvOS

**What Apple's HIG actually says.** Retrieved 2026-08-05 from Apple's DocC data endpoint (`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/managing-accounts.json` — the HTML page is JS-rendered and returns only a `<title>` to naive fetchers, so anyone re-verifying must use the `.json` endpoint):

> "Ask people to create an account only if your core functionality requires it; otherwise, let people enjoy your app or game without one."
> "**Delay sign-in for as long as possible.** People often abandon apps when they're forced to sign in before they can do anything useful..."
> tvOS platform considerations: "Most people interact with Apple TV using a remote, not a keyboard, so ask for the minimum amount of information necessary." / "**Prefer letting people use another device to sign up or authenticate.** When you configure your app's associated domains, Apple TV can work with other devices to safely suggest sign-in credentials, including Sign in with Apple." / "**Minimize data entry.** If you need to gather more than a small amount of information, ask people to visit a website from another device."

**Correction to a common framing:** the page contains **zero** occurrences of "QR", and never mentions a user code, a pairing code, RFC 8628, or the device authorization grant. The one _mechanism_ it names for the another-device bullet is associated-domain credential AutoFill plus Sign in with Apple — not a device-code flow. So cite this page as **Apple prescribing minimum data entry and another-device authentication, which the device grant implements** — not as Apple prescribing the device grant. That weaker claim is still a solid argument, and it is defensible under challenge. ([HIG](https://developer.apple.com/design/human-interface-guidelines/managing-accounts))

**Guideline 5.1.1(v) — in-app account deletion. HARD REQUIREMENT, currently missing from feat-322.**

> "If your app doesn't include significant account-based features, let people use it without a login. **If your app supports account creation, you must also offer account deletion within the app.**"

The trigger is _supports_, not _requires_, so optional accounts are in scope. Apple's implementation page: "Starting June 30, 2022, apps submitted to the App Store that support account creation must also let users initiate deletion of their account within the app." Apple's FAQ closes the obvious escape hatches: "If my app links out to the default web browser for account creation, does it still need to offer account deletion within the app? **Yes.**" and "My app automatically creates an account for the user. Do I need to include an option to initiate account deletion? **Yes.**" Two more constraints that bind us: apps not in highly regulated industries "should not require people to make a phone call, send an email, or go through other support flows", and "All users should be allowed to delete their accounts, regardless of where they're located" — so an email-support path or a GDPR-only path is non-compliant. Manual/delayed deletion is acceptable if the user is told how long it takes and gets a confirmation. ([guidelines](https://developer.apple.com/app-store/review/guidelines/), last updated 2026-06-08; [implementation](https://developer.apple.com/support/offering-account-deletion-in-your-app/))

_Citation caveat:_ the frequently-quoted tvOS recipe — "display the URL on screen, display a QR code that includes the URL, or provide a button that emails the URL" — is from the **retired** legacy tvOS HIG Accounts page (archived 2022-05-28), which now 302s to `/managing-accounts`. The current HIG says only "you must provide a direct link to the webpage on which people can do so. Make the link easy to discover." So treat QR-handoff as a **proven-acceptable design pattern, not a citable current rule** — and confirm Apple accepts it rather than assuming.

**Guideline 4.8 — Sign in with Apple is NOT mandatory for us.** 4.8 fires only when "a third-party or social login service ... set[s] up or authenticate[s] the user's primary account", and it carves out "Your app exclusively uses your company's own account setup and sign-in systems." `auth.jesusfilm.org` is our own system. **Treat any "we must add Sign in with Apple" assertion as unfounded.** The live risk is indirect: if the phone-side approval page renders a "Continue with Google" or "Continue with Facebook" button, a third-party service is setting up the primary account the TV then authenticates as, and 4.8 plausibly attaches. **That page is owned by feat-121, not the TV team — the coupling is invisible from both sides, so write it into the ticket's Constraints.** ([guidelines](https://developer.apple.com/app-store/review/guidelines/))

**Route C is dead — with a corrected reason.** The ticket says "no WebKit on tvOS, so browser-redirect PKCE is impossible". The availability facts are more nuanced and someone will challenge the claim as written:

- `ASWebAuthenticationSession` carries a genuine, deliberately maintained `tvos(16.0)` annotation — verified directly in `AppleTVOS26.5.sdk/.../ASWebAuthenticationSession.h`. Apple has kept extending the tvOS surface (`init(url:callback:completionHandler:)` and `additionalHeaderFields` are `tvos(17.4)`). It is not an annotation accident.
- But `presentationContextProvider`, its protocol, `cancel()`, and `prefersEphemeralWebBrowserSession` are all `API_UNAVAILABLE(tvos)`. `WKWebView` and `SFSafariViewController` are absent from the tvOS SDK entirely.
- **Empirically inert.** A minimal tvOS app built against the tvOS 26.5 SDK and run on a tvOS 26.5 simulator (2026-08-05): the class resolves, instantiates, and stores its properties — then `canStart` is `false` and `start()` returns `false`, even with a presentation context attached via the ObjC runtime. No UI is presented; the completion handler never fires. Byte-identical code on the iOS 26.5 simulator presents the real system sheet, ruling out "simulators can't do this". **UNVERIFIED on physical Apple TV hardware.**
- The OpenID Foundation's AppAuth-iOS routes tvOS to the device grant: "For tvOS, AppAuth implements OAuth 2.0 Device Authorization Grant to allow for tvOS sign-ins through a secondary device." ([src](https://github.com/openid/AppAuth-iOS))

**Rewrite the ticket's Problem section to:** _"`ASWebAuthenticationSession` is nominally tvOS 16.0+ but does not start on tvOS; there is no third-party web renderer in the tvOS SDK; and even a working web view would put an email+password form on a D-pad, which the HIG explicitly tells you not to do."_ The conclusion survives; the justification must change.

**Text entry on the Siri Remote is worse than the ticket says.** Apple's user guide: navigate to a character then select it, one at a time; "Press the Play/Pause button one or more times to switch between lowercase, uppercase, and special symbol keyboards"; press-and-hold for accents. So a mixed-case password with symbols requires repeated mode switches _plus_ per-character D-pad navigation — and the documented alternative, Siri dictation, means saying your password aloud in a living room. **Fix the ticket's "TV's keyboard is letters-only" line** — it is imprecise and a reviewer could use the imprecision to argue a password field is acceptable. The accurate framing is stronger. ([src](https://support.apple.com/guide/tv/enter-text-atvb2ae48ba6/tvos))

**Native tvOS accelerators that exist today** (all Phase 2, none replaces the device flow):

| API                                                                | tvOS since | Why it's deferred                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in with Apple (`ASAuthorizationAppleIDProvider`)              | 13.0       | Highest conversion (two clicks, zero typing) but it makes Apple an upstream IdP better-auth must federate, adds account linking across private-relay emails vs web sign-ups, and adds a token-revocation obligation on deletion. Separate ticket. **Do not let anyone justify it as 4.8 compliance.**                                  |
| Nearby-iPhone password handoff (`ASAuthorizationPasswordProvider`) | 15.0       | Returns an `ASPasswordCredential` (username + password), which needs a resource-owner-password-style exchange `@better-auth/oauth-provider` does not expose. Also requires the user to _already_ have a `jesusfilm.org` credential in iCloud Keychain — near-zero installed base at TV launch. Value grows as web sign-ups accumulate. |
| Passkeys (`ASAuthorizationPlatformPublicKeyCredentialProvider`)    | 16.0       | Strictly more IdP work than the device flow for the same QR-on-screen UX. External security keys are `API_UNAVAILABLE(tvos)`.                                                                                                                                                                                                          |

**Worth doing early and cheaply:** the Associated Domains `webcredentials:` entry plus the `apple-app-site-association` file. No user-visible change on its own, but it is the prerequisite for both the password handoff _and_ passkeys.

**Architectural steer (Phase 2, cheap now, expensive later):** WWDC21 session 10279 prescribes composing sign-in options into one system sheet — `ASAuthorizationController` with `customAuthorizationMethods = [.other]` and a `didCompleteWithCustomMethod` delegate callback. Putting the QR/device-code flow behind that from the start makes it the platform-native entry point and leaves empty slots for SIWA and the password handoff without redesigning the screen. Cost is one native module (react-native-tvos has no binding). On Android TV the module is absent and the QR screen is reached directly — compatible with the ticket's "QR on both platforms" constraint. ([WWDC21 10279](https://developer.apple.com/videos/play/wwdc2021/10279/))

**Shipping gate.** Since 2026-04-28: "Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26, iPadOS 26, tvOS 26, visionOS 26, or watchOS 26." Building against the tvOS 26 SDK does not change the deployment target, so older Apple TVs stay supported. **Check the `/build-tv` toolchain and CI before submission** — this intersects the known Datadog tvOS pnpm patch hazard (version-pinned, pnpm only _warns_ on a stale patch key, and an Xcode bump has previously required a DerivedData clear plus a `pod install` re-run). ([src](https://developer.apple.com/news/upcoming-requirements/))

**tvOS multi-user is real and collides with a one-account-per-TV assumption.** `TVUserManager` (tvOS 13+, `com.apple.developer.user-management` entitlement) exists precisely for "a video content app that retains which shows they watch". `kSecUseUserIndependentKeychain` (tvOS 16+) stores a keychain item "your app can access even when a different user is active". The HIG: "In tvOS 16 and later, your app can share its credentials with all users while storing each individual's profile and user data separately... avoid asking them to choose their profile every time they become the current user." See §6.4.

### 3.2 Android TV / Google TV / Chromecast with Google TV

**Google's TV app quality bar names phone-handoff as a blessed login mode.** Tier 2 ("TV Optimized") criteria, page last updated 2026-06-29:

- **TV-LI:** "Users are able to login using mobile or Google Account for seamless login."
- **TV-LC:** "The app securely stores user credentials or automatically logs in returning users through token-based authentication or secure storage methods. This significantly reduces friction for subsequent uses after the initial setup."

Note these are **Tier 2, aspirational** — they are not the mandatory bar. The only mandatory (Tier 3) sign-in criterion is **TV-G5**: "For apps requiring users to sign in, you must provide login credentials in the Google Play Console for testing of the full app experience" — and Forge TV does not _require_ sign-in, so TV-G5 does not strictly bind. **TV-DP** ("The app functionality is navigable using five-way D-pad controls") _is_ Tier 3 and mandatory. TV-LC is exactly the `expo-secure-store` + `offline_access` requirement already in the ticket. ([src](https://developer.android.com/develop/adaptive-apps/quality-guidelines/tv-app-quality))

**Browser-redirect PKCE is fragile on Android TV too.** Most Android TV / Google TV devices ship no system browser and no Custom Tabs provider. Android's own package-visibility guidance tells apps to expect this: "An `ActivityNotFoundException` occurs because there isn't an app installed on the device that can open the URL. It's recommended that your app catch and handle the `ActivityNotFoundException`" ([src](https://developer.android.com/training/package-visibility/use-cases)). AppAuth-Android explicitly does not support WebView (RFC 8252) and depends on a browser existing. Android TV's hardware doc also confirms **no camera is guaranteed** — the TV can never scan anything, so the QR must be rendered _by_ the TV and scanned by the user's phone, which is exactly the shipped `ProfileScreen` design. ([src](https://developer.android.com/training/tv/start/hardware))

**Google TV has already trained the exact gesture we depend on.** Google TV profiles are added "via QR code and signing into a Google Account", and Google TV setup _requires_ a phone: "Google streaming devices setup with a computer isn't supported. To set up your streaming device, use a mobile device." A Google TV household definitionally has a paired phone. This is the strongest UX argument available for the ticket's "QR on both platforms" constraint — on Google TV the QR is the house pattern, not a fallback. ([profiles](https://support.google.com/googletv/answer/10050564?hl=en), [setup](https://support.google.com/chromecast/answer/7022492?hl=en))

**Do not build native Google Sign-In on Android TV.** The legacy `GoogleSignInClient` is deprecated and Google announced its removal from `play-services-auth`. Its replacement, Credential Manager, does not list TV as a supported form factor in the developer docs ([form factors](https://developer.android.com/identity/form-factors), last updated 2026-02-26 — mobile/tablets/foldables, Wear OS, Android XR; TV absent). `@react-native-google-signin/google-signin`'s public tier still uses the legacy SDK on Android, and no community alternative documents react-native-tvos.

**Watch item, not a plan dependency:** Google Play services **v26.28**, released 2026-07-20, per Google's own System Services release notes: "Add TV support for the Android Credential Manager, making it easier to use saved passwords and passkeys, including the option to use your phone for passkey authentication." The platform capability shipped _ahead of_ the developer documentation, which still omits TV. Rollout completed ~2026-07-27. It will not be on the majority of the installed base for years, and it is irrelevant to tvOS, so the device flow remains the cross-platform floor either way — but note it, because a device-flow-only design may look dated within this ticket's lifetime. ([coverage](https://9to5google.com/2026/07/27/july-2026-google-system-updates/)) **UNVERIFIED:** first-party Android developer guidance on calling Credential Manager from a TV app, minimum Play services gating, and react-native-tvos availability.

**Play policy triggers.**

- **Account deletion:** Google Play requires that "if your app allows users to create an account from within your app," it must provide an in-app deletion path _and_ a web-accessible deletion URL that works "without reinstalling the app". Enforced since 2024. Cheapest compliant answer: make the TV flow **sign-in-only** (approval page shows an existing-account login; sign-up happens on web) and ensure `jesusfilm.org` already exposes the web deletion URL from feat-229. ([src](https://support.google.com/googleplay/android-developer/answer/13327111))
- **Review access:** Play requires credentials "accessible at all times, reusable, and valid regardless of user location", in English, with 2-Step verification bypassed — and explicitly accepts "QR codes or specific instructions for accessing restricted areas of your app". **The "regardless of user location" clause is a real risk if `auth.jesusfilm.org` sits behind Cloudflare WAF geo rules — verify the device-approval path is not geo-fenced before submission.** ([src](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en))

**Hardware headroom.** Chromecast with Google TV (4K, 2020): 2GB RAM, 8GB storage with ~5GB user-accessible. Chromecast with Google TV (HD, 2022): 1.5GB RAM, and slated to move off Google TV to plain Android TV 14. Google TV Streamer (2024): 4GB / 32GB. A second reason to reject the Play-Services-auth / Credential Manager / Cast SDK stack for v1 — each is APK weight and RAM on a device class with ~5GB usable storage. **And: never branch auth on the UI skin**, since "Google TV" and "Android TV" will keep diverging on the same hardware.

**Layout constraints.** Android TV design resolution is 960×540 dp at MDPI; safe-area margins are 48dp left/right and 27dp top/bottom. "Position all important elements within these margins to ensure visibility across different TV models and prevent overscan clipping." Google gives **no** guidance on QR sizing or contrast at 10-foot distance — a documentation gap we have to close empirically (§4.5). ([src](https://developer.android.com/design/ui/tv/guides/styles/layouts))

**Cast Connect** (`MediaLoadRequestData.setAtvCredentials` + a receiver-side `LaunchRequestChecker`) is a genuine future accelerator — `apps/mobile` could cast a video and hand the TV a signed session in one gesture. But "The `CredentialsData` is only passed to your Android TV app during launch or join time", it works only from _our own_ sender app, only on Android TV, and needs a Cast receiver plus a $5 non-refundable console registration. It can never be the primary path because it excludes everyone without `apps/mobile`. Park it. ([src](https://developers.google.com/cast/docs/android_tv_receiver/core_features))

**Two things that are NOT sign-in and will be confused with it.** (a) **Google Account Linking** (OAuth Linking / App Flip / Streamlined Linking) connects a user's _Google_ account to their account on our platform so Google surfaces can act on their behalf. It is partner-gated ("We'll need details of your OAuth 2.0 setup and to share credentials to enable account linking") and its only payoff for a free app is voice casting. **Keep it out of feat-322 entirely.** ([src](https://developers.google.com/identity/account-linking)) (b) **Engage SDK Watch** — _not_ account linking — is the self-serve route to putting Forge watch-history on the Google TV home screen via the Continuation cluster (max 20 entities, "<50 KB compressed", ~"a week of developer time"). This is the actual downstream reason accounts are worth building. Follow-up ticket. TV _entitlements_ is partner-gated and irrelevant to a free app. ([src](https://developer.android.com/guide/playcore/engage/watch))

**Scale context:** ~300M active Google TV/Android TV devices as of I/O 2026, up from 270M in 2025 — roughly 11% growth, a marked slowdown. Android TV is the larger reach half of our fleet, so it deserves at least equal design attention to tvOS; the flattening curve argues against betting on future Google-proprietary TV auth features. ([src](https://9to5google.com/2026/05/21/google-tv-hits-300-million-active-devices-as-growth-stalls/))

### 3.3 Roku — the one platform where "one device flow everywhere" breaks

Roku calls the device-code pattern **"rendezvous linking"** and restricts it: "Only TVE apps may use rendezvous linking to authenticate Roku customers. A TVE app is defined as an app that is accessed with credentials from a cable/satellite subscription." Certification criterion 2.2: "Sign-up/sign-in workflows are prohibited from using external webpages, links to off-device promotional or marketing materials, or any other 1st or 3rd-party off-device sign-up/sign-in/authentication/activation mechanism." And: "All apps, except TVE apps, must complete authentication entirely on-device to pass certification." (`authentication-and-linking.md` last updated 2026-05-08; `certification.md` April 2026.)

This is not theoretical — **Plex was forced to remove its `plex.tv/link` 4-character code login from Roku**, with a Plex spokesperson calling it "a bit of a step backward for the end user... it could lead to users choosing simpler, less secure passwords." ([src](https://www.lowpass.cc/p/roku-rendezvous-linking-app-login-restrictions))

**Correction to a widely-repeated exemption.** A Roku Partner Knowledge Center article does say "As long as the AVOD channel in question doesn't also offer a subscription option ... your channel is not required to include on-device authentication." The quote is genuine and the article is still live — but it was created **2020-12-21 and never revised in 5.6 years**, it predates Roku's 2021 certification overhaul, and **no current binding Roku doc repeats it**. Its sibling article on the same topic _was_ revised in 2021; this one was left.

**The accurate 2026 rule is conditioned on "includes authentication", not on business model.** Roku's current docs: "Apps that include authentication must complete account sign-ups and sign-ins on the device using on-device authentication to pass certification." Forge TV is free but **does** offer optional sign-in — so it is squarely "an app that includes authentication", criterion 2.2 binds, and **our RFC 8628 flow is prohibited on Roku**. Even reading the 2020 article at face value doesn't help: it says you need not _include_ on-device auth, never that you may use _off-device_ auth.

**So Roku is not a zero-extra-code target if sign-in ships.** It requires a separate BrightScript build with `StandardKeyboardDialog` credential entry plus a **mandatory** RFI (Request For Information) screen: "The RFI screen must be displayed during the on-device sign-in flow to enable customers to share the email address and/or phone number in their Roku customer account with apps." Recommendation: **launch Roku sign-out-only, or budget a Roku-specific auth build.**

Automatic Account Link (AAL) is likely out of scope on two grounds — it applies to "Apps requiring a user account to log in that have streamed more than average of 1 million hours per month over the last three months (**and new Apps expected to reach the threshold shortly after launch**)", and our sign-in is optional. Note that parenthetical: a large launch can be in scope on day one.

**UNVERIFIED:** the commonly cited "effective for AVOD channels after September 30, 2021" date — it surfaced only in a search summary of Roku's April 2021 developer blog, and that page is JS-rendered and returned no body text.

**Global priority ordering makes this a small problem for us.** Worldwide in 2026: Android TV / Google TV ~35–40% of in-use TVs, Samsung Tizen ~19–23%, LG webOS ~12–25%, Roku ~10–11%, Fire TV ~8%. In the US the picture inverts (Roku OS 28%, Tizen 23% of broadband households). **The platform that blocks the device flow has the least reach in the regions Jesus Film serves.** Ship the device flow; ship Roku account-less or last. ([global](https://www.forasoft.com/blog/article/smart-tv-app-development), [US](https://www.parksassociates.com/blogs/pr-video-services-ott-pay-tv/roku-and-samsung-dominate-connected-tv-platforms))

### 3.4 Fire TV, Samsung Tizen, LG webOS, Vizio, and the emerging tier

- **Fire TV** runs Android TV builds (Fire OS is Android-based), so it comes free with the Android TV build from the same react-native-tvos codebase. Amazon publishes CBL — its own device-code flow — as the recommended pattern for limited-input devices, so the shape is native to the platform. Amazon's "Simple Sign-in" (Appstore SDK, ~395 KB, `getUserAndLinks()`, "opaque link tokens issued by you", docs updated 2026-02-17) is a Phase 2 accelerator.
- **Samsung Tizen, LG webOS, Vizio:** I searched the published certification/approval docs and found **no restriction on login mechanism**. Samsung's TV Seller Office process covers packaging, pre-test, UX Checklist and content review; the Sign-up UX guide is about CTA hierarchy ("Both the Sign Up and Sign In buttons should be equally emphasized"), not mechanism. LG's webOS approval is Pretest / Function Test / Content Test plus a self-checklist. In practice Netflix, Disney+ and Plex all ship QR sign-in on Samsung and LG. **This is an argument from absence — re-check at actual submission time.** Samsung additionally exposes a native `webapis.sso` Samsung Account API returning `{ bLogin, id, authToken, uid, guid }`, with an explicit warning that the UID "is considered personally-identifying information".
- **Emerging HTML5 tier:** VIDAA (Hisense/Toshiba, 40M+ devices, strong in EMEA/APAC/LatAm/South Africa), Titan OS (~18M, all new Philips TVs in 2026), Whale OS (JVC, Sharp, RCA, Vestel, Telefunken), Coolita (Skyworth, Coocaa, Transsion, Realme; 80+ countries, dominant in Indonesia). All are HTML5/JS surfaces reachable later with Lightning.js/Enact/React, and **all consume the identical backend endpoints and the identical verification page.** The auth work does not repeat.

---

## 4. The device-code flow done well — concrete UX spec

### 4.1 User code format

**Recommendation: 8 characters from RFC 8628's base-20 consonant set `BCDFGHJKLMNPQRSTVWXZ`, displayed as `XXXX-XXXX`.**

RFC 8628 §6.1 gives this as its own worked example (`WDJB-MJHT`, 20^8 ≈ 34.5 bits) and pairs it with the arithmetic: hold brute-force success at 2^-32 by allowing **only 5 attempts**. The consonant-only set removes vowels specifically "to avoid randomly creating words" — a real consideration for a ministry app showing an 8-character code on a family TV — and removes `0`/`O` and `1`/`l`/`I` confusables.

`better-auth@1.6.2`'s default is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (8 chars, 32^8 = 40 bits). Better entropy, but it retains vowels and mixes digits with letters. Supply a custom `generateUserCode`.

**The one genuinely live alternative: pure numeric.** RFC 8628 §6.1 explicitly sanctions it — "Pure numeric codes are also a good choice for usability" and appropriate "for clients targeting locales where A-Z character keyboards are not used" (example `019-450-730`). Netflix uses 8 numeric digits with `<input type="tel">` — a strong precedent from the most-localized streaming service on earth. For a global, majority-non-English-first, sometimes low-literacy audience, numeric is a defensible default: every phone keyboard on earth has a number pad one tap away, users with Pinyin/Devanagari/Arabic/Thai IMEs never have to mode-switch, and digits pattern-match more reliably than Latin consonants. **If we go numeric, use 10 digits, not 9** — 10^9 with a 5-attempt cap is ≈2^-27.6, short of the RFC's 2^-32 bar; 10^10 gets to ≈2^-31 and 11 digits clears it.

**Either way, the verification page MUST:** accept lowercase, strip dashes/spaces/punctuation, strip out-of-charset characters, and support paste. RFC 8628 §6.1: "the server should strip dashes and other punctuation that it added for readability... the user's input should be uppercased before a comparison."

> **Bug to fix, verified in `better-auth@1.6.2`:** `deviceVerify`, `deviceApprove` and `deviceDeny` do `user_code.replace(/-/g, "")` and then an exact-match lookup — **no `.toUpperCase()`**. A user typing lowercase gets a hard failure, and every such failure also looks like a brute-force attempt in the logs. Normalize with `.replace(/[^A-Za-z0-9]/g,'').toUpperCase()` before lookup.

**Do not vary the code format per platform.** Paramount+ reportedly varies code length by platform and produced user reports of a 7-digit TV code that won't fit a 5-box web field. Forge TV explicitly plans "later smart-TV platforms" — one format, forever.

### 4.2 Verification URL

**Recommendation: register a short vanity path (`jesusfilm.org/tv`) that 302s to the better-auth device endpoint.** This is the cheapest, highest-leverage UX win in the whole ticket, and it is an infrastructure decision with a lead time — make it before launch, not after.

Industry comparison: `yt.be/activate` (15 chars), `link.apple.com` (14), `plex.tv/link` (12), `netflix.com/tv2` (15), `google.com/device` (17), `max.com/signin` (14), `amazon.com/code` (15). Our likely `auth.jesusfilm.org/device` is 25 characters, longer than every one of them, and it leaks an infrastructure hostname to end users — which reads as untrustworthy on a ministry app.

### 4.3 QR: yes, always, alongside the code

RFC 8628 §3.3.1 is normative here: clients "MAY present this URI in a non-textual manner using any method that results in the browser being opened with the URI, such as with QR (Quick Response) codes or NFC... **Clients MUST still display the `user_code`**, as the authorization server will require the user to confirm it to disambiguate devices or as remote phishing mitigation." And: "The server SHOULD display the `user_code` to the user and ask them to verify that it matches the `user_code` being displayed on the device."

**The shipped prototype's QR + 8-char code is spec-correct. Lock it in as a non-negotiable, not an aesthetic choice** — and do not let anyone "simplify" it to QR-only. Beyond the MUST, QR-only strands users whose phone camera is unavailable, and it excludes blind users entirely (§4.6).

Visual hierarchy, matching Apple / Netflix / YouTube / Amazon: **QR largest and first, short URL second, code third.** Forge TV's global, low-connectivity audience makes the typed-URL fallback more load-bearing than it is for Netflix — do not shrink it to fine print.

The QR should encode `verification_uri_complete` so the scan lands on a pre-filled page; the printed fallback stays the bare `verification_uri` plus the code.

### 4.4 Expiry, polling, and recovery

| Setting               | Recommendation                                                                                                                       | Grounding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expires_in`          | **15 minutes** (halve better-auth's 30m default)                                                                                     | Microsoft Entra uses 15m; Roku's reference is 900s; Google is 1800s. Phishing mitigation comes from client/scope binding and attempt caps, not TTL (BCP §6.1.2 notes attackers defeat short TTLs by minting the code only after the victim clicks).                                                                                                                                                                                                                                                        |
| Code expiry UX        | **Auto-refresh the code in place**, plus a visible countdown and an always-focusable "Get a new code"                                | A dead code left on screen is the #1 reported activation failure across every service. Auto-refresh also resolves the WCAG 2.2 SC 2.2.1 tension (see below) — the user never hits a wall, so the TTL stops being an accessibility barrier.                                                                                                                                                                                                                                                                 |
| `interval`            | 5s default (RFC 8628 §3.2 when the server omits one)                                                                                 | Google uses 5s; Roku's reference is 30s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `slow_down`           | **Cumulative +5s per occurrence** — two `slow_down`s means +10s, not +5s                                                             | RFC 8628 §3.5: "the interval MUST be increased by 5 seconds for this and all subsequent requests".                                                                                                                                                                                                                                                                                                                                                                                                         |
| Terminal vs retryable | `authorization_pending` and `slow_down` retry. `access_denied`, `expired_token`, and **any unrecognized error code** stop polling.   | RFC 8628 §3.5: "If the client receives an error response with any other error code, it MUST stop polling." Provider taxonomies diverge — Google returns HTTP 428 for `authorization_pending` and 403 for `slow_down`/`access_denied`, plus a non-standard `rate_limit_exceeded`; Microsoft returns `authorization_declined` and `bad_verification_code` and **does not document `slow_down` at all**. Match on the error _string_, not the status code, and default unknown 400-class codes to fatal-stop. |
| Connection timeout    | Unilaterally reduce polling frequency, exponential backoff                                                                           | RFC 8628 §3.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Poll lifetime         | The poll must **survive navigation away from the sign-in screen** and back off rather than compete with video playback for bandwidth | Forge TV's flow is abandonable mid-session (§6.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

`apps/tv/src/lib/auth/deviceAuthFlow.ts` being a pure state module is the right shape — encode the cumulative `slow_down`, the terminal/retryable partition, and the timeout backoff as **exported testable functions**, not inline branches in the polling effect. Per the repo's mocked-shape-vs-real-contract discipline, give each terminal error code a test where only that branch can match, and assert that two `slow_down`s yield +10s.

> **StrictMode hazard:** the polling loop is exactly the shape documented in `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — a mount effect whose cleanup mutates hook-lifetime refs (aborting a shared `AbortController`, flipping a `mountedRef`). Render the sign-in hook's suite under `reactStrictMode: true` or the re-arm path is vacuously untested.

**WCAG note.** Device-code expiry is a WCAG 2.2 SC 2.2.1 time limit. W3C's Understanding document says "time-based / time-limited two-factor authentication tokens, can be considered essential" and "may be exempt from this criterion. However, other criteria may apply" (3.3.7, 3.3.8, 3.3.9) — so the exemption is _arguable_, not automatic. Screen-reader users following written instructions need materially more time. **The in-place auto-refresh is what makes 15 minutes safe here.** ([src](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html))

### 4.5 Layout specs

- **QR:** ≥400px on a 1080p canvas (10:1 rule at 8–10 feet, plus 20–30% for lighting/angle), with an adequate quiet zone, rendered **dark-on-light** — a light-on-dark QR fails many phone scanners.
- **Safe area (Android TV):** everything inside 48dp left/right, 27dp top/bottom.
- **Field sizing (from Google's device-flow guidance):** size the code field for **15 "W"-size characters** and the URL field for **40 characters**. Note this is a _field capacity_ rule, deliberately over-provisioned for future format changes — Google's own code is 9 characters and its URL is 29. The lesson to steal is "build a field that survives a code-format change", not "render 15 glyphs". ([src](https://developers.google.com/identity/gsi/web/guides/devices))
- **Code legibility:** readable from ~3m. Verify empirically by scanning from 3m with a mid-range Android phone on real Chromecast/Mi Box hardware via the `/build-tv` skill — Google publishes no QR sizing or contrast guidance for TV, so this is a documentation gap we close by testing.

### 4.6 Accessibility — and the Datadog collision

Roughly 90% of QR scanning apps do not support screen readers, and aligning a camera with a code on a screen you cannot see is often impossible. Guidance is consistent: "always provide a text URL or phone number as a fallback for anyone who cannot scan." The TV screen-reader landscape is fragmented across six products: tvOS VoiceOver, Fire TV VoiceView (a ground-up rewrite, **not** TalkBack), Android TV TalkBack, Roku Screen Reader, Samsung Voice Guide, LG Screen Reader. ([TetraLogical](https://tetralogical.com/blog/2023/08/09/tv-accessibility-considerations/))

**This collides directly with feat-322's Datadog constraint.** Accessibility _requires_ the code and URL to be in accessible text that VoiceOver/TalkBack announce. The ticket's resolution — keep the `accessibilityLabel`, override with `ddActionName` — is correct, but **restate it as a positive requirement** ("the code and verification URL MUST be screen-reader announced; RUM action names MUST be overridden") rather than a prohibition, or an engineer will "fix" the zero-PII rule by deleting the label. Extend the same override to the signed-in email/name row.

Also: set a deliberate reading order — **URL → code → instructions** — and group them so the announcement is coherent.

---

## 5. Security posture

### 5.1 The governing document

`draft-ietf-oauth-cross-device-security-16` (Kasselman/Fett/Skokan, 2026-03-02, intended status BCP) is the only current standards-track security guidance for the device grant — RFC 9700 (OAuth 2.0 Security BCP, Jan 2025) says nothing about it. §6.2.1.5 is blunt:

> "Only use this protocol if other cross-device protocols are not viable due to device or system constraints. Avoid using if the protected resources are sensitive, high value, or business critical. Always deploy additional mitigations like proximity or only allow with pre-registered devices."

§2 is normative: implementers **MUST** perform a risk assessment before implementing cross-device flows, **SHOULD** avoid them if risks cannot be sufficiently mitigated, and **MUST** select appropriate mitigations from §6.1.

**And the BCP's worked exploit example is literally a smart TV streaming service** (§4.3.1, Example B1): an attacker obtains a TV, copies its QR code into a mass email ("the streaming service wants to thank you for your loyal support — scan to add a bonus device"), and harvests access and refresh tokens, then scales by emulating new TVs. Root cause (§4.1.1): "the user is asked to compensate for the absence of an authenticated channel between the Consumption Device and the Authorization Device."

**feat-322 needs a written risk assessment section before the A/B decision is settled** — the BCP makes it a MUST, and our answer is genuinely strong: a free, no-paywall ministry app with personalization-only scopes, no payment instrument, no corporate data, no entitlement. That argument has to be _written down_, not assumed. The residual risk is reputational: a "sign in to Jesus Film" QR in a mass email is a plausible lure precisely because the brand is trusted.

### 5.2 The threat is industrialised, and it bypasses MFA and passkeys

Timeline: Storm-2372 (Russia-aligned) ran device-code phishing from Aug 2024, disclosed by Microsoft 2025-02-13. Push Security (2026-04-04, updated 2026-05-15) recorded a 37.5× rise in device-code phishing pages by March 2026 and catalogued 14+ kits (EvilTokens, Kali365, Device Code Lab, Venom). The Hacker News (2026-07-31) cites Microsoft observing "10 to 15 entirely new campaigns every 24 hours" and Barracuda counting 7 million attacks in four weeks.

The mechanism, per Push Security: "Device code authorization is effectively performed post-authentication. If you already have an active session in your browser, entering the device code and selecting your account from a drop-down menu is all that's needed. No password or MFA required." **Passkeys and MFA do not stop this** — the victim authenticates legitimately on genuine infrastructure. There is no fake login page and no malicious payload to scan for.

Almost all of this pressure targets Microsoft/Google/GitHub/Salesforce tenants. `auth.jesusfilm.org` is on no kit's target list. But **`auth.jesusfilm.org` is a shared IdP with six existing staff/service clients** — which is the sharpest risk here.

### 5.3 What we must do

1. **`validateClient` restricting the device grant to the `tv` client ONLY.** Never `admin`, `manager`, `mastra-studio`, or `admin-mcp`. Without this, a phishing link approved by a staff member could mint a token for a privileged client. This is the single most important line in the whole plan.
2. **Bind `client_id` + `scope` to the `device_code` at issuance, re-validate at approval.** Google's own IdP had exactly this bug — "fails to validate that `client_id` and `scope` in the consent URL match what was originally requested" — fixed 2026-03-28. This is the argument for route B over route A: route A's translation step is a second place the binding can drift.
3. **Attempt cap ~5 per user code.** RFC 8628 §5.1 mandates rate-limiting user-code attempts and works the arithmetic for exactly this. **A per-IP rate limit is not the same control** — a botnet defeats it.
4. **Explicit rate limits on `/device/*`.** Verified in `better-auth@1.6.2`: `grep -rn rateLimit` across the device-authorization plugin returns nothing, so it inherits only the loose global default (`enabled: isProduction`, `window: 10`, `max: 100`, `storage: 'memory'`). At the plugin's 40-bit default entropy that permits ~18,000 attempts inside the 30-minute window — **~70× the RFC's ~256-attempt budget, per IP**, and the in-memory store multiplies the budget by Railway replica count.
5. **Close the unauthenticated status oracle.** `deviceVerify` is a **GET** with `user_code` in the **query string**, requires no session, and returns `{user_code, status}` for a valid record while throwing `invalid_request` for an unknown one — a distinguishable response that also leaks when a code flips to `approved`. Prefer POST (a query-string code lands in Cloudflare and Railway access logs and in browser history), or accept and document the log exposure.
6. **Approval page: name the app, name the device, show the code to compare, make Deny at least as prominent as Approve.** BCP §6.1.14: "the 'decline' option SHOULD be the default option or given similar prominence"; "it should be clear to the user who invoked the flow, why it was invoked and what the consequence of completing the authorization is." **Prefilling the input from `?user_code=` is fine; skipping the human comparison is not.**
7. **Minimal scopes, audience-bound.** `openid profile:read email:read offline_access` is already close to Google's own 7-scope device-flow allowlist — say so in the ticket rather than leaving it implicit. Enforce server-side that the `tv` client can request _only_ that set (better-auth's device plugin accepts a caller-supplied `scope` on `/device/code`; scope validation must happen in the oauth-provider layer). Use `validAudiences` / `resource` so a stolen TV token is audience-bound to admin's GraphQL. **Never let the device grant become the path to a broader scope than web has.**
8. **Proximity as a _signal_, not a gate.** Compare the `/device/code` caller's ASN or coarse geo against the approving session's and log a mismatch. The BCP §6.1.1 explicitly warns that a hard same-network check is unusable here: "it is common for a Consumption Device (e.g., a TV) to use a Wi-Fi connection while the Authorization Device (e.g., a phone) uses a mobile network."
9. **"Sign out all TVs" in the web profile + a device list.** This is the entire Recover column of BCP §6.1.18 and the thing that turns a successful phish into a 30-second fix. Also the only recourse for a device left signed in at a shared location.
10. **Alert on anomaly** — device-grant volume per hour is a cheap tripwire.

### 5.4 `verification_uri_complete` — the trade-off, honestly

**Both Microsoft and Google ship device flows without it.** Microsoft's docs, verbatim: "The `verification_uri_complete` response field is not included or supported **at this time**. We mention this because if you read the standard you see that `verification_uri_complete` is listed as an optional part of the device code flow standard." **Microsoft states no reason** — do not repeat the claim that they withhold it "deliberately as an anti-phishing measure"; that is an inference, and "at this time" reads as not-yet rather than never. Google simply omits it (and uses the non-standard field name `verification_url`).

But Google's capability exists without the contract: `https://www.google.com/device?user_code=GQVQ-JKEC` 302-chains to `accounts.google.com/o/oauth2/device/usercode?user_code=...`, which renders "Match the code on your TV — To safely sign in to your device, first verify that the code on this screen matches the code that's displayed on your device. Code GQVQ-JKEC [Continue] [The codes don't match]". And Google's own TV apps (YouTube, YouTube TV) ship QR sign-in. **So "Google can't do QR scan-to-approve" is false and should not appear in any internal argument** — a reviewer who has signed into YouTube on a TV will know it on sight.

**What actually survives as an advantage of our own IdP:**

1. `verification_uri_complete` as a **contractual** RFC 8628 §3.2 response field with §3.3.1 explicitly blessing QR — versus a URL we would have to reverse-engineer.
2. A **genuine public client**: PKCE + `token_endpoint_auth_method=none`, zero secret in the TV binary. Google's device flow requires `client_secret` alongside `device_code`, and `accounts.google.com/.well-known/openid-configuration` lists only `client_secret_post` and `client_secret_basic` — no `none`. (Google treats it as non-secret by design; the exposure is client impersonation and quota abuse, not account compromise.)
3. **Unrestricted scopes and custom claims** — Google's device grant is capped at 7 scopes with no incremental authorization.
4. **We control** the code alphabet, length, TTL, and rate-limit policy.

Drop any argument based on code length (Google's is also 8 alphanumeric characters) or on Google being unable to do QR.

**Our position: ship `verification_uri_complete`, and pay for it with the code-match confirmation on the approval page.** A prefilled-and-auto-approved link is the phishing footgun. A prefilled-then-confirmed link is spec-compliant. RFC 8628 §5.4: "For authorization servers that support the `verification_uri_complete` optimization, it is particularly important to confirm that the device is in the user's possession, as the user no longer has to type in the code."

> `better-auth@1.6.2`'s device plugin **always** emits `verification_uri_complete` unconditionally — so this is already available on route A. Verify it survives the route B / translation path.

### 5.5 Token lifetime for a living-room device

**The baseline expectation is that TV sign-in is a once-ever event.** Roku makes silent cross-device re-login a _certification requirement_ for high-volume apps (`ChannelStore.storeChannelCredData`, so "once successfully authenticated on one device, customers are automatically signed in when they activate additional Roku devices"). Netflix treats repeat sign-in as a defect worth a troubleshooting article. Roku certification 4.1 adds the inverse: app updates are "prohibited from requiring reactivation/re-linking/re-login". **We have no paywall, so there is no entitlement reason to re-verify at all.** The security control must be **server-side revocation, not token expiry.**

`@better-auth/oauth-provider@1.6.2` defaults: access token 3600s (1 hour), refresh token 2592000s (**30 days, sliding** — `createRefreshToken` sets `exp: iat + refreshTokenExpiresIn` on every rotation). A refresh token is only issued when `offline_access` is in scope, matching the plan.

**Recommendation:** keep the 1-hour access token; extend the sliding refresh window to **90–180 days** (a household might open a ministry app monthly), pair it with a **hard absolute cap** so a harvested grant cannot live forever, and **refresh proactively on app foreground** so an idle TV renews before the window closes rather than after. The sliding window is itself the RFC 9700 §4.14.2 inactivity SHOULD ("Refresh tokens SHOULD expire if the client has been inactive for some time"), implemented for free.

### 5.6 The reliability landmine: mass refresh-token revocation

**This is the most likely real-world outage in the whole feature, and it is not currently in the ticket.**

Verified in `@better-auth/oauth-provider@1.6.2`, `handleRefreshTokenGrant`: on `if (refreshToken.revoked)` it runs `adapter.deleteMany({model:'oauthRefreshToken', where:[{field:'clientId', value: client_id},{field:'userId', value: refreshToken.userId}]})` and throws `invalid_grant`. That is **not** per-family or per-session revocation — it deletes **every refresh token for that client id and that user**. `createRefreshToken` marks the prior token revoked on every rotation with **no overlap window**.

better-auth issue [#8512](https://github.com/better-auth/better-auth/issues/8512) ("Refresh Token Rotation Grace Period (Overlap Window)", opened 2026-03-09, still open) documents exactly this and its false positives: concurrent foreground/background refreshes, and "network timeouts where the client retries after a successful server-side refresh". RFC 9700 §4.14.2 concedes the cost: reuse detection "stops the attack at the cost of forcing the legitimate client to obtain a fresh authorization grant."

**On a TV this is routine, not an edge case.** tvOS and Android TV kill backgrounded apps aggressively, so "refresh succeeded server-side, app died before `expo-secure-store` committed the new token" happens. Because revocation is keyed on `(clientId, userId)` and the plan uses a single `tv` client id, **one Apple TV's crash signs out the Android TV in the same house**, and both need the QR dance again.

Mitigations, cheapest first:

(a) **Write the new refresh token to secure store _before_ discarding the old one**, and treat the write as the commit point.
(b) **Single-flight the refresh** in the TV app so background and foreground never race — note the repo's own `docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md`, and specifically that a body-internal `finally` is the wrong shape for a shared-promise slot; use a caller-side identity-checked release registered on both settlement paths.
(c) Upstream or vendor a `refreshTokenGracePeriod` (Auth0/Okta both have one).
(d) If a per-device client id is feasible, blast radius drops to one TV.

**Add to Verification: kill the app mid-refresh and confirm it recovers.**

### 5.7 Replay protection and DPoP

RFC 9700 §4.14.2 makes replay protection a **MUST** for public clients: either sender-constrained refresh tokens (mTLS RFC 8705 or DPoP RFC 9449) or refresh-token rotation. `grep -rni dpop` returns **zero hits** across both `better-auth@1.6.2/dist` and `@better-auth/oauth-provider@1.6.2/dist`, and no mTLS. So **rotation is the only compliant option available in this stack** — and it is already the default, satisfying the MUST via the mechanism with the §5.6 failure mode.

DPoP would be strictly better for a device holding a refresh token for months (it makes an exfiltrated token useless off the TV), and `expo-secure-store` plus a hardware-backed key is a natural fit. BCP §6.1.12 names sender-constrained tokens as the mitigation that specifically defeats the "harvest tokens and sell them" business model behind Example B1. **Follow-up ticket, not v1 — but record why.**

### 5.8 App Review / Play Review operational risk

A reviewer cannot complete a device flow without a working demo account and clear instructions, and Guideline 2.1 (App Completeness) is the rejection vector.

- Working demo account with **no MFA on the approval page**, in the App Review Notes and Play Console.
- **Step-by-step English instructions**: "scan the QR / open jesusfilm.org/tv, enter code, sign in as X".
- **Confirm `EXPO_PUBLIC_TV_PROFILE_ENABLED` is set in the SUBMITTED build.** The ticket's own release-gating test is double-edged here — ship the flag off and the reviewer sees no Profile tab at all, which either hides the feature or reads as a broken build if the notes describe sign-in.
- Play accepts "QR codes or specific instructions for accessing restricted areas of your app" as review credentials — supply a sample.
- **Verify the approval path is not geo-fenced** by Cloudflare WAF (Play: "valid regardless of user location").
- Make the code expiry generous enough that a reviewer reading notes between steps does not time out.

---

## 6. Anonymous-first considerations

### 6.1 Never gate, never prompt at launch

Apple's HIG and App Store guideline 5.1.1(v) both say it, and it is now a store rule rather than a preference: "If your app doesn't include significant account-based features, let people use it without a login." Plus 5.1.1(x): "Apps may request basic contact information (such as name and email address) so long as the request is optional for the user, features and services are not conditional on providing the information."

**Cite the HIG text directly in the App Review Notes** so a reviewer reads the optional Profile tab as intentional design rather than an incomplete feature.

Comparable free services confirm the shape: Pluto TV requires no account; Tubi's library needs "no sign-ups required at all"; PBS gates only Passport member content; YouVersion's account is optional ("you can use YouVersion without an account, [but] many Bible App features only work if you have one").

**Because a user who abandons sign-in simply keeps watching, the flow must be interruptible and re-enterable at any time** — which is the opposite of every gated service's design. Concretely: never block the home screen; make the device flow abandonable and resumable mid-session without losing playback state; keep the polling loop alive across navigation.

### 6.2 Where to put the ask, and how to merge

**Put the sign-in entry point where the payoff is visible**, not in a first-run wall. The best-sourced real evidence on TV UX friction is the CTAM / Hub Entertainment Research study "Value by Design" (April 2026, n=3,000 US consumers 13–64, plus 24 in-depth interviews): 36% of viewers — and 43% under 25 — cancelled a subscription with poor UX as the **sole** reason, and "72% experience at least one problem that leaves them 'extremely frustrated'". **The top named pain points are navigation and buried "Continue Watching"** — not login. ([src](https://www.tvtechnology.com/insights/analysis/study-43-percent-of-younger-viewers-have-cancelled-subscription-over-bad-ux))

That is the actionable finding for us: **resume/watch-history is exactly what sign-in unlocks, so the payoff must be immediately visible on the home row.** Sign-in that does not visibly surface Continue Watching buys nothing. So: the Profile tab is the entry point, and an empty/anonymous "Continue watching" row is the second, with an inline "Sign in to keep your place on every device" affordance.

**Merge semantics** for `apps/tv/src/lib/viewer-id.ts`:

- Persist `viewer-id` across launches (currently in-memory) — it becomes the merge key.
- On first successful sign-in, perform a **one-time, idempotent** upload of the device's anonymous history keyed by `viewer-id`. Idempotency matters: sign out and back in must not double-merge.
- Server-side dedupe by `(videoId, timestamp)`; resume position resolves by **max progress**, not last-write.
- **Never merge one account's history into another account.** If the device's `viewer-id` has already been merged into account A, a subsequent sign-in as account B merges nothing.
- On sign-out, the device reverts to its own anonymous store and continues from there. Clear the account-derived cache; keep the device's pre-sign-in anonymous history.

### 6.3 Shared-device privacy — sharper for us than for Netflix

Android's TV design foundations: "TV is typically a shared device in the household... apps that show personal information should have privacy settings that allow relevant customizations." For a ministry app this is sharper than usual: **a viewer's watch history may reveal faith interest in a household or country where that is dangerous.**

Concretely:

- Show the **minimum identifying information** on the signed-in Profile screen — a first name or an initial, not a full email.
- **Sign-out one focusable row away**, no confirmation maze.
- Consider suppressing "Continue watching" rows under a guest/incognito mode.
- **Server-side session revocation** ("sign out this TV from your phone") — the only recourse for a device left signed in at a shared location.
- Extend the `ddActionName` override to the signed-in email/name row, not just the user code.

**Netflix's per-profile PIN is the model for any future profile lock, and the split matters:** it is 4 numeric digits, editing it requires stepping up ("verify your identity by entering a code sent to your email or mobile phone number, or by entering your Netflix account password"), and it is a **privacy/parental control, not an authentication factor**. Netflix kept it numeric and 4 digits precisely _because_ it is entered on a TV remote, in contrast to the account password which is not. If we ship profiles, copy that split exactly — a 4-digit numeric PIN is the only credential acceptable for remote entry, it guards profile switching only, and it must never become a second auth factor (~13 bits, typed in front of the room). ([src](https://help.netflix.com/en/node/114277))

### 6.4 One account per TV, or profiles? Decide now

tvOS has a first-class multi-user model (`TVUserManager`, `com.apple.developer.user-management`, `kSecUseUserIndependentKeychain`) built for exactly "a video content app that retains which shows they watch". Google TV has profiles too, though they are Google-Account-bound and **UNVERIFIED** whether third-party apps receive any profile-switch signal (no documented API found; Engage SDK's `setAccountProfile` implies the app supplies its own profile identity rather than reading the system's).

**v1 can legitimately be one signed-in account per device** — simplest, matches feat-229's web precedent. But **write it down as an explicit decision and file the follow-up**, because retrofitting profiles means migrating whatever `expo-secure-store` layout we ship. One concrete interaction to check now: a future shared-credential design needs `kSecUseUserIndependentKeychain` on the keychain item — **verify whether `expo-secure-store` exposes that flag before assuming the migration is free.**

Note also that the Forge account is independent of the Google TV / tvOS profile, so the ProfileScreen must make the signed-in identity visible at a glance — the next person to pick up the remote may not be the account holder.

---

## 7. What this means for feat-322

### 7.1 The prototype is the right shape

**QR + 8-character user code, on both platforms, is correct** and should be locked in:

- RFC 8628 §3.3.1 **requires** the code alongside the QR — it is an anti-phishing control, not decoration.
- Apple ships the same pattern itself for its own TV app on third-party TVs.
- 8 characters matches Google's own code length and RFC 8628's worked example.
- The QR-on-both-platforms constraint is correct and reinforced by Google TV having trained the gesture in its own profile-add flow.

Changes to the prototype: charset (§4.1), visual hierarchy QR → URL → code (§4.3), auto-refreshing code with countdown and a focusable "Get a new code" (§4.4), safe-area and QR sizing (§4.5), screen-reader announcement order with `ddActionName` overrides (§4.6).

### 7.2 Ticket edits

| Section                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem**                | Replace "Apple TV ships no web browser (no WebKit on tvOS), so browser-redirect PKCE is impossible there" with the corrected §3.1 wording. The current phrasing is challengeable.                                                                                                                                                                                                                                                                                                                                                             |
| **Architectural decision** | Strike route C entirely (Android TV has the same problem, so dropping Apple TV would not rescue it). Prefer route B for the client/scope-binding reason (§5.3.2). Add a **risk-assessment subsection** — BCP §2 makes it a MUST.                                                                                                                                                                                                                                                                                                              |
| **What To Build (server)** | Add: `validateClient` restricting to the `tv` client; `client_id`+`scope` bound at issuance and re-validated at approval; explicit `rateLimit.customRules` for `/device/*`; a per-user-code 5-attempt cap; `.toUpperCase()` normalization; custom `generateUserCode`; `expiresIn: '15m'`; `verification_uri_complete` verified present on the chosen route; extended refresh window + absolute cap; **an account-deletion endpoint**; **a session/device list + revoke-all**.                                                                 |
| **What To Build (TV)**     | Add: write-before-discard refresh persistence; single-flight refresh; auto-refresh of the expired code in place; account-deletion affordance (QR + short URL) on the signed-in Profile screen; `ASAuthorizationController` presentation wrapper on tvOS (Phase 2, but decide now whether the v1 screen leaves room for it).                                                                                                                                                                                                                   |
| **Constraints**            | Fix "TV's keyboard is letters-only" (Play/Pause mode toggle + dictation privacy is the real argument). Add: TV Provider SSO and tvOS 26 Automatic Sign-In are entitlement-blocked — do not investigate. Add: CIBA considered and rejected (requires typed user identifier). Add: **if the feat-121 approval page ever renders a Google/Facebook button, App Store guideline 4.8 attaches to the tvOS build** — audit before submission. Add: one code format across all platforms, forever. Restate the accessibility requirement positively. |
| **Verification**           | Add: two `slow_down`s yield +10s; each terminal error code has a test where only that branch can match; N wrong codes lock the code (not just slow the IP); kill the app mid-refresh and confirm recovery; StrictMode suite for the polling hook; Android TV D-pad sweep (different focus engine from tvOS); QR scanned from 3m on real hardware; submission checklist (demo account, notes, flag on in the submitted build, geo check).                                                                                                      |
| **Missing scope**          | **In-app account deletion** — the single most likely review rejection. Also a `deleteAccount` endpoint in `apps/auth` that "What To Build" does not currently list.                                                                                                                                                                                                                                                                                                                                                                           |

### 7.3 What the server (better-auth) must support

1. Device grant that returns tokens `resolveWebUserPrincipalFromToken` accepts (the whole point of the A/B decision).
2. `verification_uri_complete` in the `/device/code` response — the plugin emits it unconditionally today; confirm it survives the chosen route.
3. `validateClient` restricting the grant to `tv`; scope validation in the oauth-provider layer (the device plugin accepts a caller-supplied `scope`).
4. `generateUserCode` override + input normalization (`.toUpperCase()`, strip separators and out-of-charset characters, accept paste).
5. `rateLimit.customRules` on `/device/verify`, `/device/approve`, `/device/deny`, `/device/code`, plus a per-user-code failed-attempt counter.
6. `expiresIn: '15m'`.
7. Approval page: app name, device name, code re-display for comparison, Deny at least as prominent as Approve, localized, screen-reader friendly, accepts lowercase/separators/paste.
8. Extended sliding refresh window + absolute cap; ideally a rotation grace period (or the client-side mitigations in §5.6).
9. `validAudiences` / `resource` so TV tokens are audience-bound to admin's GraphQL.
10. A user-facing device/session list with revoke-one and revoke-all.
11. An account-deletion flow reachable from a short URL, with no phone-call/email-support requirement and available in every region.
12. `deviceCode` Prisma model + migration.

---

## 8. Open questions and unverified

**Decisions we must make (research cannot settle them):**

1. **Route A vs B.** Nothing in platform guidance constrains it; security argues for B. Needs the feat-121 owner and a look at whether `@better-auth/oauth-provider` has grown a device grant upstream.
2. **Code charset: base-20 consonant vs numeric.** §4.1 recommends base-20 with numeric as a live alternative pending a localization call. If numeric, use ≥10 digits.
3. **Short verification URL** — which domain/path, and who registers it.
4. **Single account per TV vs profiles** (§6.4) — decide before writing the secure-store layout.
5. **Roku posture** — launch sign-out-only, or budget a separate on-device auth build (§3.3).
6. **Refresh-token blast radius** — accept `(clientId, userId)` mass revocation with client-side mitigations, vendor a grace period, or use per-device client ids.

**Unverified, worth a short spike:**

7. **`ASWebAuthenticationSession` on physical Apple TV hardware.** Verified inert on the tvOS 26.5 _simulator_ (with an iOS control ruling out simulator limitations), but not on real hardware. A 30-minute spike on the Office Apple TV would retire this permanently so it never resurfaces in a future review.
8. **Whether `expo-secure-store` exposes `kSecUseUserIndependentKeychain`** — determines whether a future profiles migration is free.
9. **Whether Apple review accepts the QR/short-URL handoff for account deletion.** The explicit tvOS recipe was retired from the HIG in 2022; the current text says only "a direct link ... make the link easy to discover". It is a proven pattern, not a citable rule.
10. **Android Credential Manager on Android TV** — Play services v26.28 shipped TV support 2026-07-20 but Google's developer docs still omit TV. No first-party guidance on calling it from a TV app, minimum Play services gating, or react-native-tvos availability.
11. **Whether Google TV signals third-party apps on profile switch** — no documented API found.
12. **Roku's "effective September 30, 2021" AVOD date** — surfaced only in a search summary of a JS-rendered Roku blog post.
13. **Samsung Tizen / LG webOS login-mechanism constraints** — this is an argument from absence (I searched the published certification docs and found no clause). Re-check at submission time.
14. **Whether Microsoft Entra emits `slow_down`** despite not documenting it — irrelevant to us, but it is why the poller should treat unknown error codes as fatal-stop.
15. **Whether Apple would grant `com.apple.smoot.subscriptionservice`** to a free ministry video app. Almost certainly no. Filing a request is a lottery ticket outside the critical path — never a dependency.

**Fabricated statistics — do not let these into the ticket, PRD, or any deck.** A MojoAuth vendor blog (2026-05-13, syndicated to Security Boulevard so it appears twice in search results and looks corroborated) presents crisp, quotable figures: a "Roku 2025 connected viewer report" measuring "median time to enter a 12 character password on a TV remote at 47 seconds, with a 23 percent typo rate"; a "Conviva 2025 streaming benchmark" measuring device-code pairing at "a median 38 seconds end to end"; "31 percent of new subscriber activations on connected TVs that fail in the first session never come back"; "Every additional second of TV pairing latency above five seconds drops completion by 4.6 percent". **Neither underlying report exists.** Roku publishes developer analytics docs and OS release notes, no such consumer report; Conviva's published benchmarks are video quality-of-experience metrics (video start time, rebuffering) and cover no authentication funnel. The same article's _non-statistical_ guidance (8–9 char uppercase codes excluding `0/O/I/1`, a 600s TTL, honouring `slow_down`) is sound and matches RFC 8628 — which is exactly what makes the invented numbers dangerous. The same source's claims about "hybrid transport supported natively by Chrome on smart TVs that ship Android TV 12 and newer" are also unsupported by any Google or FIDO primary source and sit awkwardly against the fact that Android TV ships no Chrome. **For this research area, vendor auth blogs are heavily AI-generated; check every citation against the named source.**

If feat-322 needs a quantitative friction argument, use the CTAM / Hub study (§6.2) with its honest framing — it proves TV UX friction has severe consequences but does **not** specifically measure login drop-off — or platform-vendor qualitative guidance.
