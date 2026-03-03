# mobile/android

Native Kotlin + Jetpack Compose app with Apollo Kotlin GraphQL client.
Outside Turborepo graph.

Consumes the CMS GraphQL API via platform-owned operations and generated
client artifacts (Apollo Kotlin codegen). Operations are NOT shared with iOS.

## Requirements

- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34 (`compileSdk` = `targetSdk` = 34)

## Local build

```bash
cd mobile/android

# Debug APK (includes Apollo codegen)
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk

# Install on connected device / emulator
./gradlew installDebug
```

## GraphQL integration

| Item              | Detail                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| Schema source     | `apps/cms/schema.graphql` (read directly; not committed to `mobile/android`) |
| Codegen tool      | Apollo Kotlin 4.1.0                                                          |
| Generated package | `com.forge.mobile.graphql`                                                   |
| Operations        | `ExperienceBySlug.graphql`, `Experiences.graphql`                            |
| Client adapter    | `GraphQLContentClient` implements `ContentClient`                            |
| Auth              | Bearer token via `AuthInterceptor` HTTP interceptor                          |

### Configuration

The build resolves `GRAPHQL_ENDPOINT` and `GRAPHQL_TOKEN` using a three-tier
fallback chain:

1. **`local.properties`** — `graphql.endpoint` / `graphql.token` (gitignored, never committed)
2. **Environment variables** — `STRAPI_GRAPHQL_ENDPOINT` / `STRAPI_GRAPHQL_TOKEN` (CI / containers)
3. **Defaults** — `https://cms.forge.dev/graphql` / empty string

Copy the example file to get started:

```bash
cp local.properties.example local.properties
# then edit local.properties with your values
```

Note: the token is compiled into `BuildConfig` and therefore exists in the APK
binary — do not use a long-lived privileged token here; prefer a short-lived
or scoped one.

## Pre-task workflow

The CMS schema is shared across web, Android, and iOS and changes frequently.
**Before starting any task**, run through these steps:

```bash
# 1. Fetch latest and rebase your branch
git fetch origin
git rebase origin/main

# 2. Rebuild to run Apollo codegen against the latest schema
cd mobile/android
./gradlew assembleDebug

# 3. If build fails at compileDebugKotlin, check generated types
#    Generated types live in:
#    app/build/generated/source/apollo/forge/com/forge/mobile/graphql/
#
#    Compare against Kotlin source files that reference them
#    (e.g. GraphQLContentClient.kt) and fix mismatches.
```

### Common schema-change breakages

- **Renamed/removed fields** — Apollo codegen drops them from generated classes;
  Kotlin code referencing old names won't compile.
- **Nullability changes** — A field changing from `String` to `String?` (or vice
  versa) requires updating call sites with safe calls (`?.`) or removing them.
- **New union/dynamic-zone members** — `Section` gains a new
  `onComponentSections*` field; existing `when`/`mapNotNull` blocks may need a
  new branch.

### Apollo 4 type pattern

Apollo 4 does **not** generate sealed class subtypes for inline fragments.
Instead it generates a wrapper with nullable fields:

```kotlin
// CORRECT — use nullable field access
section?.onComponentSectionsCta?.heading

// WRONG — there is no subtype to cast to
section is ExperienceBySlugQuery.ComponentSectionsCtaSections
```

## Parity checklist (Android ↔ iOS)

| Concern                              | Android                                          | iOS                                          |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------------- |
| Locale passed to query               | ✅ `locale` param on every query                 | ✅ `locale` param on every query             |
| Error handling — network             | Apollo throws on network failure; caller handles | URLSession/Apollo iOS throws; caller handles |
| Error handling — GraphQL errors      | `response.errors` checked after execute          | `GraphQLResult.errors` checked after fetch   |
| Required fields — documentId, slug   | Non-null in schema; guaranteed by codegen        | Non-null in schema; guaranteed by codegen    |
| Required fields — title (Video)      | Non-null in schema                               | Non-null in schema                           |
| Nullable fields — locale, isHomepage | Handled with fallback defaults                   | Handled with fallback defaults               |
| Auth header format                   | `Authorization: Bearer <token>`                  | `Authorization: Bearer <token>`              |
| Pagination                           | `page` / `pageSize` args                         | `page` / `pageSize` args                     |
| No shared operation files            | ✅ operations in `mobile/android/` only          | ✅ operations in `mobile/ios/` only          |
