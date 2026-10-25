import ExpoModulesCore
import UIKit

/// The phone's own light or dark setting, cached from the window scene (feat-705 KTD4).
/// `Appearance.setColorScheme` overrides the style of each window, and an override does not
/// reach the scene above the window, so the scene keeps the phone's setting.
final class SystemAppearanceStore: @unchecked Sendable {
  static let shared = SystemAppearanceStore()
  static let changeEvent = "onChange"

  private let lock = NSLock()
  private var cachedScheme: String?
  private weak var module: SystemAppearanceModule?

  // Main thread only.
  private var started = false
  private let observedScenes = NSHashTable<UIWindowScene>.weakObjects()

  /// The last reading. Safe to read from the JavaScript thread.
  var colorScheme: String? {
    lock.lock()
    defer { lock.unlock() }
    return cachedScheme
  }

  func attach(_ module: SystemAppearanceModule) {
    lock.lock()
    self.module = module
    lock.unlock()
  }

  @MainActor
  func start() {
    if started {
      return
    }
    started = true
    let names: [Notification.Name] = [
      UIScene.willConnectNotification,
      UIScene.willEnterForegroundNotification,
      UIScene.didActivateNotification,
      UIApplication.willEnterForegroundNotification,
      UIApplication.didBecomeActiveNotification,
    ]
    for name in names {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { notification in
        let scene = notification.object as? UIWindowScene
        // queue: .main delivers on the main thread, which assumeIsolated states.
        MainActor.assumeIsolated {
          SystemAppearanceStore.shared.refresh(scene)
        }
      }
    }
    refresh(nil)
  }

  /// Reads the scene now. Scene connect, foreground, and active call this on every iOS version.
  @MainActor
  func refresh(_ preferred: UIWindowScene?) {
    guard let scene = preferred ?? Self.currentScene() else {
      return
    }
    observeTraitChanges(of: scene)
    store(scene.traitCollection.userInterfaceStyle)
  }

  @MainActor
  private static func currentScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }

  @MainActor
  private func observeTraitChanges(of scene: UIWindowScene) {
    guard #available(iOS 17.0, *) else {
      return
    }
    if observedScenes.contains(scene) {
      return
    }
    observedScenes.add(scene)
    _ = scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
      (changed: UIWindowScene, _: UITraitCollection) in
      MainActor.assumeIsolated {
        // iOS flips the style in the background to take app switcher snapshots.
        // React Native ignores trait changes there in the same way.
        if UIApplication.shared.applicationState == .background {
          return
        }
        SystemAppearanceStore.shared.store(changed.traitCollection.userInterfaceStyle)
      }
    }
  }

  private func store(_ style: UIUserInterfaceStyle) {
    let scheme: String
    switch style {
    case .light:
      scheme = "light"
    case .dark:
      scheme = "dark"
    default:
      // An unspecified style is not a reading, so the last reading stays.
      return
    }
    lock.lock()
    let changed = cachedScheme != scheme
    cachedScheme = scheme
    let module = self.module
    lock.unlock()
    if changed {
      module?.sendEvent(Self.changeEvent, ["colorScheme": scheme])
    }
  }
}

public class SystemAppearanceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SystemAppearance")

    Events(SystemAppearanceStore.changeEvent)

    // Synchronous, so the reader's first render already has the phone's setting.
    Function("getColorScheme") { () -> String? in
      SystemAppearanceStore.shared.colorScheme
    }

    OnCreate {
      SystemAppearanceStore.shared.attach(self)
    }
  }
}
