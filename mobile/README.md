# mobile

Native and cross-platform apps in same repo, outside Turborepo task graph.

- `ios/`: SwiftUI (native iOS)
- `android/`: Kotlin + Jetpack Compose (native Android)
- `expo/`: React Native + Expo (cross-platform iOS and Android)

Native apps consume shared contracts/clients only. The Expo app is a separate surface (see epic #89).

## Local builds

- **iOS (native):** See [ios/README.md](ios/README.md) for building via Xcode or `xcodebuild` (scheme **ForgeMobileApp**, project in `ios/App/`).
- **Android (native):** See [android/README.md](android/README.md) for `./gradlew assembleDebug` and `installDebug`.
- **Expo (cross-platform):** See [expo/README.md](expo/README.md) for `pnpm start` and iOS/Android targets.
