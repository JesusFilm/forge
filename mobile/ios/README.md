# mobile/ios

Native SwiftUI app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Building

### Xcode

1. Open the app project: `ForgeApp.xcodeproj` (in this directory).
2. Select the **ForgeApp** scheme and a simulator or device.
3. Press **Run** (⌘R).

The app depends on the local **ForgeMobile** Swift package in this repo. Xcode resolves it automatically when you open the project.

### Command line

From this directory (`mobile/ios`):

```bash
# List schemes
xcodebuild -list

# Build for a specific simulator (e.g. iPhone 16)
xcodebuild -scheme ForgeApp -destination 'platform=iOS Simulator,name=iPhone 16' build

# Build for a generic iOS Simulator destination
xcodebuild -scheme ForgeApp -destination 'generic/platform=iOS Simulator' build
```
