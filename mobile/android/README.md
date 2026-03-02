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

Create `mobile/android/local.properties` (git-ignored) and add your token:

```properties
graphql.token=your-token-here
```

The build reads `graphql.token` at compile time via `local.properties` so the
token is never committed to version control. Note: it is compiled into
`BuildConfig` and therefore exists in the APK binary — do not use a
long-lived privileged token here; prefer a short-lived or scoped one. The
endpoint is hardcoded to `https://cms.forge.dev/graphql`; override it in
`app/build.gradle.kts` if needed.

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
