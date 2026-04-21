# apps/tv — Expo TV App (Apple TV + Android TV)

## Stack

- React Native with Expo (SDK 54, managed workflow)
- react-native-tvos (aliased as react-native) for TV platform support
- @react-native-tvos/config-tv Expo plugin with EXPO_TV=1
- Expo Router for file-based navigation (stack only, no tabs)
- @forge/graphql with gql.tada for typed GraphQL operations
- Apollo Client for GraphQL data fetching
- expo-video for HLS playback
- expo-image for optimized image loading

## Architecture

This is a TV adaptation of the Server-Driven UI (SDUI) app. Same pipeline
as mobile, different renderers optimized for 10-foot UI and D-pad navigation.

### SDUI Pipeline

```
Strapi GraphQL → gql.tada typed query → normalizer (adds `kind`) → dispatcher → TV renderers
```

- **Queries**: Imported from mobile or copied with sync comment
- **Normalizer**: Copied from mobile (identical logic)
- **Dispatcher**: TV version with subset of block kinds
- **Renderers**: All new, designed for 10-foot UI with D-pad focus

## Design System: The Crimson Gallery

All UI follows the Crimson Gallery design system from the Stitch mockups:

- Background: `#161311` (warm stone, never pure black)
- Surface container: `#221F1D`
- Surface container high: `#2D2927`
- Primary accent: `#CB333B` (Crimson Red — sparingly, for CTAs and focus rings)
- Text: `#F5F5F4`
- Muted: `#A8A29E`
- Font: System (SF Pro on tvOS, Roboto on Android TV)
- No 1px borders — use background color shifts
- 16px border radius on cards
- Focus state: 1.05x scale + crimson glow

## Conventions

- Build with `EXPO_TV=1 npx expo prebuild --clean` before running.
- Dev-client builds only (no Expo Go on TV).
- System font (`fontFamily: 'System'`) for platform-native typography.
- `hexToRgba(color, 0)` for gradient stops — never `"transparent"`.
- Validate all CMS-sourced URLs via `validateUrl.ts` before use.
- Composite React keys: `key={\`${item.kind}-${item.id}-${index}\`}`.
- Hardcoded English locale: `{ locale: "en" }` for all GraphQL queries.

## TV-Specific Patterns

- Every interactive element must be focusable via D-pad.
- Visible focus ring (crimson glow) on focused elements.
- `TVFocusGuideView` to constrain focus within horizontal rails.
- `hasTVPreferredFocus` for initial focus control and back-navigation focus restore.
- Stack navigation only: Home → Experience Detail → Video Playback.
- Menu/Back button pops navigation stack.

## Common Pitfalls

