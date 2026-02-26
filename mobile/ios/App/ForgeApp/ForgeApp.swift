import SwiftUI
import ForgeMobile

@main
struct ForgeApp: App {
  var body: some Scene {
    WindowGroup {
      ForgeRootView(contentRepository: AppContentRepositoryFactory.makeContentRepository())
    }
  }
}
