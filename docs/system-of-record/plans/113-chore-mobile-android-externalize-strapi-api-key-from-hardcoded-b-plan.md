---
artifactType: plan
sourceIssueNumber: 113
sourceIssueTitle: "chore(mobile-android): externalize Strapi API key from hardcoded buildConfigField"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/113"
linkedPrs: []
---

# Plan Artifact: #113

## Objective

The Strapi API token and GraphQL endpoint are no longer hardcoded in any tracked file. Local devs use `local.properties` (gitignored), CI uses environment variables. No Kotlin source changes needed — `BuildConfig` fields work identically at runtime.

## Planned approach

1. **Gradle `local.properties` loader (recommended)** — load from `local.properties` first, fall back to `System.getenv()`, then safe defaults. Forward-compatible with Doppler since Doppler sets env vars.
2. **Gradle `-P` flags** — use `project.findProperty()` with CLI flags. Less ergonomic for daily dev.
3. **Future: Doppler** — `doppler run -- ./gradlew assembleDebug` injects env vars automatically. Option 1 is forward-compatible with this.

## Validation

- [ ] `app/build.gradle.kts` reads `GRAPHQL_ENDPOINT` and `GRAPHQL_TOKEN` from `local.properties` → env var → safe default
- [ ] `local.properties` is added to root `.gitignore`
- [ ] `local.properties.example` added to `mobile/android/` with documented placeholder keys
- [ ] `mobile/android/AGENTS.md` "Auth pattern" section updated to document new flow
- [ ] `mobile/android/README.md` "Configuration" section updated
- [ ] `./gradlew assembleDebug` succeeds with values in `local.properties`
- [ ] `./gradlew assembleDebug` succeeds with env vars (when `local.properties` keys absent)
- [ ] `./gradlew assembleDebug` succeeds with neither (safe defaults)
- [ ] No Kotlin source files changed

## Source links

- Issue: [#113](https://github.com/JesusFilm/forge/issues/113)
- PRs:
- None