- Android TV VideoView z-order: renders on top of all RN Views.
- Focus lost on back-navigation (react-native-tvos #852): workaround with `hasTVPreferredFocus` in `useEffect`.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Must run `EXPO_TV=1 npx expo prebuild --clean` when switching between TV and phone targets.

## Distribution & Release Operations

The TV app ships to internal stakeholders via TestFlight Internal Testing (Apple TV) + Google Play Internal Testing (Android TV) + EAS Update OTA. Full plan at `docs/plans/2026-04-21-002-feat-tv-internal-stakeholder-distribution-plan.md`. Phase 0 prerequisites must complete before any of the commands below produce real shipped builds; until then, this section documents intent.

### Ship sequence

| Change kind                                                                       | Command                                                                                                                                               | Why                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **JS / asset only** (renderers, content, layout, copy, images)                    | `pnpm --filter @forge/tv update:preview`                                                                                                              | Pushes via EAS Update; reaches stakeholders' installed binaries on next app launch with no prompt |
| **Native** (`app.json`, dependency add/remove, `ios/`, `android/`, config plugin) | `pnpm --filter @forge/tv exec eas build --profile preview --platform all && pnpm --filter @forge/tv exec eas submit --profile preview --platform all` | Cuts a fresh `.ipa` + `.aab`, ships through TestFlight + Play Internal Testing                    |

**How to tell which kind you have:** if your diff touches `apps/tv/app.json`, `apps/tv/package.json` dependencies, anything in `apps/tv/ios/` or `apps/tv/android/`, or any Expo config plugin, it's a **native** change. Everything else is JS-only and OTA is correct. When in doubt, native is the safer choice (forcing a rebuild is recoverable; pushing an OTA against a runtime mismatch silently misses installed builds).

### Runtime version policy: `fingerprint`

`apps/tv/app.json` sets `runtimeVersion: { "policy": "fingerprint" }` — diverges from `apps/mobile/`'s `"sdkVersion"` policy on purpose. The `react-native-tvos@0.81-stable` fork can move its RN minor without an Expo SDK bump, and `sdkVersion` would let an OTA push reach a binary whose native side has actually changed. `fingerprint` keys the runtime to the prebuild output, so any native drift forces a rebuild automatically.

`EXPO_TV=1` must be set in every `eas.json` build profile's `env` block so the fingerprint hash is stable between local and EAS Build environments — otherwise the OTA may target a runtime no installed binary matches (eas-cli #3160).

To see the current fingerprint: `npx expo-updates fingerprint:generate` from `apps/tv/`.

### TestFlight 60-day keep-alive cadence

TestFlight builds expire **90 days** after upload. To avoid silent stakeholder lockout (the app refuses to launch with "This beta has expired"), ship a fresh native build at least every **60 days** even if no native changes landed. Set a calendar reminder.

If the cadence slips past 70 days, proactively notify stakeholders via Slack before the build expires.

**Accepted gap (per origin brainstorm):** if Urim is unavailable for 30+ days past the 60-day cadence, all stakeholders lose access simultaneously with no fallback operator. Multi-operator shipping is explicitly out of scope for the prototype phase. Mitigation requires expanding scope to include a named delegate with ASC/Play admin + EAS project access + a tested runbook.

### Stakeholder offboarding

To remove a stakeholder from updates:

1. Remove their Apple ID from the **App Store Connect Internal Tester group** (stops new TestFlight builds).
2. Remove their Google account from the **Play Console Internal Testing tester list** (stops new Play updates).
3. **EAS Update has no per-user revocation.** The installed binary on the offboarded stakeholder's TV continues to receive OTA pushes from the `preview` channel until the stakeholder uninstalls the app — up to 90 days (TestFlight expiry) or indefinitely on Android.

If hard-revocation is required (e.g., stakeholder departs under non-amicable terms with access to embargoed CMS content), the only paths are: retire the `preview` channel entirely, or implement a server-side feature flag check inside the app. Both are out of scope for the prototype phase.

### Push authority

Only members of the JFP Expo organization with the **Developer** role or higher (verify against current Expo role definitions) can push to the `preview` EAS Update channel. Audit the EAS project member list (Expo dashboard → project settings → members) any time a stakeholder is onboarded or offboarded, and at the same cadence as ASC/Play tester-list audits.

`expo-updates` end-to-end codesigning is **not** configured — gated to EAS Production/Enterprise plans, and not warranted for the prototype threat model. Compensating controls during the deferral: HTTPS-only EAS CDN transport, EAS org membership gate, credential rotation on personnel change. Revisit codesigning when a `production` channel is introduced, when stakeholder count grows past 5, or when the app fetches authenticated/sensitive user data.

### Credential rotation

Default cadence: **rotate on personnel change** (any team membership change in JFP's ASC, Play Console, or Expo orgs) and on suspected compromise. ASC API keys also have a **1-year hard expiry** — calendar a reminder.

| Credential                | How to rotate                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ASC API key               | App Store Connect → Users and Access → Integrations → create new key → upload new `.p8` to EAS Credentials managed mode → revoke old key |
| Play service account JSON | GCP IAM → Service Accounts → create new key → upload new JSON to EAS Credentials managed mode → delete old key                           |

Both credentials are stored in EAS Credentials managed mode (not in `eas.json`, not in the repo). `eas submit` pulls them at submission time.
