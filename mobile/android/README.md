# mobile/android

Native Kotlin + Jetpack Compose app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Local build

From `mobile/android`:

```bash
./gradlew assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. To install and run on a connected device or emulator:

```bash
./gradlew installDebug
```

Requires a JDK (17+) and Android SDK; Android Studio or the command-line tools are sufficient.
