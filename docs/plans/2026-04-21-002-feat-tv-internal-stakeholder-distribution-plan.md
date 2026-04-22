---
title: "feat: Internal-stakeholder distribution for apps/tv (TestFlight + Play Internal + EAS Update)"
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/2026-04-21-tv-internal-stakeholder-distribution-requirements.md
---

# feat: Internal-Stakeholder Distribution for `apps/tv`

## Resume Status

> **For the resuming agent: read this section first.** Last worked on 2026-04-23 on branch `feat/tv-internal-stakeholder-distribution` (7 commits ahead of `origin/main`, not pushed). Project paused while Urim handles off-keyboard Phase 0 work. To resume cleanly: `git checkout feat/tv-internal-stakeholder-distribution && /ce-work docs/plans/2026-04-21-002-feat-tv-internal-stakeholder-distribution-plan.md`.

### What's done (commits on the feature branch, oldest first)

| Commit    | Subject                                                                        | Plan unit covered                                   |
| --------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `fe49f82` | docs(tv): brainstorm and plan for internal-stakeholder distribution            | Plan + brainstorm artifacts                         |
| `cf9c569` | chore(tv): add expo-updates dep (Phase 0 compat spike verified)                | Phase 0 spike + Unit 1 step 3/4                     |
| `ba8ddff` | chore(tv): env file scaffolding + Metro inlining defense test (Unit 2 partial) | Unit 2 — env files, gitignore, env-resolution test  |
| `c80909d` | docs(tv): add Distribution & Release Operations runbook (Unit 9 partial)       | Unit 9 — runbook in `apps/tv/CLAUDE.md`             |
| `a362581` | chore(tv): remove unused @ts-expect-error directives on TVFocusGuideView       | Side chore — unblocks `pnpm typecheck`              |
| `d556b09` | feat(tv): add app icons + Android TV Leanback banner (Unit 3)                  | Unit 3 — fully complete                             |
| `3bdc7fe` | docs(tv): draft stakeholder install guide (Unit 8 partial)                     | Unit 8 — sections 1-6 + 8 (Troubleshooting stubbed) |

### Unit-by-unit status

