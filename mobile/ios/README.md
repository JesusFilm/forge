# mobile/ios

Native SwiftUI app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Building

### Xcode

1. Open the app project: `ForgeApp.xcodeproj` (in this directory).
2. Select the **ForgeApp** scheme and a simulator or device.
3. Press **Run** (⌘R).

App source lives under **Sources/App**; the **ForgeMobile** library is in **Sources/ForgeMobile**. The app target depends on the local ForgeMobile Swift package; Xcode resolves it automatically when you open the project.

### Command line

From this directory (`mobile/ios`). Requires **Xcode 16+** (Swift 6). Use `-project ForgeApp.xcodeproj` so `xcodebuild` targets the app project and not the Swift package in the same directory:

```bash
# List schemes
xcodebuild -project ForgeApp.xcodeproj -list

# Build for a specific simulator (e.g. iPhone 16)
xcodebuild -project ForgeApp.xcodeproj -scheme ForgeApp -destination 'platform=iOS Simulator,name=iPhone 16' build

# Build for a generic iOS Simulator destination
xcodebuild -project ForgeApp.xcodeproj -scheme ForgeApp -destination 'generic/platform=iOS Simulator' build
```
