# mobile/android

Native Kotlin + Jetpack Compose app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Requirements

- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34 (`compileSdk` = `targetSdk` = 34)

## Local build

```bash
cd mobile/android

# Debug APK
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk

# Install on connected device / emulator
./gradlew installDebug
```

## Startup screen

`MainActivity` renders a centred "Forge Android" label via Jetpack Compose.
Replace with real feature screens once data integration is wired.
