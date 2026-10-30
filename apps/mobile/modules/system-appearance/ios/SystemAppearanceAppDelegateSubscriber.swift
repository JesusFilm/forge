import ExpoModulesCore
import UIKit

public class SystemAppearanceAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  // willFinishLaunching runs before React Native starts and before any scene connects,
  // so the store sees the first scene connect.
  public func application(
    _ application: UIApplication,
    willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    SystemAppearanceStore.shared.start()
    // true keeps the default, so iOS still opens a launch URL.
    return true
  }

  // Without a scene manifest, the window can join its scene only during launch.
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    SystemAppearanceStore.shared.refresh(nil)
    return true
  }
}
