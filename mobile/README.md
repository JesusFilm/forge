# mobile

Native apps in same repo, outside Turborepo task graph.

- `ios/`: SwiftUI
- `android/`: Kotlin + Jetpack Compose

Both consume shared contracts/clients only.

## Local builds

- **iOS**: See [ios/README.md](ios/README.md) for building the app via Xcode or `xcodebuild` (scheme **ForgeMobileApp**, project in `ios/App/`).
- **Android**: See [android/README.md](android/README.md) for `./gradlew assembleDebug` and `installDebug`.
