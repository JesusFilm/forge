# mobile/ios

Native SwiftUI app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Local build

The app target lives in `App/ForgeMobileApp.xcodeproj` and depends on the `ForgeMobile` Swift package in this directory.

**From Xcode**

1. Open `App/ForgeMobileApp.xcodeproj` in Xcode.
2. Select the **ForgeMobileApp** scheme.
3. Choose a simulator or device and press Run (⌘R).

**From the command line**

From `mobile/ios/App`:

```bash
xcodebuild -scheme ForgeMobileApp -destination 'platform=iOS Simulator,name=iPhone 15' build
```

To run on a different simulator, list runtimes with `xcrun simctl list devices` and use the desired name in `-destination 'platform=iOS Simulator,name=<DeviceName>'`.

Requires Xcode 15 or later. The example above uses iPhone 15, which ships with Xcode 15 and 16 by default.
