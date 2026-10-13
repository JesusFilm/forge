import ExpoModulesCore
import UIKit

public class LayoutDirectionAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  // willFinishLaunching runs before the app delegate creates the window, so every UIKit
  // container gets the saved mode. No saved mode, or `none`, keeps the platform default.
  public func application(
    _ application: UIApplication,
    willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let mode = LayoutDirectionStore.nativeMode(), mode == MODE_RTL || mode == MODE_LTR {
      NativeDirection.apply(mode)
    }
    // true keeps the default, so iOS still opens a launch URL.
    return true
  }
}
