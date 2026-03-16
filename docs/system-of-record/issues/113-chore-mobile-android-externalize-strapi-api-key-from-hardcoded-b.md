---
artifactType: issue
issueNumber: 113
issueTitle: "chore(mobile-android): externalize Strapi API key from hardcoded buildConfigField"
issueUrl: "https://github.com/JesusFilm/forge/issues/113"
state: "CLOSED"
closedAt: "2026-03-02T04:19:21Z"
labels: ["chore", "mobile-android"]
linkedPrs: []
---

# Issue Artifact: #113

## Background

The Android app (`mobile/android`) authenticates to the Strapi CMS GraphQL endpoint using a bearer token. Currently the endpoint URL and API token are hardcoded as string literals in `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "GRAPHQL_ENDPOINT", "\"https://cms.forge.dev/graphql\"")
buildConfigField("String", "GRAPHQL_TOKEN", "\"\"")
```

Any developer who needs a working token must edit a tracked file, risking committing secrets to version control. The web app already follows a safer pattern — it reads `STRAPI_API_TOKEN` from environment variables (`apps/web/src/env.ts`).

Additionally, `local.properties` is not in `.gitignore`, relying only on the fact it hasn't been added — this is fragile.

This is groundwork for a future migration to Doppler for centralized secrets management.

## Expected outcome

The Strapi API token and GraphQL endpoint are no longer hardcoded in any tracked file. Local devs use `local.properties` (gitignored), CI uses environment variables. No Kotlin source changes needed — `BuildConfig` fields work identically at runtime.

## Acceptance criteria

- [ ] `app/build.gradle.kts` reads `GRAPHQL_ENDPOINT` and `GRAPHQL_TOKEN` from `local.properties` → env var → safe default
- [ ] `local.properties` is added to root `.gitignore`
- [ ] `local.properties.example` added to `mobile/android/` with documented placeholder keys
- [ ] `mobile/android/AGENTS.md` "Auth pattern" section updated to document new flow
- [ ] `mobile/android/README.md` "Configuration" section updated
- [ ] `./gradlew assembleDebug` succeeds with values in `local.properties`
- [ ] `./gradlew assembleDebug` succeeds with env vars (when `local.properties` keys absent)
- [ ] `./gradlew assembleDebug` succeeds with neither (safe defaults)
- [ ] No Kotlin source files changed

## Possible solution(s)

1. **Gradle `local.properties` loader (recommended)** — load from `local.properties` first, fall back to `System.getenv()`, then safe defaults. Forward-compatible with Doppler since Doppler sets env vars.
2. **Gradle `-P` flags** — use `project.findProperty()` with CLI flags. Less ergonomic for daily dev.
3. **Future: Doppler** — `doppler run -- ./gradlew assembleDebug` injects env vars automatically. Option 1 is forward-compatible with this.

## References

- `mobile/android/app/build.gradle.kts` (current hardcoded values)
- `mobile/android/AGENTS.md` (auth pattern docs)
- `apps/web/src/env.ts` (reference pattern for env-var secrets)
- `.github/workflows/ci.yml` line 87 (`STRAPI_API_TOKEN: ci-placeholder` pattern)
- Related: #81 (GraphQL consumption implementation)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
