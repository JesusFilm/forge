# mobile/android

Native Kotlin + Jetpack Compose app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Prerequisites

- Java 17+
- Android SDK with compileSdk 34

## Build

```sh
# Debug APK
./gradlew :app:assembleDebug

# Run on connected device/emulator
./gradlew :app:installDebug
```

## Lint

```sh
./gradlew ktlintCheck
```
