# mobile/ios

Native SwiftUI app. Outside Turborepo graph.

Integrates via **ContentClient**. A GraphQL implementation is provided: **GraphQLContentClient** (endpoint URL + optional bearer token). Construct it with your CMS GraphQL URL (e.g. dev/stage/prod) and pass it to `ContentRepository(client:)`. The app uses **MVVM**: views depend only on **ViewModels**; ViewModels own the repository and expose state and actions (e.g. `WatchHomeViewModel` and `load(locale:)`).

**ForgeMobile library layout** (under `Sources/ForgeMobile/`): **Data/** — `ContentRepository`, `GraphQLContentClient`, `ContentClient`, `MobileContentItem`; **ViewModels/** — screen ViewModels (e.g. `WatchHomeViewModel`); **Views/** — SwiftUI views (e.g. `ForgeRootView`); **Generated/** — Apollo-generated types and operations (do not edit).

## Building and running

**Preferred: SweetPad (Cursor / VS Code)** — Open the **forge** repo root in Cursor or VS Code with the [SweetPad](https://sweetpad.hyzyla.dev/) extension installed. The repo is configured so SweetPad uses `mobile/ios/App/ForgeApp.xcodeproj`. In the SweetPad sidebar, open **Build**, then click **Build & Run** (▶️) next to the **ForgeApp** scheme; choose a simulator or device when prompted. You can also run **Tasks: Run Task** → **SweetPad: Build and Run (ForgeApp)** from the Command Palette.

### Xcode

1. Open the app project: `App/ForgeApp.xcodeproj` (in this directory).
2. Select the **ForgeApp** scheme and a simulator or device.
3. Press **Run** (⌘R).

App source lives under **App/ForgeApp/**; the **ForgeMobile** library is in **Sources/ForgeMobile**. The app target depends on the local ForgeMobile Swift package (one level up from the project); Xcode resolves it automatically when you open the project.

**Local Strapi with API token:**

- **Debug (e.g. run from Cursor/SweetPad):** A build-phase script reads `STRAPI_FULL_ACCESS_TOKEN` from `apps/cms/.env` and attaches it to GraphQL requests. Ensure `apps/cms/.env` has that variable set; no Xcode scheme setup needed.
- **Release:** The script never embeds a token (always `nil`), so the shipped binary stays safe. Use a backend or runtime token for production.

You can still override by setting the **environment variable** `STRAPI_FULL_ACCESS_TOKEN` in the run scheme (Edit Scheme → Run → Environment Variables); the app uses env first, then the generated value.

If you see **"Error: Forbidden access"**, the request is reaching Strapi without a valid token—for Debug from Cursor, add `STRAPI_FULL_ACCESS_TOKEN` to `apps/cms/.env` and rebuild.

**Info plists and App Store:** **Debug** builds use `Info-Debug.plist` (allows HTTP to localhost for local Strapi). **Release** builds (including **Archive** for App Store Connect) use `Info-Release.plist`, which has no ATS exception, so the shipped app is ATS-clean for review.

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

## GraphQL and codegen

The **ForgeMobile** package uses [Apollo iOS](https://www.apollographql.com/docs/ios/) for the CMS GraphQL client. Schema and operations:

- **Schema**: `apps/cms/schema.graphql` (repo root).
- **Operations**: `GraphQL/Operations/*.graphql` (e.g. `GetWatchExperience.graphql`).
- **Generated Swift**: `Sources/ForgeMobile/Generated/` (do not edit by hand).

To regenerate after schema or operation changes, **run from `mobile/ios`** (required: the schema path in config is relative and is resolved from the current working directory):

1. Install the Apollo CLI (once):  
   `swift package --allow-writing-to-package-directory --allow-network-connections all apollo-cli-install`
2. Generate:  
   `./apollo-ios-cli generate -p apollo-codegen-configuration.json`

Config: `apollo-codegen-configuration.json` (embedded in ForgeMobile target; `schemaSearchPaths` uses `../../apps/cms/schema.graphql`). Any CI or script that runs codegen must use `mobile/ios` as the working directory.
