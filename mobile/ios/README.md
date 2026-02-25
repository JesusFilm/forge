# mobile/ios

Native SwiftUI app. Outside Turborepo graph.

Integrates via ContentClient; implement using `packages/graphql` GraphQL types.

## Building and running

**Preferred: SweetPad (Cursor / VS Code)** — Open the **forge** repo root in Cursor or VS Code with the [SweetPad](https://sweetpad.hyzyla.dev/) extension installed. The repo is configured so SweetPad uses `mobile/ios/App/ForgeApp.xcodeproj`. In the SweetPad sidebar, open **Build**, then click **Build & Run** (▶️) next to the **ForgeApp** scheme; choose a simulator or device when prompted. You can also run **Tasks: Run Task** → **SweetPad: Build and Run (ForgeApp)** from the Command Palette.

### Xcode

1. Open the app project: `App/ForgeApp.xcodeproj` (in this directory).
2. Select the **ForgeApp** scheme and a simulator or device.
3. Press **Run** (⌘R).

App source lives under **App/ForgeApp/**; the **ForgeMobile** library is in **Sources/ForgeMobile**. The app target depends on the local ForgeMobile Swift package (one level up from the project); Xcode resolves it automatically when you open the project.

### Command line

From this directory (`mobile/ios`). Requires **Xcode 16+** (Swift 6). Point `xcodebuild` at the app project in `App/`:

```bash
# List schemes
xcodebuild -project App/ForgeApp.xcodeproj -list

# Build for a specific simulator (e.g. iPhone 16)
xcodebuild -project App/ForgeApp.xcodeproj -scheme ForgeApp -destination 'platform=iOS Simulator,name=iPhone 16' build

# Build for a generic iOS Simulator destination
xcodebuild -project App/ForgeApp.xcodeproj -scheme ForgeApp -destination 'generic/platform=iOS Simulator' build
```