| Unit                                            | Status                           | What's left                                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0 spike** (expo-updates compat)         | ✅ Done                          | `expo-updates@29.0.16` verified working on `react-native-tvos@0.81.5-2` for both platforms                                                                                                                                |
| **Unit 1** (EAS init + `app.json` linkage)      | ⏳ Blocked on Phase 0            | `expo-updates` dep already added (`cf9c569`). Still need: `eas init` (requires JFP Expo org membership), populate `owner` / `extra.eas.projectId` / `updates.url` / `runtimeVersion.policy: "fingerprint"` in `app.json`  |
| **Unit 2** (env scaffolding + Doppler)          | 🟡 Partial — needs Urim decision | `.env.example`, `.env.ci`, `.gitignore`, env test all done. Remaining: `fetch-secrets` script + Doppler `forge-tv` project (or fallback `dev_tv` config under `forge-mobile` per Urim's permission)                       |
| **Unit 3** (TV assets + Leanback banner)        | ✅ Done                          | Verified end-to-end: `EXPO_TV=1 npx expo prebuild --clean` generates iOS `AppIcon.appiconset` + Android `tv_banner.png` in all 5 density buckets, manifest `android:banner` + `android:icon` injected by config-tv plugin |
| **Unit 4** (`apps/tv/eas.json`)                 | ⏳ Blocked on Phase 0            | Needs ASC App ID + Apple Team ID from Phase 0 to populate `submit.preview.ios` block                                                                                                                                      |
| **Unit 5** (EAS Environments + credentials)     | ⏳ Blocked on Phase 0            | Needs ASC API key + Play service account JSON to upload via `eas credentials`                                                                                                                                             |
| **Unit 6** (first build/submit + smoke test)    | ⏳ Blocked                       | Depends on Units 1, 4, 5                                                                                                                                                                                                  |
| **Unit 7** (OTA + `update:preview` script)      | ⏳ Blocked                       | Depends on Unit 6 (needs an installed binary to OTA into)                                                                                                                                                                 |
| **Unit 8** (stakeholder install doc)            | 🟡 Partial                       | Sections 1-6 + 8 written. Section 7 (Troubleshooting) stubbed pending Unit 6 friction discoveries on real hardware                                                                                                        |
| **Unit 9** (operational runbook in `CLAUDE.md`) | 🟡 Partial                       | Content drafted in `apps/tv/CLAUDE.md` "Distribution & Release Operations" section. Verification gate (Urim re-reads after Unit 7 lands) is pending                                                                       |

### What's blocking — Urim's off-keyboard work

In dependency order. The minimum to unblock real progress is **#1 + #2** (everything else can land in any order before Unit 6).

1. **Bundle-ID audit + ASC tvOS app entry creation.** Confirm `org.jesusfilm.forgetv` is unregistered in JFP's ASC; create the tvOS app entry; record the numeric ASC App ID for Unit 4. If conflict found, decide on rename and tell the resuming agent so it can cascade through `app.json`, `assets/`, etc. in one commit.
2. **JFP Apple Developer Program access** for Urim (ASC user with role sufficient for tvOS app + internal testers + ASC API keys; record the Apple Team ID).
3. **JFP Expo organization (`jesus-film-project`) membership** for Urim (Developer role minimum). Required for `eas init` in Unit 1.
4. **JFP Google Play Console access** + organization-account creation if needed (DUNS check). Required for Unit 14 prereqs and Unit 6's Android half.
5. **Doppler workspace permission** to create `forge-tv` project (or fallback `dev_tv` config under `forge-mobile`). Required for Unit 2 completion.
6. **Stakeholder device survey** (2-5 people: Apple TV model + tvOS version, Android TV / Google TV / Fire TV / Roku / Tizen, planned Apple ID + region, Google account, household-config blockers).
7. **Preview CMS data sensitivity decision** — published-only vs draft-inclusive. Gates Unit 5's Strapi token scope decision.
8. **Privacy policy URL** for Play Console listing.

### Recommended next move when resuming

If at minimum **#1 + #2 + #3** above are done:

1. Get the EAS project owner slug + projectId by running `eas init` from `apps/tv/` while logged into the JFP org. Verify `eas project:info` returns the JFP org as owner.
2. Patch `apps/tv/app.json` with `owner`, `extra.eas.projectId`, `updates.url` (Expo's CDN URL keyed off projectId), `updates.checkAutomatically: "ON_LOAD"`, `runtimeVersion.policy: "fingerprint"`.
3. Verify `EXPO_TV=1 npx expo prebuild --clean` still succeeds.
4. Commit as `feat(tv): wire EAS project linkage in app.json (Unit 1)`.
5. Move to Unit 4 (write `apps/tv/eas.json`) using the directional shape in this plan, populating `submit.preview.ios.ascAppId` + `appleTeamId` from Phase 0 records.

If only **#5** (Doppler) is done but the others aren't: complete Unit 2 by adding the `fetch-secrets` script to `apps/tv/package.json` and running `pnpm fetch-secrets` once to verify `.env.local` populates correctly. Small atomic win.

If nothing is unblocked: the agent has nothing to do — pause and check back when prerequisites land.

### Key files for fast context (resuming agent — skim these)

- `apps/tv/CLAUDE.md` — TV-specific conventions including the new "Distribution & Release Operations" section
- `apps/tv/app.json` — current state: assets wired, config-tv plugin has `androidTVBanner` + `androidTVIcon`, `expo-updates` dep installed but `app.json` missing `owner`/`extra.eas.projectId`/`updates`/`runtimeVersion`
- `apps/tv/package.json` — `expo-updates@~29.0.16` present
- `apps/tv/.env.example` + `.env.ci` — env-handling pattern
- `apps/tv/src/env.test.ts` — proves Metro inlining defenses work
- `apps/tv/docs/stakeholder-install.md` — ready to share with stakeholders **after** Unit 6 fills in section 7 and Urim sends invites
- `docs/brainstorms/2026-04-21-tv-internal-stakeholder-distribution-requirements.md` — origin doc with full product-decision history

### Don't do these (sticky pitfalls discovered this session)

- Don't rewrite `apps/tv/src/env.ts` or `apps/tv/app/_layout.tsx` — they already implement the PR #703 Metro inlining defenses (verified). The original Unit 2 plan over-described this.
- Don't literally copy mobile's `update:preview` script — it omits `--environment preview` and lacks `EXPO_TV=1`. Use the explicit body in Unit 7's Approach.
- Don't use `<env: VAR>` placeholder syntax in `eas.json` — the schema doesn't support it. ASC/Play credentials live in `eas credentials` managed mode, not `eas.json` paths.
- Don't add `expo-doctor` CI job for `@forge/tv` — out of scope per the brainstorm; existing matrix lint/typecheck/test already covers it.
- Don't try to author the 5120×2880 tvOS App Store icon in `apps/tv/assets/` — that asset is uploaded via App Store Connect's UI during Phase 0 ASC app entry creation, not via the build pipeline.

---

## Overview

Enable 2–5 internal stakeholders (design, product, ministry leads) to install the `apps/tv/` Expo TV app on their personal Apple TV (tvOS 16+) and Android TV / Google TV devices, keep it installed indefinitely, and receive new builds without any tunnelling or developer-machine involvement. The chosen rails are **TestFlight Internal Testing** + **Google Play Internal Testing track**, with **EAS Update** layered on top for JS-only iteration between native rebuilds.

This plan covers all work required to go from the current state (no `eas.json`, no EAS project linkage, no `expo-updates` dep, no TestFlight/Play app entries, no tvOS app icon assets) to a working end-to-end ship sequence: `eas build --profile preview --platform all && eas submit --profile preview --platform all` for native changes, `eas update --channel preview` for JS-only changes.

See origin: `docs/brainstorms/2026-04-21-tv-internal-stakeholder-distribution-requirements.md` for the full product decision history, including why Approach D (stores + EAS Update) was chosen over Approach A (stores only) and Approach C (TestFlight + APK sideload).

## Problem Frame

Today, anything stakeholders see must come from a build running off Urim's machine — which does not satisfy "available at any time." The `apps/tv/` app has solid prototype scaffolding (`@react-native-tvos/config-tv`, `expo-router`, SDUI renderers) but no distribution plumbing. The mobile app (`apps/mobile/`) uses EAS Update over Expo Go specifically because Expo Go covered its dependencies — that shortcut is unavailable for TV (Expo Go does not run on tvOS/Android TV, and `react-native-tvos` requires a native build), so TV must commit to store-track Internal Testing as the baseline install path.

The work divides into a **blocking prerequisites phase** (off-keyboard: account access, bundle-ID registration, stakeholder device survey) and an **implementation phase** (repo changes + EAS/ASC/Play configuration). The prerequisites gate the implementation: no code changes can land against unregistered bundle IDs or unprovisioned credentials.

## Requirements Trace

From origin requirements (R-numbers preserved):

- **R1a** — EAS project initialization + `app.json` linkage: see Unit 1
- **R1** — `apps/tv/eas.json` `preview` build + submit profiles: see Unit 4
- **R2** — `eas submit` with credentials in EAS Environments: see Units 4, 5
- **R3** — `preview`-profile env values (CMS endpoint, GraphQL URL): see Units 2, 5
- **R4** — EAS Update `preview` channel + `expo-updates` dep + `eas update:configure`: see Units 1, 7
- **R5** — Runtime version policy `fingerprint` (documented divergence from mobile's `sdkVersion`): see Unit 1, 9
- **R6** — Stakeholder version identification via Expo Dev Menu: see Unit 8
- **R6a** — EAS Update fallback on CDN failure: see Unit 7
- **R6b** — OTA push authority bounded to org-account members; codesigning explicitly deferred (gated to EAS Production/Enterprise tier — see Key Technical Decisions): see Units 5, 9
- **R7** — Stakeholders added as Internal Testers: see Unit 6
- **R7a** — Offboarding procedure documented: see Unit 9
- **R8** — Stakeholder-facing install doc with pre-onboarding device checklist: see Unit 8
- **R9** — Passive native updates + silent OTA updates: verified by Unit 6 + Unit 7
- **R10** — One-command JS ship sequence: see Unit 7
- **R11** — Two-command native ship sequence: see Unit 6
- **R12** — Repo-documented JS-vs-native change rules: see Unit 9
- **R12a** — 60-day TestFlight keep-alive cadence: see Unit 9
- **R12b** — Stakeholder device survey as R13/R14 prerequisite: see Phase 0 prerequisites
- **R13** — Apple Developer Program access + bundle-ID audit: see Phase 0 prerequisites
- **R14** — Google Play Console access + Internal Testing prereqs + service account JSON: see Phase 0 prerequisites

## Scope Boundaries

- **Not** in scope: production store listings, external (public) TestFlight testers, App Store / Play Store production submission, marketing copy, production screenshots beyond Internal Testing minimum.
- **Not** in scope: crash reporting (Sentry), analytics, remote logging — explicitly deferred per origin.
- **Not** in scope: CI-driven automatic EAS builds. PR #633 explicitly removed EAS from CI; this plan preserves that decision. Manual ship sequence from Urim's machine only.
- **Not** in scope: a shared `apps/*/eas.json` pattern or shared credentials with `apps/mobile/`. TV gets a parallel-but-independent setup (see origin Key Decisions).
- **Not** in scope: runtime-behavior changes to the TV app, new renderers, or feature surface. This plan is purely distribution plumbing.
- **Not** in scope: multi-operator shipping. Success criterion explicitly scopes "Urim unavailable" to invite re-issuance only (per origin clarification during doc-review pass 2).
- **Not** in scope: EAS Update end-to-end codesigning (requires EAS Production/Enterprise plan; deferred until a `production` channel is cut).

### Deferred to Separate Tasks

- **Android TV content rating questionnaire + privacy policy URL confirmation**: part of R14's Play Console listing form, completed during Phase 0 prerequisites by Urim in the Play Console UI rather than as repo work.
- **EAS Environments variable population** (ASC API key `.p8`, Play service account JSON, `EXPO_PUBLIC_*` values): executed in the Expo dashboard UI, tracked in this plan's Unit 5 but not a code commit.
- **Future: `production` channel + store listings**: separate future plan when the prototype graduates.

## Context & Research

### Relevant Code and Patterns

- **`apps/mobile/eas.json`** — canonical shape for profile + channel + environment binding. TV will mirror structure with two key divergences: `distribution: "store"` (not `"internal"`) and a `submit.preview` block (mobile has none).
- **`apps/mobile/app.json`** — shows the shape for `owner`, `extra.eas.projectId`, `updates.url`, `runtimeVersion`. TV mirrors with a TV-specific `projectId` (from `eas init`) and `runtimeVersion: { "policy": "fingerprint" }` (mobile uses `"sdkVersion"` — see Key Technical Decisions).
- **`apps/mobile/.env.example`**, **`.env.ci`**, **`.env.production`** — documents the Doppler (dev) + EAS Environments (build/update) two-source pattern. TV mirrors all three.
- **`apps/mobile/src/env.ts`** + **`apps/mobile/app/_layout.tsx`** — the Metro inlining defenses from PR #703: top-level `_inlined` const, `require()`-in-try/catch in the root layout, `skipValidation: !!process.env.CI && !process.env.EAS_BUILD`. Must be ported to TV before the first OTA or stakeholders see white screens.
- **`apps/mobile/package.json`** — scripts `update:preview`, `fetch-secrets` (Doppler atomic temp+rename). TV mirrors with a new Doppler project `forge-tv`.
- **`.github/workflows/ci.yml`** — existing matrix lint/typecheck/test already cover `@forge/tv` via `--affected`. Adding a `@forge/tv`-specific `expo-doctor` job is **out of scope for this plan** (the existing matrix is sufficient for the 2–5 stakeholder goal); file as a separate chore if desired later.
- **`apps/tv/src/env.ts`** — already has the `@t3-oss/env-core` scaffolding from the TV prototype but not the Metro-inlining defenses. Unit 2 updates it.

### Institutional Learnings

- **`docs/solutions/mobile/eas-update-stakeholder-preview-setup.md`** — rationale for why mobile chose EAS Update over TestFlight (Expo Go sufficed, $0 vs $99/yr, ~30s publishes vs ~15 min builds). This rationale does **not** apply to TV — documented in Key Technical Decisions so future agents don't second-guess the divergence.
- **`docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`** — the prior white-screen-on-OTA incident. Port the fix pattern to TV in Unit 2 proactively.
- **`docs/solutions/mobile/expo-env-file-handling.md`** — `--channel` and `--environment` are independent and must both be passed to `eas update`. EAS "secret"-visibility variables are **not** available during `eas update` — only "sensitive" or "plain text". Feeds Unit 5 + Unit 7.
- **`docs/solutions/platform/new-app-ci-and-deployment-patterns.md`** — `skipValidation: !!process.env.CI && !process.env.EAS_BUILD` is required for EAS Build to see env vars. Lazy `getApolloClient()` pattern must hold through EAS Build conditions.
- **`docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`** — `tvosDeploymentTarget: "16.0"` and `newArchEnabled: false` are mandatory, and `EXPO_TV=1 npx expo prebuild --clean` must run before every native build. Unit 4's `eas.json` must set `EXPO_TV=1` in each profile's build env.

### External References

- [EAS Submit introduction](https://docs.expo.dev/submit/introduction/) — canonical submit profile shape
- [Submit to the Apple App Store](https://docs.expo.dev/submit/ios/) — `ascAppId`, API-key auth fields
- [Submit to Google Play Store](https://docs.expo.dev/submit/android/) — `track: "internal"`, `releaseStatus`, service account
- [eas.json reference](https://docs.expo.dev/eas/json/)
- [App version management (`appVersionSource`)](https://docs.expo.dev/build-reference/app-versions/) — remote source avoids duplicate-buildNumber TestFlight rejections
- [Runtime versions for EAS Update](https://docs.expo.dev/eas-update/runtime-versions/)
- [Fingerprint your native runtime](https://expo.dev/blog/fingerprint-your-native-runtime) — recommended policy for forked-RN / custom-native projects like `react-native-tvos`
- [Build Expo apps for TV](https://docs.expo.dev/guides/building-for-tv/) — `EXPO_TV=1` flow
- [Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/) — visibility semantics and EAS Environments dashboard
- [TestFlight tvOS internal testing + redemption codes](https://www.imore.com/testflight-updated-support-tvos-app-internal-testing-invite-redemption-codes) — tvOS-specific invite flow
- [Google Play target API level](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) — API 34 for TV (one-tier exemption)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) — Internal Testing track is exempt until promotion
- [eas-cli #3160 — fingerprint picks up profile env](https://github.com/expo/eas-cli/issues/3160) — confirms `EXPO_TV=1` must live in the build profile's `env`

## Key Technical Decisions

- **`distribution: "store"` for the `preview` build profile, not `"internal"`.** `"internal"` produces an ad-hoc-signed `.ipa` that TestFlight rejects. The origin requirements doc used "internal" loosely to mean "internal audience"; the technically correct EAS distribution value for TestFlight-bound builds is `"store"`.
- **`runtimeVersion: { "policy": "fingerprint" }` for TV (diverging from mobile's `"sdkVersion"`).** The `react-native-tvos` fork can move its RN minor without an Expo SDK bump, and `sdkVersion` would let an OTA push reach a binary whose native side has changed. `fingerprint` keys the runtime to the prebuild output — native drift forces a rebuild automatically. **`EXPO_TV=1` must be set in every build profile's `env`** so the fingerprint hash is stable between local and EAS Build environments ([eas-cli #3160](https://github.com/expo/eas-cli/issues/3160)).
- **`appVersionSource: "remote"` in `apps/tv/eas.json`.** EAS owns `ios.buildNumber` and `android.versionCode` server-side, preventing "duplicate buildNumber" TestFlight rejections on repeat submits. Combined with `autoIncrement: true` on the `preview` profile, every submission gets a fresh counter.
- **Repo-root `/eas.json` is an orphan; leave or remove, but do not depend on it.** EAS CLI resolves to the nearest `eas.json` walking up from cwd. `apps/tv/eas.json` (new) + `apps/mobile/eas.json` (existing) each fully own their app's config. The root file is never invoked. This plan does not modify it; deletion can be a separate cleanup chore.
- **ASC authentication: App Store Connect API key (`.p8` + `ASC_KEY_ID` + `ASC_ISSUER_ID`) stored in EAS Environments at `secret`-file visibility.** Apple ID + app-specific password also works but is brittle under 2FA and does not match the "non-interactive from Urim's machine" shape. Key is managed in EAS Environments (not `eas credentials` managed mode) so rotation is a dashboard action.
- **Play service account IAM: Release Manager role scoped to the single `org.jesusfilm.forgetv` app.** Admin is overscoped. Play Console role mapping: [Release Manager](https://aso.dev/google-play/roles/) permits uploading to all tracks including Internal Testing without granting billing or team-management permissions.
- **EAS Update end-to-end codesigning: explicitly deferred.** Feature is gated to EAS Production/Enterprise plans and has non-trivial setup (1-year cert renewal, key management). For an internal prototype the threat model is low. Revisit when a `production` channel serves end users (out of scope here).
- **EAS Environments for `apps/tv/`: `preview` only on this pass.** Matches the brainstorm's decision to define only the `preview` profile now. Future `development` and `production` profiles (+ their environments) can be added when a concrete need appears.
- **Doppler project name: `forge-tv` (new).** Parallel to `forge-mobile`. Development-only; not used during `eas build` or `eas update`. Created by Urim during Unit 2.
- **No EAS in CI.** PR #633 removed EAS Update from CI for mobile; this plan preserves that policy for TV. CI only runs `expo-doctor` against the TV app gated to `@forge/tv`.

## Open Questions

### Resolved During Planning

- **dev/prod profiles in `apps/tv/eas.json`?** → Resolved in brainstorm pass 2: `preview` only.
- **Root `/eas.json` conflict?** → Resolved via repo research: orphan file, EAS uses nearest. No override work required.
- **ASC auth method (API key vs Apple ID)?** → API key via EAS Environments (see Key Technical Decisions).
- **Preview-profile env value source?** → `environment: "preview"` field in `eas.json` binds to EAS Environments dashboard, mirroring mobile. Collapses R3 to one config line.
- **Runtime version policy for tvOS?** → `fingerprint` with `EXPO_TV=1` in profile env.
- **`expo-updates` codesigning?** → Explicitly deferred (gated to EAS Production/Enterprise plan; not worth for prototype).
- **Stakeholders added individually or via group?** → Individually by email for now. List is small (2–5) and stable enough that group overhead isn't worth it. Revisit if list exceeds ~10.
- **Leanback launcher + TV banner for Android TV?** → `@react-native-tvos/config-tv` handles Leanback automatically when `EXPO_TV=1`. TV banner (320×180 xhdpi) needs to be authored — see Unit 3.
- **Data Safety form required at Internal Testing tier?** → No. Form is required before graduating to Closed/Production only. Deferred.
- **12-tester / 14-day closed-testing cohort policy?** → Applies to personal-account graduations Closed → Production. Organization accounts are exempt. Does not apply to Internal Testing.

### Deferred to Implementation

- **Exact iOS/tvOS app icon asset sourcing.** The 5120×2880 tvOS App Store icon is a specific dimension. Either: (a) author new, (b) derive from existing `jesusfilm.org` brand kit, (c) adapt from `apps/mobile/assets/icon.png` (likely too small and phone-focused). Unit 3 will resolve during implementation by checking the brand kit first.
- **Privacy policy URL for Play Console listing.** Whether to point to an existing `jesusfilm.org/privacy` page or request a JFP-authored one. Unit 6 confirms during Play Console setup; does not block earlier units.
- **Preview CMS endpoint data-sensitivity classification.** Per origin Deferred-to-Planning question: is the preview CMS endpoint published-only or draft-inclusive? Unit 5 surfaces this when configuring `EXPO_PUBLIC_GRAPHQL_URL`. If draft content is present, consider Cloudflare WAF tightening.
- **TestFlight smoke test on real Apple TV hardware.** Unit 6 includes this as the completion gate; exact device and tvOS version are discovered at test time.
- **EAS Environments dashboard layout — separate `preview` env for TV vs sharing with mobile's `preview`?** Technically either works, but separating avoids `EXPO_PUBLIC_*` collision between apps. Default: separate. Unit 5 confirms.
- **`scripts/update-preview.sh` wrapper vs inline `package.json` script.** Mobile uses an inline script; TV can mirror. If the command gets long enough to hurt readability, extract to a file.
- **Is the `.env.preview` local swap redundant given EAS Environments?** The `update:preview` script copies `.env.preview` into `.env.local` before running `eas update --channel preview --environment preview`. If Metro during `eas update` resolves `EXPO_PUBLIC_GRAPHQL_URL` from the EAS Environment first (and the local `.env.*` only fills in values the EAS Environment doesn't define), the swap is redundant and can be dropped, simplifying the script to just `EXPO_TV=1 eas update --channel preview --environment preview`. Verify during Unit 7 implementation by temporarily skipping the swap and confirming the pushed bundle still contains the preview CMS URL. Mobile uses the swap because its resolution order may differ; TV can drop it if the EAS Environment alone suffices.

## Phased Delivery

### Phase 0 — Prerequisites (Blocking, Off-Keyboard)

**Nothing in Phase 1+ can begin until Phase 0 completes.** This phase produces no repo commits but gates everything downstream. Track outcomes in a checklist — not as an implementation unit.

- [ ] **Stakeholder device survey completed**: 2–5 confirmed stakeholders enumerated with (a) Apple TV model (Apple TV HD 4th-gen or later is the tvOS-16 floor) + tvOS version, (b) Android TV / Google TV / Fire TV / Roku / Tizen / webOS, (c) planned Apple ID + Google account for the test install, (d) **Apple ID country/region matches the JFP developer account's App Store distribution region** (mismatch silently blocks install for international stakeholders), (e) Google account is signed into the same Android TV the stakeholder intends to use. Outcome-dependent branching documented (origin R12b): all-iOS → defer Unit 4's Android half + Unit 14 entirely; Fire-TV/Roku/Tizen/webOS stakeholders → loaner device or carve-out.
- [ ] **Apple Developer Program access** confirmed and granted to Urim (admin grants ASC user with role sufficient to register a tvOS app + manage internal testers + create ASC API keys; note that ASC API key creation may require Account Holder approval at some tiers — confirm at grant time). **Bundle-ID audit for `org.jesusfilm.forgetv` is the first check**, before EAS project init: confirm unregistered in JFP's ASC (or that legacy ownership can be transferred), verified no namespace conflict with `org.jesusfilm.forgewatch` (mobile), and verified ASC's "similar to existing app" heuristic does not flag the pair. If the bundle-ID must be renamed (e.g., to `org.jesusfilm.forgetvapp`), capture the **full cascade in a single change list**: `apps/tv/app.json` iOS/Android fields, `apps/tv/eas.json` (if submit profile references the ID), any Doppler project name choice, Play Console listing, ASC app entry. Renaming after Unit 1 lands is substantially more expensive than renaming here.
- [ ] **ASC app entry created** for the tvOS target using the confirmed bundle ID; numeric ASC App ID recorded for pre-populating `submit.preview.ios.ascAppId` in Unit 4 (avoids a second commit after Unit 6).
- [ ] **Google Play Console access** confirmed and granted to Urim (admin role sufficient to register a new Android TV app, manage Internal Testing tester lists, and create service account JSON). If no Play Console exists, JFP opens an **organization account** (not personal; $25 one-time; organization creation may require a DUNS number or equivalent business verification — confirm JFP has this before opening).
- [ ] **Privacy policy URL** identified for Play listing (either existing `jesusfilm.org/privacy.html` or a new URL authored). Mandatory at app-create time even for Internal Testing track.
- [ ] **Preview CMS endpoint data-sensitivity classification** resolved: is the preview `EXPO_PUBLIC_GRAPHQL_URL` served by a published-content-only endpoint, or does it include draft/unpublished content? This gates Unit 5 (EAS Environment value), SEC-005 (read-only token scope), and the offboarding-window risk (R7a implications). If draft content is present, tighten Cloudflare WAF rules before Unit 5 stores the token.
- [ ] **JFP Expo organization** exists (mobile app uses `owner: "jesus-film-project"`; confirm same org and Urim's membership). Required for `eas init` to place the TV project under the JFP org rather than Urim's personal account (which would require a non-trivial project transfer).
- [ ] **Doppler workspace permission** confirmed for Urim to create a new `forge-tv` project. Fallback: if only project-write access exists, scope TV secrets as a new config under the existing `forge-mobile` project (e.g., `dev_tv`). Either path is acceptable for Unit 2; the point is to have the Doppler path sorted before Unit 2 blocks.
- [x] **expo-updates compatibility spike** against `react-native-tvos@0.81-stable`: **VERIFIED 2026-04-22.** `expo-updates@29.0.16` (same version as `apps/mobile/`) installs cleanly via `npx expo install expo-updates`, peer-resolves against `react-native-tvos@0.81.5-2` without errors, and autolinks on both platforms under `EXPO_TV=1 npx expo prebuild --clean`. iOS: `EXUpdates 29.0.16` pod installed via CocoaPods, `Podfile.lock` resolves the pod from the `react-native-tvos`-keyed pnpm path. Android: `expo-updates` + `expo-updates-interface` autolinked via `expoAutolinking.useExpoModules()` (21 total expo modules). No fallback decision required.
- [ ] **Stakeholder PII handling decided**: all stakeholder Apple IDs and Google accounts collected (needed for tester invitations in Unit 6) are stored in a single agreed location — a private shared team password manager or a private Slack message — with access limited to Urim and one backup team member. Record is deleted or anonymized once all stakeholders are successfully onboarded into the respective testing tracks.

### Phase 1 — Local Scaffolding (Units 1–3)

Can start in parallel with Phase 0 where no account dependency exists. Units 1 and 2 require the EAS project (needs Phase 0 complete); Unit 3 (assets) can start immediately.

### Phase 2 — EAS Config + Credentials (Units 4–5)

Depends on Phase 0 + Phase 1. Produces the `eas.json` file and populates EAS Environments with credentials.

### Phase 3 — First Submission + OTA Verification (Units 6–7)

End-to-end: first native build reaches TestFlight + Play Internal Testing, first OTA push reaches installed builds. Unit 6 includes the Apple TV smoke test that resolves one of the Deferred-to-Implementation questions.

### Phase 4 — Documentation (Units 8–9)

Stakeholder-facing onboarding doc + operational runbook. Depends on Phase 3 so the documentation reflects what actually works, not what was planned.

## Implementation Units

- [ ] **Unit 1: Initialize EAS project + add `expo-updates` + link `apps/tv/app.json`** _(Resume status: `expo-updates` dep installed in `cf9c569`; remaining work blocked on JFP Expo org access)_

**Goal:** Create the TV app's EAS project under the JFP organizational Expo account, add the missing `expo-updates` dependency, and populate `apps/tv/app.json` with the four fields that bind the binary to that EAS project (`owner`, `extra.eas.projectId`, `updates.url`, `runtimeVersion`).

**Requirements:** R1a, R4 (prerequisite), R5

**Dependencies:** Phase 0 complete (specifically: JFP Expo org + Urim has membership).

**Files:**

- Modify: `apps/tv/app.json` (add `owner`, `extra.eas.projectId`, `updates.url`, `updates.checkAutomatically`, `runtimeVersion.policy: "fingerprint"`)
- Modify: `apps/tv/package.json` (add `expo-updates` at the SDK-54-compatible version; `apps/mobile/` currently uses `~29.0.16`, confirm compatibility with `react-native-tvos@0.81-stable`)
- Modify: `pnpm-lock.yaml`

**Approach:**

- Run `eas init` from `apps/tv/` while logged into the JFP Expo org; this writes `extra.eas.projectId` and sets `owner`.
- Run `eas update:configure` to write `updates.url` and `runtimeVersion`.
- Override the default `runtimeVersion.policy` (may be `appVersion` by default) to `"fingerprint"` — commit a one-line comment noting the divergence from mobile's `sdkVersion` rationale (react-native-tvos fork).
- Add `expo-updates` via `npx expo install expo-updates` so Expo resolves the version matching SDK 54.

**Patterns to follow:**

- `apps/mobile/app.json` shape for `owner`, `extra.eas.projectId`, `updates.url`, `updates.checkAutomatically: "ON_LOAD"`.

**Test scenarios:**

- Test expectation: none — pure configuration change verified by EAS dashboard showing the new project under the JFP org and `apps/tv/app.json` containing all four linkage fields. Runtime behavior is exercised in Units 6–7.

**Verification:**

- `eas whoami` shows JFP org membership.
- `eas project:info` (run from `apps/tv/`) returns the project owned by the JFP org, not Urim personal.
- `apps/tv/app.json` contains `owner: "<jfp-org-slug>"`, `extra.eas.projectId: "<uuid>"`, `updates.url: "https://u.expo.dev/<same-uuid>"`, `runtimeVersion.policy: "fingerprint"`.
- `apps/tv/package.json` lists `expo-updates` at a version `npx expo install` resolves for SDK 54.
- `pnpm install` at the repo root succeeds; `apps/tv` typecheck passes.

- [ ] **Unit 2: Establish env-file scaffolding + Doppler integration + verify existing Metro defenses** _(Resume status: env files + gitignore + test landed in `ba8ddff`; Doppler script remaining — needs Urim's permission decision)_

**Goal:** Add the missing env-file scaffolding (`.env.example`, `.env.ci`, `.env.preview`), update `.gitignore` to the mobile-app's full pattern, wire up a Doppler project for local dev secrets, and **verify** that the Metro-inlining defenses already present in `apps/tv/src/env.ts` and `apps/tv/app/_layout.tsx` (from the TV prototype) actually work end-to-end before the first OTA push.

**Important context for the implementer:** The Metro-inlining defenses (`_inlined` const + `skipValidation` guard in `src/env.ts`; `require()`-in-try/catch + `ErrorBoundary` class + `moduleError` fallback in `app/_layout.tsx`) **are already implemented** in the current TV prototype. Do **not** rewrite them — verify they remain intact and behave correctly under simulated EAS Update conditions. The PR #703 incident is the reason these defenses exist; the prototype already absorbed that lesson.

**Requirements:** R3 (env values), R4 (prerequisite for safe OTA)

**Dependencies:** Unit 1.

**Files:**

- Create: `apps/tv/.env.example` — adapt mobile's shape; TV currently consumes `EXPO_PUBLIC_GRAPHQL_URL` and optionally `EXPO_PUBLIC_STRAPI_TOKEN` (already declared in `apps/tv/src/env.ts`)
- Create: `apps/tv/.env.ci` — placeholder values (e.g., `ci-placeholder` literal) so CI lint/typecheck succeed without Doppler
- Create: `apps/tv/.env.preview` (gitignored, hand-authored locally by Urim) — preview-target GraphQL URL for the `update:preview` script. Named `.env.preview` rather than `.env.production` to match what it actually contains (only the `preview` env exists in this plan's scope; see Scope Boundaries)
- Modify: `apps/tv/.gitignore` — currently 5 lines (`.expo/`, `ios/`, `android/`, `.env.local`, `node_modules/`); replace with `apps/mobile/.gitignore`'s shape including a `.env.*` catch-all plus `!.env.example`, `!.env.ci` exemptions, plus `expo-env.d.ts`, `dist/`, `web-build/`, `.metro-health-check*`, `*.tsbuildinfo`, and `.kotlin/`
- Modify: `apps/tv/package.json` — add a `fetch-secrets` script targeting Doppler project `forge-tv` config `dev` (atomic temp+rename pattern from mobile)
- Test: `apps/tv/src/env.test.ts` — verify `_inlined` resolves to expected values when `process.env.EXPO_PUBLIC_*` is set, that `skipValidation` triggers under `process.env.CI && !process.env.EAS_BUILD`, and that the existing try/catch surfaces `_inlined` values in the thrown error message (ensures the defense is wired into the failure path, not just present)

**Files NOT to modify** (already correct):

- `apps/tv/src/env.ts` — `_inlined` const, try/catch, and `skipValidation` guard already in place
- `apps/tv/app/_layout.tsx` — `require()`-in-try/catch, `ErrorBoundary`, and `moduleError` fallback already in place

**Approach:**

- Audit the existing `apps/tv/src/env.ts` and `apps/tv/app/_layout.tsx` against the mobile patterns; only file a separate sub-task if a genuine gap is found (none expected).
- For Doppler: confirm Urim has workspace permission to create the `forge-tv` project (per Phase 0). Fallback: if only project-write is granted, scope `forge-tv` as a new config under the existing `forge-mobile` project (e.g., `dev_tv`) — same data, different isolation.
- `.env.preview` is hand-authored; Doppler covers `.env.local` for dev only.

**Execution note:** Before Unit 7's first OTA, verify Metro inlining works by changing an `EXPO_PUBLIC_*` value in `.env.local`, running a local Metro bundle, and grepping the output for the inlined string literal. Catches any regression in the existing defenses before stakeholders see them.

**Patterns to follow:**

- `apps/mobile/.env.example`, `.env.ci` — file shape and placeholder pattern.
- `apps/mobile/.gitignore` — full ignore set including `.env.*` + exemptions.
- `apps/mobile/package.json` `fetch-secrets` script — atomic Doppler download.

**Test scenarios:**

- Happy path: `src/env.ts` with `EXPO_PUBLIC_GRAPHQL_URL` set returns the URL via the exported `env` object.
- Edge case: `process.env.CI="1"` and `EAS_BUILD` unset triggers `skipValidation: true`; env object returns without throwing on missing values.
- Edge case: `process.env.CI="1"` and `EAS_BUILD="1"` does NOT trigger skipValidation (validates real EAS Build env).
- Error path: missing `EXPO_PUBLIC_GRAPHQL_URL` with validation enabled throws an error containing the `_inlined.url` value (`"undefined"` literal), proving the defense surfaces inlining state in the error message.

**Verification:**

- `pnpm typecheck` in `apps/tv/` passes.
- `pnpm lint` in `apps/tv/` passes.
- `apps/tv/src/env.test.ts` passes.
- `git check-ignore apps/tv/.env.example` returns nothing (file not ignored).
- `git check-ignore apps/tv/.env.preview` returns the matching `.env.*` rule (file IS ignored).
- Doppler project `forge-tv` (or fallback config under `forge-mobile`) exists; `pnpm fetch-secrets` in `apps/tv/` writes `.env.local` without error.

- [x] **Unit 3: Author TV-specific app icons + Android TV banner** _(Done in `d556b09` — assets derived from `apps/mobile/`; refinement to brand-kit fidelity is a future polish task)_

**Goal:** Produce the asset set that App Store Connect and Play Console require for tvOS and Android TV listings respectively. Missing assets block submission, not just cosmetically — ASC rejects builds without the 5120×2880 tvOS App Store icon, and Play Console won't show the app on TV home screens without the Leanback banner.

**Requirements:** Supports R1, R7 (Internal Testing listing prereqs)

**Dependencies:** None (can run in parallel with Units 1–2).

**Files:**

- Create: `apps/tv/assets/icon.png` (1024×1024, used as source by `expo-icon` for generated sizes)
- Create: `apps/tv/assets/tvos-app-store-icon.png` (5120×2880, layered for tvOS App Store)
- Create: `apps/tv/assets/android-tv-banner.png` (320×180, xhdpi)
- Create: `apps/tv/assets/adaptive-icon-foreground.png` (Android adaptive icon, 1024×1024)
- Create: `apps/tv/assets/splash-icon.png` (launch screen; TV target differs from phone, verify with config-tv docs)
- Modify: `apps/tv/app.json` (add `ios.icon`, `android.icon`, `android.adaptiveIcon`, `splash.image`, and the `android:banner` reference for Leanback)

**Approach:**

- First check JFP brand kit (if accessible via Figma / asset repo) for existing high-resolution icons in Crimson Gallery aesthetic. Fall back to adapting mobile's icon if brand kit unavailable, with a one-line note in the commit that a design follow-up may be needed.
- tvOS App Store icon is a **layered** asset (up to 5 layers) — `expo-icon` or Fastlane can compose layers; for an internal prototype, a single-layer PNG at the required dimension is acceptable.
- Android TV banner must be 320×180 xhdpi PNG with a transparent-safe background; Play Store uses it as the Leanback launcher tile.

**Execution note:** Confirm via `eas build --profile preview --platform ios` (or `prebuild` only) produces an `.ipa` whose `Info.plist` references the tvOS icon at the correct path before Unit 6 ships. Asset paths silently dropping during prebuild is a known failure mode.

**Patterns to follow:**

- `apps/mobile/assets/` layout for icon variants.
- `apps/mobile/app.json` icon references.

**Test scenarios:**

- Test expectation: none (asset authoring is verified by ASC / Play Console accepting the submission in Unit 6). Automated checks could include a dimension-assertion script but are not worth the scaffolding for one-shot asset work.

**Verification:**

- All five asset files exist at the correct dimensions (`file apps/tv/assets/tvos-app-store-icon.png` reports `5120 x 2880`, etc.).
- `apps/tv/app.json` references all assets via relative paths.
- `EXPO_TV=1 npx expo prebuild --clean` in `apps/tv/` succeeds without asset warnings.

- [ ] **Unit 4: Create `apps/tv/eas.json` with `preview` build + submit profiles**

**Goal:** Produce the single `eas.json` file that makes the `preview` profile buildable and submittable to both stores, with `fingerprint` runtime policy, `EXPO_TV=1` in build env, and `appVersionSource: "remote"` to prevent duplicate-buildNumber rejections.

**Requirements:** R1, R2, R3 (via `environment` field), R4 (via `channel` field), R5 (via `env: { EXPO_TV: "1" }`)

**Dependencies:** Unit 1 (EAS project linked), Unit 3 (icons ready so first build doesn't bomb on missing assets).

**Files:**

- Create: `apps/tv/eas.json`

**Approach:**

Canonical shape (directional; implementer validates against Expo docs at build time):

```jsonc
{
  "cli": {
    "version": ">= 18.5.0",
    "appVersionSource": "remote",
  },
  "build": {
    "preview": {
      "distribution": "store",
      "channel": "preview",
      "environment": "preview",
      "autoIncrement": true,
      "env": { "EXPO_TV": "1" },
      "ios": { "simulator": false },
      "android": { "buildType": "app-bundle" },
    },
  },
  "submit": {
    "preview": {
      "ios": {
        "ascAppId": "<literal ASC App ID — numeric string from App Store Connect>",
        "ascApiKeyId": "<literal Key ID — 10-char alphanumeric from ASC>",
        "ascApiKeyIssuerId": "<literal Issuer ID — UUID from ASC>",
        "appleTeamId": "<literal JFP Team ID>",
      },
      "android": {
        "track": "internal",
        "releaseStatus": "draft",
        "changesNotSentForReview": false,
      },
    },
  },
}
```

> _This illustrates the intended shape and is directional guidance for review, not implementation specification. The implementing agent validates each field against current Expo docs and against what `eas build`/`eas submit --profile preview` actually accepts at the pinned EAS CLI version._

Key points the implementer must get right:

- `distribution: "store"` (not `"internal"` — that produces an ad-hoc `.ipa` TestFlight rejects).
- `channel: "preview"` binds the built binary to the EAS Update preview branch.
- `environment: "preview"` binds the profile to the `preview` EAS Environment in the Expo dashboard (where `EXPO_PUBLIC_*` values live).
- `env: { "EXPO_TV": "1" }` is **required** so EAS Build's prebuild step produces a tvOS-targeted native project, and so the fingerprint hash is stable between local and EAS.
- `android.buildType: "app-bundle"` is required (Play Console rejects new APKs).
- `submit.preview.android.track: "internal"` matches the Play Internal Testing track.
- `submit.preview.android.releaseStatus: "draft"` uploads as a draft that must be promoted manually — safer than `completed` which auto-publishes to testers. Change to `completed` once the process is trusted.

**Credentials handling — do not use `<env: VAR>` syntax:** `eas.json` fields accept literal values, not environment-variable placeholders. The ASC `.p8` file and Play service account JSON live in **EAS Credentials managed mode** (via `eas credentials`) rather than referenced from `eas.json` paths. When `eas submit` runs, it pulls the credentials from Expo's managed store — no local file paths, no env-var substitution in `eas.json`. This is why `ascApiKeyPath` and `serviceAccountKeyPath` are **omitted** from the shape above. Alternative (if managed mode isn't desired): upload the `.p8` and service-account JSON to the `preview` EAS Environment as Secret-file variables and reference them via `ascApiKeyPath: "./path-mounted-by-eas"` — but this requires knowing EAS Build's mount path, which is brittler. Prefer managed mode.

**Execution note:** Because `submit.preview.ios.ascAppId` requires the numeric ID that ASC assigns after the first tvOS app entry is created, pre-populate this during Phase 0 (when the ASC app entry is registered) so `eas.json` doesn't need a second commit after Unit 6.

**Patterns to follow:**

- `apps/mobile/eas.json` — overall file shape (but note the differences: TV uses `distribution: "store"`, adds a `submit` block, adds `env: { "EXPO_TV": "1" }`, uses `fingerprint` runtime via `app.json` not here).

**Test scenarios:**

- Test expectation: none — `eas.json` is configuration validated by `eas build:configure` / `eas build --profile preview` actually succeeding in Unit 6. A JSON-schema test isn't worth the scaffolding for a single file.

**Verification:**

- `eas build:configure --profile preview` (or equivalent `eas.json` lint) reports no schema errors.
- `eas build --profile preview --platform ios --local` (if feasible) or a cloud build produces an `.ipa` for tvOS.
- `eas build --profile preview --platform android` produces an `.aab` for Android TV.
- The produced binaries carry `channel: preview` (verifiable in the EAS dashboard build detail).

- [ ] **Unit 5: Populate EAS Environments with credentials and public env vars**

**Goal:** Put the ASC API key, Play service account JSON, and all `EXPO_PUBLIC_*` values in the right EAS Environment so `eas build` and `eas update` can find them non-interactively from Urim's machine.

**Requirements:** R2 (credentials storage), R3 (env values source), R6b (push authority bounded to org-account members)

**Dependencies:** Phase 0 complete (credentials obtained).

**Files:**

- No repo files modified directly. Work happens in the Expo dashboard at `https://expo.dev/accounts/<jfp-org>/projects/<tv-project-id>/environments`.
- Possibly modify `apps/tv/eas.json` if env-var names referenced there differ from the defaults.

**Approach:**

Two credential homes for two different kinds of secrets:

**1. ASC API key + Play service account JSON — managed by `eas credentials`** (recommended, per Unit 4's Credentials handling note). Run `eas credentials` from `apps/tv/` and upload the `.p8` file and service-account JSON interactively. EAS stores them in its managed credential store; `eas submit` pulls them at submission time. No local file path lives in `eas.json`. Rotation is a re-run of `eas credentials` pointing at the new file.

**2. `EXPO_PUBLIC_*` values — EAS Environment variables for the `preview` environment.** These are inlined into the JS bundle at build and OTA time:

| Variable                   | Value source                                    | Visibility                               |
| -------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `EXPO_PUBLIC_GRAPHQL_URL`  | Preview CMS URL                                 | Sensitive                                |
| `EXPO_PUBLIC_STRAPI_TOKEN` | If preview CMS requires auth (see caveat below) | Sensitive                                |
| `EXPO_TV`                  | `"1"`                                           | Plain (also set in `eas.json` build env) |

**Sensitive** = available to `eas build` and `eas update` at build/publish time, encrypted at rest, not displayed in dashboard UI. Matches mobile's documented pattern. Per `docs/solutions/mobile/expo-env-file-handling.md`, "secret"-visibility variables are **not** available during `eas update` — "sensitive" is the correct choice for variables that must reach OTA bundles.

**⚠ `EXPO_PUBLIC_*` variables are extractable from the installed binary.** Any `EXPO_PUBLIC_*` value is inlined by Metro into the JS bundle and readable by anyone who unpacks an installed `.ipa` or `.apk`. Apple TVs are shared household devices in many stakeholder homes, so treat the token as effectively public within the stakeholder pool. Implication: `EXPO_PUBLIC_STRAPI_TOKEN` must be scoped to **read-only** access on preview content and **must not** grant write or admin permissions. If the preview CMS exposes draft/unpublished content, revisit whether the token should be embedded at all vs fetched at runtime behind a lightweight auth proxy (out of current scope).

**EAS project membership — the concrete substance of R6b (push authority bounded):** the `preview` environment's access is limited to JFP Expo organization members with the **Developer** role or higher (verify against current Expo role definitions). If any external collaborator or personal account has access, remove them during Phase 0 before credentials are uploaded. Audit the member list any time a stakeholder is onboarded or offboarded.

**Execution note:** Do not check credential material into the repo. `.gitignore` already excludes `.env.production`, but the ASC `.p8` file and Play service account JSON should never land on disk outside EAS Environments' managed storage if at all possible. If a local copy is needed temporarily for `eas.json`'s `serviceAccountKeyPath`, keep it under `~/.secrets/` (not the repo) and rotate the key afterwards.

**Patterns to follow:**

- Mobile's existing `preview` and `production` EAS Environments (inspect in Expo dashboard for reference).

**Test scenarios:**

- Test expectation: none — operational configuration. Verified by Unit 6's first successful `eas submit`.

**Verification:**

- `eas env:list --environment preview` (run in `apps/tv/`) shows all expected variables with correct visibility.
- Dashboard access audit: only JFP org members have access to the TV project's `preview` environment.
- A dry `eas build --profile preview --platform ios` completes the env-resolution step without "env var not defined" errors for any `EXPO_PUBLIC_*` or ASC/Play credential.

- [ ] **Unit 6: First end-to-end build + submit + stakeholder install smoke test**

**Goal:** Execute the full ship sequence for the first time, confirm the build reaches TestFlight Internal Testing and Play Console Internal Testing, invite the 2–5 stakeholders, and verify at least one stakeholder of each platform can install and launch the app.

**Requirements:** R7, R9, R11; verifies R1, R2, R5 as a system

**Dependencies:** Units 1–5 complete. Phase 0 complete.

**Files:**

- No repo files modified. This unit is operational — it produces an installed app on stakeholder devices and an ASC/Play tester list, both outside the repo.

**Approach:**

1. Run `eas build --profile preview --platform all`. Expect ~15–30 min build time. Address any config errors surfaced here (most likely: missing asset, missing env var, EAS CLI version mismatch).
2. Once builds complete, run `eas submit --profile preview --platform all`. Expect:
   - iOS/tvOS: ~10–60 min ASC processing time (tvOS tends toward the longer end).
   - Android TV: ~minutes to a couple hours for Play Console to accept and distribute on Internal Testing track.
3. In App Store Connect, create the Internal Tester group for the TV app. Add the stakeholder Apple IDs (collected in Phase 0). They receive TestFlight invitation emails.
4. In Play Console, navigate to Internal Testing → Testers, add stakeholder Google accounts to the tester list, and copy the opt-in URL.
5. **Apple TV smoke test on real hardware**: one stakeholder (or Urim himself) installs the tvOS TestFlight app on an Apple TV, signs in with their invited Apple ID, accepts the invite, downloads the build, launches, and reaches the home screen. Document any friction points discovered (e.g., redemption-code typing on the on-screen keyboard) — this feeds into Unit 8's onboarding doc.
6. **Android TV smoke test on real hardware**: one stakeholder (or Urim himself) visits the Play opt-in URL on a Google account signed into an Android TV / Google TV, accepts the opt-in, installs via Play Store on TV, launches, reaches the home screen.
7. If either smoke test fails, triage before declaring the unit complete. Known friction: Apple TV TestFlight invite UX (redemption codes typed via on-screen keyboard), Android TV sideload-permission friction if the Play Store tile takes time to refresh.

**Execution note:** Budget 1–2 days of calendar time for this unit. ASC processing alone can consume most of a day; the first-time configuration rarely goes perfectly on the first try.

**Patterns to follow:**

- No direct code patterns — this is operational.

**Test scenarios:**

- Happy path: `eas build --profile preview --platform all` completes; `eas submit --profile preview --platform all` completes; both testers can install and launch the app.
- Error path (expected, document for Unit 8): Apple TV redemption code UX issues; ASC processing delays past the one-hour mark; Play Store tile not refreshing for 10+ minutes after tester opt-in.
- Integration scenario: the installed app successfully fetches from the preview CMS endpoint (proves Unit 5's env variables reached the binary).

**Verification:**

- Build artifacts visible in EAS dashboard for both platforms.
- TestFlight shows the build as "Ready to Test" under the Internal Testing group.
- Play Console shows the `.aab` as published to Internal Testing track with `releaseStatus: "completed"` (promoted from `draft` via the dashboard, per the Unit 4 Approach).
- Stakeholder A installs on Apple TV, reaches home screen, sees CMS-fetched content.
- Stakeholder B installs on Android TV, reaches home screen, sees CMS-fetched content.

- [ ] **Unit 7: First OTA push + `update:preview` script + fallback verification**

**Goal:** Ship a JS-only change to the already-installed stakeholder builds via `eas update --channel preview`, verify the change lands on next app launch, and document the one-command ship sequence as a `package.json` script.

**Requirements:** R4, R6a, R10

**Dependencies:** Unit 6 complete (stakeholders have installed binaries).

**Files:**

- Modify: `apps/tv/package.json` — add `update:preview` script with the explicit body below.

**Approach:**

**Do not literally copy mobile's `update:preview` script.** Mobile's script (verified) reads:

```
bash -c 'cp .env.local .env.local.bak 2>/dev/null; trap "mv .env.local.bak .env.local 2>/dev/null" EXIT; cp .env.production .env.local && touch src/env.ts && eas update --channel preview --message "preview update"'
```

This is incomplete for TV in two ways: (a) it omits `--environment preview` (which the cited learning `docs/solutions/mobile/expo-env-file-handling.md` says is required for the env-binding to resolve correctly), and (b) it lacks the `EXPO_TV=1` prefix that every other TV script carries — without it, Metro's local prebuild fingerprint will diverge from EAS Build's, and the OTA may target a runtime that no installed binary matches (eas-cli #3160, cited in Key Technical Decisions).

The TV script body should be:

```
bash -c 'EXPO_TV=1; cp .env.local .env.local.bak 2>/dev/null; trap "mv .env.local.bak .env.local 2>/dev/null" EXIT; cp .env.preview .env.local && touch src/env.ts && EXPO_TV=1 eas update --channel preview --environment preview --message "preview update"'
```

The local file copied is `.env.preview` (per Unit 2's renaming), not `.env.production`. Both `--channel preview` and `--environment preview` are passed. `EXPO_TV=1` is set before `eas update` so Metro produces a tvOS-targeted prebuild matching EAS Build's fingerprint.

Step-by-step:

1. Back up current `.env.local` if it exists; trap to restore on exit.
2. Copy `.env.preview` to `.env.local` so Metro inlines preview CMS URLs.
3. `touch src/env.ts` — busts Metro's cache so new env values re-inline.
4. Run `EXPO_TV=1 eas update --channel preview --environment preview --message "preview update"`.
5. Trap restores the original `.env.local`.

A minor behavioral change (e.g., swap a rail title string) is used for the first OTA smoke test so the update's arrival on stakeholder TVs is visually verifiable.

**Fallback behavior verification (R6a):**

- Enable airplane mode on a test Apple TV after the OTA was pushed; launch the app; confirm it falls back to the embedded bundle within a reasonable timeout (default `fallbackToCacheTimeout` is acceptable — document the chosen value in Unit 9 runbook).
- Re-enable network; launch the app; confirm the OTA is pulled on next launch.

**Execution note:** Push exactly one change for this unit and verify it manually reaches both Apple TV and Android TV before marking complete. Do not batch-test.

**Patterns to follow:**

- `apps/mobile/package.json` `update:preview` script.
- `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md` — the `touch src/env.ts` step.
- `docs/solutions/mobile/expo-env-file-handling.md` — passing both `--channel` and `--environment`.

**Test scenarios:**

- Happy path: `pnpm --filter @forge/tv update:preview` completes; stakeholder launches app; change is visible.
- Edge case (CDN failure): airplane-mode-on launch proceeds with embedded bundle rather than hanging on update check.
- Edge case (runtime mismatch): manually bump `runtimeVersion` fingerprint (by modifying a native config) and push OTA; confirm the update is **not** delivered to the installed build (which is correct and expected), and that Urim sees the channel divergence in the EAS dashboard.
- Error path: EAS Update CDN unreachable during push (rare; document the manual retry command).

**Verification:**

- `eas update --channel preview --environment preview` completes with a valid update ID.
- EAS dashboard shows the update on the `preview` channel with `runtimeVersion` matching the installed binary.
- Visible behavioral change reaches a test Apple TV and Android TV on next launch.
- Airplane-mode fallback confirms the app launches with the embedded bundle when update check fails.

- [ ] **Unit 8: Stakeholder-facing install and usage doc** _(Resume status: 7 of 8 sections drafted in `3bdc7fe` at `apps/tv/docs/stakeholder-install.md`; Section 7 (Troubleshooting) stubbed pending Unit 6 friction discoveries on real hardware)_

**Goal:** Write a single in-repo doc that a stakeholder can follow start-to-finish to (a) verify their TV is compatible, (b) accept invites and install the app, (c) confirm which version they're running, (d) understand what "the app will update itself" means, and (e) troubleshoot common friction points discovered in Unit 6's smoke tests.

**Requirements:** R6, R8

**Dependencies:** Unit 6 complete (so the doc reflects the actual install flow, not an assumed one).

**Files:**

- Create: `apps/tv/docs/stakeholder-install.md`

**Approach:**

Document structure (directional — adjust after Unit 6 reveals the actual UX):

1. **Before you start — device checklist.** (a) Apple TV model + tvOS version check (Settings → System → Software Updates → Update Software; must be on tvOS 16+). (b) Apple ID type: cannot be a child Apple ID under Family Sharing without an adult Apple ID providing approval; cannot be MDM-managed Apple Business Manager; Screen Time / Restrictions must allow app installation. (c) Android TV: confirm Play Store is present (rules out Fire TV, Roku, Tizen, webOS). (d) Links to `apple.com` / `google.com` support docs for changing Apple ID or enabling unknown apps on Android TV if applicable.
2. **Installing on Apple TV.** Step-by-step: (a) on a phone, install TestFlight; (b) on the Apple TV, open the App Store, search "TestFlight", install; (c) sign into TestFlight on the Apple TV with the invited Apple ID; (d) accept the TV-app invitation that appears in TestFlight; (e) install the build; (f) launch and confirm you see the JF logo splash.
3. **Installing on Android TV.** (a) Open the opt-in URL Urim shared on a device signed into the same Google account as the Android TV; (b) click "Accept invitation"; (c) on the Android TV, open Play Store, search for the app name; (d) install; (e) launch.
4. **Confirming your version.** How to open the Expo Dev Menu on tvOS (gesture / remote combo) and on Android TV to see the JS bundle version. Reference: R6 — no in-app UI surface was built for this.
5. **What updates look like.** Native updates arrive as a TestFlight prompt (Apple TV) or Play Store auto-update (Android TV). JS-only updates arrive silently on next app launch with no prompt. Both are normal.
6. **What the app going "stale" looks like.** TestFlight builds expire 90 days after upload; Urim ships a fresh keep-alive build every ~60 days. If the app refuses to launch on Apple TV with "This beta has expired", wait for Urim to ship a new build or contact Urim.
7. **Troubleshooting.** The concrete friction points discovered in Unit 6 go here: e.g., "If TestFlight on Apple TV doesn't show the invite, make sure you're signed in with the same Apple ID that received the email."
8. **If the app refuses to launch with "This beta has expired" on day 91+.** Explain that this is the 90-day TestFlight expiration (R12a). Action for the stakeholder: contact Urim — there is no self-service recovery. Action for Urim (documented in Unit 9 runbook): ship a keep-alive build; stakeholders install the update through TestFlight as if it were any other update. **Known risk**: if Urim is unavailable for 30+ days past the 60-day keep-alive cadence, all stakeholders lose access simultaneously with no fallback operator — this is an accepted gap per the plan's Scope Boundaries.
9. **Reporting issues.** Direct Slack ping to Urim; include the version string from step 4.

**Patterns to follow:**

- No direct in-repo pattern — this is the first stakeholder-facing doc in the TV app. Use Ankane's imperative-voice writing style as a loose reference (straightforward, step-by-step, no marketing tone).

**Test scenarios:**

- Test expectation: none — doc quality is verified by a dry-run: Urim hands the doc to one of the 2–5 stakeholders and watches them follow it. Completion time should match the R8 success criterion of under 10 minutes.

**Verification:**

- A stakeholder (other than Urim) installs the app on a real Apple TV using only this doc, in under 10 minutes.
- A stakeholder (other than Urim) installs on a real Android TV using only this doc, in under 10 minutes.
- The doc explicitly addresses every device-check scenario from R12b (Family Sharing, child Apple ID, Restrictions, MDM).

- [ ] **Unit 9: Operational runbook in `apps/tv/CLAUDE.md`** _(Resume status: full content drafted in `c80909d` as the new "Distribution & Release Operations" section in `apps/tv/CLAUDE.md`; verification gate (Urim re-reads after Unit 7 lands) is intentionally pending)_

**Goal:** Document the operational knowledge that future agents (human or AI) need to ship correctly: which changes qualify for OTA vs require a rebuild, how to read the `fingerprint` runtime version, the 60-day keep-alive cadence, the offboarding procedure, and the push-authority boundary.

**Requirements:** R7a, R12, R12a, R6b (documentation component)

**Dependencies:** Unit 7 complete (so the runbook reflects verified commands).

**Files:**

- Modify: `apps/tv/CLAUDE.md`

**Approach:**

Append a new section titled **"Distribution & Release Operations"** with subsections:

1. **Ship sequence**.
   - JS-only change: `pnpm --filter @forge/tv update:preview`.
   - Native change: `pnpm --filter @forge/tv exec eas build --profile preview --platform all && pnpm --filter @forge/tv exec eas submit --profile preview --platform all`.
   - How to tell which kind of change you have: if your diff touches `apps/tv/app.json`, `apps/tv/package.json` (dependencies), any file in `apps/tv/ios/` or `apps/tv/android/`, or any Expo config plugin, it is a native change and requires a rebuild. Otherwise it is JS-only and OTA is correct.
2. **Runtime version policy: `fingerprint`**. Why it diverges from `apps/mobile/`'s `sdkVersion`, how to check the current fingerprint (`eas build:inspect` or `npx expo-updates fingerprint:generate`), and what bumps the hash.
3. **60-day keep-alive cadence**. TestFlight builds expire 90 days after upload. To avoid silent stakeholder lockout, ship a fresh native build every ≤ 60 days even if no native changes landed. Set a calendar reminder. If the cadence slips past 70 days, proactively notify stakeholders before the build expires.
4. **Offboarding a stakeholder**. Remove from the ASC Internal Tester group (stops receiving new TestFlight builds). Remove from the Play Console Internal Testing tester list (stops receiving new Play updates). **EAS Update has no per-user revocation** — the installed build on the stakeholder's TV continues to receive OTA pushes from the `preview` channel until the stakeholder uninstalls the app. This is a known limitation; if hard-revocation is needed, retire the `preview` channel entirely or implement a server-side feature flag check inside the app (out of scope here).
5. **Push authority**. Only members of the JFP Expo organization with the **Developer** role or higher can push to the `preview` channel via `eas update` (verify against current Expo role definitions when granting). Member list is set during Phase 0 and audited at the same cadence as ASC/Play tester lists. **Compensating controls during the codesigning deferral**: HTTPS-only EAS CDN transport, EAS org membership gate, and credential rotation on personnel change. `expo-updates` codesigning is **not** configured — revisit if/when a `production` channel is introduced **or** if stakeholder count grows past 5 **or** if the app fetches authenticated/sensitive user data.
6. **Credential rotation**. Rotate ASC API keys in ASC → Integrations and Play service account keys in GCP IAM; update the corresponding EAS Environments secret-file variables and revoke the old keys. Default cadence: rotate on personnel change (any team membership change in JFP's ASC/Play/Expo orgs) and on suspected compromise. ASC API keys have a 1-year hard expiry and require rotation before then; calendar a reminder. Play service account keys do not have a hard expiry — rotate annually.

**Patterns to follow:**

- `apps/mobile/CLAUDE.md`'s structure if an equivalent Operations section exists there.
- Rest of `apps/tv/CLAUDE.md` — keep the section style consistent (imperative voice, tight bullets).

**Test scenarios:**

- Test expectation: none — runbook quality is verified by Urim re-reading the appended section once after writing and confirming all six operational questions (ship sequence, fingerprint check, keep-alive, offboarding, push authority, credential rotation) are answered without reference to any other document. Solo-operator scope makes a heavier verification gate (e.g., spawning a second agent) gold-plating.

**Verification:**

- Every operational concern raised in the origin doc (R6b push authority, R7a offboarding, R12 policy, R12a keep-alive) is addressed in at least one subsection.

## System-Wide Impact

- **Interaction graph:** New EAS project linkage in `apps/tv/app.json` — no runtime callbacks. The `expo-updates` dep adds an app-launch-time update check; existing `getApolloClient()` lazy initialization must continue to work after the update check resolves. `app/_layout.tsx` already runs env resolution early; Unit 2's try/catch defense ensures an env-resolution failure during an OTA rollout does not hard-crash the app before the error boundary renders.
- **Error propagation:** OTA update failures fall back to the embedded bundle (R6a). Env-resolution failures (Metro inlining regression) fall back to a visible error boundary rather than a white screen (Unit 2). ASC submission failures surface as `eas submit` command errors; Play submission failures similarly — both return to Urim's terminal, not to stakeholders.
- **State lifecycle risks:** EAS Update has no per-user revocation (documented in Unit 9). Runtime-version mismatch could leave a stakeholder on stale JS silently if `fingerprint` hashes diverge unexpectedly — Unit 7's edge-case test verifies that divergent fingerprints correctly withhold the update. 90-day TestFlight build expiration is a hard state-lifecycle boundary (Unit 9 keep-alive cadence is the mitigation).
- **API surface parity:** No public API changes. The TV app's GraphQL consumption pattern is unchanged; only the build/distribution layer is modified.
- **Integration coverage:** The cross-layer scenario worth proving at the system level is "OTA push → stakeholder-installed binary → stakeholder sees new bundle". Unit 7's verification covers this end-to-end on real Apple TV and real Android TV. Mocks and local Metro bundling do not substitute.
- **Unchanged invariants:** The SDUI pipeline (normalizer → dispatcher → renderers), `apps/mobile/` distribution setup, repo-root `eas.json` (orphan, unmodified), `@react-native-tvos/config-tv` plugin behavior, `tvosDeploymentTarget: "16.0"`, `newArchEnabled: false`. This plan explicitly does not touch any runtime behavior in `apps/tv/src/` or `apps/tv/app/` beyond the Metro-inlining env handling in Unit 2.

## Risks & Dependencies

| Risk                                                                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple TV TestFlight invite redemption UX fails for one or more stakeholders (known flaky on-screen keyboard flow)                                                                                                                | Unit 6 includes a real-hardware smoke test before declaring the unit complete; Unit 8 documents the known friction points; if a stakeholder cannot complete invite redemption, fall back to the TestFlight iOS app's "Redeem" button (works cross-device for the same Apple ID)                                                              |
| ASC processing for first tvOS submission blocks for more than 1 hour                                                                                                                                                             | Unit 6 allocates 1–2 days of calendar time explicitly; no downstream unit depends on the first ASC submission succeeding quickly                                                                                                                                                                                                             |
| First tvOS submission queued for **Beta App Review** despite internal-testers-only (Apple occasionally does this for new tvOS apps)                                                                                              | Unit 6 calendar budget accommodates a 1–3 business-day review wait; if it hits, no action required beyond waiting. Submit Unit 6's first build as early as possible in Phase 3 so the wait doesn't block a stakeholder demo deadline                                                                                                         |
| tvOS App Store icon rejected because ASC requires **layered `.imagestack`** format (parallax-capable), not flat 5120×2880 PNG                                                                                                    | Unit 3 produces a flat PNG as the default; if ASC rejects in Unit 6, fall back to authoring a layered asset via `expo-icon` or an asset catalog. Budget one extra ASC processing cycle (~1 day) if the flat PNG fails                                                                                                                        |
| `runtimeVersion: fingerprint` hash drifts between local and EAS Build from sources other than `EXPO_TV=1` — e.g., Node version, pnpm lockfile resolution, optional-dep platform differences                                      | Pin Node version in `eas.json` build image config (`image: "latest"` is insufficient — use explicit `node: "22.x"`); pnpm is already pinned via `packageManager` in root `package.json`; Unit 7 verification step diffs `npx expo-updates fingerprint:generate` output against the EAS Build log's fingerprint before declaring OTA verified |
| `fingerprint` policy + `appVersionSource: "remote"` + `autoIncrement: true` interact to produce a new runtime hash on every native rebuild (via changed `CFBundleVersion` in Info.plist), orphaning previous builds' OTA channel | Unit 6 or Unit 7 verifies with two consecutive native builds whether their fingerprint hashes differ. If they do, either (a) exclude version fields from fingerprint via `fingerprint.config.js`, or (b) accept that each native rebuild retires the prior binary's OTA lane (acceptable when native builds are infrequent, by design)       |
| Bundle-ID `org.jesusfilm.forgetv` is already registered by a legacy JFP app or a similarly-named slug triggers ASC's "similar to existing app" flag                                                                              | Phase 0 includes an explicit audit step; if conflict found, either transfer ownership (if legacy) or re-namespace (e.g., `org.jesusfilm.forgetvapp`) as a fallback                                                                                                                                                                           |
| `fingerprint` runtime hash differs between local and EAS Build environments, producing an OTA push that never reaches installed binaries                                                                                         | `EXPO_TV=1` is set in both local dev (documented) and `eas.json` build profile env; Unit 7 edge-case test verifies the push is correctly delivered to builds with matching fingerprint                                                                                                                                                       |
| Metro env-inlining regression causes white screen on first OTA                                                                                                                                                                   | Unit 2 ports the PR #703 defenses proactively; Unit 7 includes a pre-flight verification that `EXPO_PUBLIC_*` values are inlined                                                                                                                                                                                                             |
| Play Console requires a TV banner asset we don't have in the brand kit                                                                                                                                                           | Unit 3 treats asset sourcing as implementation-time discovery; 320×180 is small enough that a hand-authored placeholder is acceptable for Internal Testing                                                                                                                                                                                   |
| JFP admin granting ASC/Play Console access takes 2+ weeks of async chase                                                                                                                                                         | Phase 0 is acknowledged as a blocking calendar-time risk in the origin doc; no mitigation within this plan — treat as a scheduling constraint                                                                                                                                                                                                |
| Service account JSON or ASC `.p8` accidentally committed to git                                                                                                                                                                  | `.gitignore` already excludes `.env.*` except explicitly allowed; Unit 5 documents that credential material is stored in EAS Environments only; pre-commit hooks (not added here, but existing in the monorepo) catch secrets                                                                                                                |
| Stakeholder list grows past the 100-tester Internal Testing cap                                                                                                                                                                  | No mitigation needed at 2–5 audience size; origin doc notes this as a silent ceiling. When the list reaches ~50, migrate to external TestFlight + Closed Play testing (separate future plan)                                                                                                                                                 |
| Urim unavailable during a stakeholder demo, native rebuild needed                                                                                                                                                                | Explicitly out of scope. Success Criteria acknowledges shipping does not survive Urim's absence                                                                                                                                                                                                                                              |

## Documentation / Operational Notes

- **`apps/tv/docs/stakeholder-install.md`**: new, stakeholder-facing. Written in Unit 8.
- **`apps/tv/CLAUDE.md`**: modified to include Distribution & Release Operations section. Written in Unit 9.
- **Monitoring**: none in this plan. Origin explicitly deferred crash reporting, analytics, and remote logging. Monitor stakeholder reports via Slack instead.
- **Rollout**: no feature flag, no gradual rollout — audience is 2–5 internal stakeholders, the feature IS the rollout.
- **After Unit 9 complete**: consider documenting this as a learning under `docs/solutions/mobile/` (the existing precedent location for EAS / TestFlight / Play patterns; a new `docs/solutions/tv/` directory does not earn its keep until there are multiple TV-specific solutions to organize). Draft tentative title: `docs/solutions/mobile/tv-internal-stakeholder-distribution-setup-YYYYMMDD.md`.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-21-tv-internal-stakeholder-distribution-requirements.md](../brainstorms/2026-04-21-tv-internal-stakeholder-distribution-requirements.md)
- **Related in-repo docs:**
  - `apps/tv/CLAUDE.md` (TV app conventions)
  - `apps/mobile/CLAUDE.md` (mobile distribution precedent)
  - `apps/mobile/eas.json` (profile shape reference)
  - `apps/mobile/app.json` (EAS linkage reference)
  - `apps/mobile/src/env.ts` + `apps/mobile/app/_layout.tsx` (Metro inlining defense reference)
  - `apps/mobile/package.json` (`update:preview`, `fetch-secrets` scripts)
  - `apps/mobile/.env.example` (Doppler + EAS Environments pattern)
  - `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md` (why mobile used EAS Update over TestFlight; does not transfer to TV)
  - `docs/solutions/mobile/expo-env-file-handling.md` (EAS "secret" vs "sensitive" visibility; `--channel` + `--environment` both required)
  - `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md` (PR #703 white-screen fix — port to TV in Unit 2)
  - `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` (`skipValidation: !!CI && !EAS_BUILD` pattern)
  - `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` (`EXPO_TV=1` + tvOS deployment target)
- **Related PRs:**
  - [PR #592](https://github.com/jesus-film-project/forge/pull/592) — original mobile EAS Update setup
  - [PR #703](https://github.com/jesus-film-project/forge/pull/703) — Metro inlining white-screen fix
  - [PR #633](https://github.com/jesus-film-project/forge/pull/633) — removal of EAS from CI (policy this plan preserves)
  - [PR #776](https://github.com/jesus-film-project/forge/pull/776) — TV Metro `watchFolders` scoping
  - [PR #731](https://github.com/jesus-film-project/forge/pull/731) — TV app prototype (no distribution wired)
- **External docs:** EAS Submit intro, Submit iOS, Submit Android, `eas.json` reference, runtime versions, fingerprint policy, Building for TV, EAS environment variables, TestFlight tvOS, Google Play target API, Data Safety, Play tester tracks (URLs in Context & Research → External References above).
