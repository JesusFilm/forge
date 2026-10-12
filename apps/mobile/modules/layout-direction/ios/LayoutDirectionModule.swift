import ExpoModulesCore
import React
import UIKit

let MODE_RTL = "rtl"
let MODE_LTR = "ltr"

/// The durable direction record in `UserDefaults`.
enum LayoutDirectionStore {
  private static let nativeModeKey = "org.jesusfilm.layoutdirection.nativeMode"
  private static let reloadCountKey = "org.jesusfilm.layoutdirection.reloadCount"
  private static let reloadKindKey = "org.jesusfilm.layoutdirection.reloadKind"
  private static let reloadBundleKey = "org.jesusfilm.layoutdirection.reloadBundle"
  private static let reportedFaultKey = "org.jesusfilm.layoutdirection.reportedFault"

  private static var defaults: UserDefaults { .standard }

  static func nativeMode() -> String? {
    defaults.string(forKey: nativeModeKey)
  }

  static func state() -> [String: Any?] {
    [
      "nativeMode": defaults.string(forKey: nativeModeKey),
      "reloadCount": defaults.integer(forKey: reloadCountKey),
      "reloadKind": defaults.string(forKey: reloadKindKey),
      "reloadBundle": defaults.string(forKey: reloadBundleKey),
      "reportedFault": defaults.string(forKey: reportedFaultKey),
    ]
  }

  static func saveDirection(
    isRTL: Bool,
    nativeMode: String,
    reloadCount: Int,
    reloadKind: String?,
    reloadBundle: String?
  ) -> Bool {
    // RCTI18nUtil writes these settings to UserDefaults synchronously, unlike the JS
    // I18nManager.forceRTL call, which nothing orders before a reload.
    let i18nUtil = RCTI18nUtil.sharedInstance()
    i18nUtil?.allowRTL(false)
    i18nUtil?.forceRTL(isRTL)
    defaults.set(nativeMode, forKey: nativeModeKey)
    defaults.set(reloadCount, forKey: reloadCountKey)
    defaults.set(reloadKind, forKey: reloadKindKey)
    defaults.set(reloadBundle, forKey: reloadBundleKey)
    // A new reload record has no fault yet; the runtime it starts reads it that way.
    defaults.removeObject(forKey: reportedFaultKey)
    return defaults.synchronize()
  }

  static func saveNativeMode(_ nativeMode: String) -> Bool {
    defaults.set(nativeMode, forKey: nativeModeKey)
    return defaults.synchronize()
  }

  static func saveReportedFault(_ fault: String) -> Bool {
    defaults.set(fault, forKey: reportedFaultKey)
    return defaults.synchronize()
  }

  static func clearReloadRecord() -> Bool {
    defaults.set(0, forKey: reloadCountKey)
    defaults.removeObject(forKey: reloadKindKey)
    defaults.removeObject(forKey: reloadBundleKey)
    defaults.removeObject(forKey: reportedFaultKey)
    return defaults.synchronize()
  }
}

/// UIKit containers outside React views (sheets, menus, alerts, the tab bar) read the
/// appearance proxy when they enter a window, so a change reaches only new containers.
enum NativeDirection {
  @MainActor
  static func apply(_ mode: String) {
    switch mode {
    case MODE_RTL:
      UIView.appearance().semanticContentAttribute = .forceRightToLeft
    case MODE_LTR:
      UIView.appearance().semanticContentAttribute = .forceLeftToRight
    default:
      UIView.appearance().semanticContentAttribute = .unspecified
    }
  }
}

final class SaveFailedException: Exception, @unchecked Sendable {
  override var reason: String {
    "The layout direction was not saved to disk"
  }
}

public class LayoutDirectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LayoutDirection")

    Function("getState") {
      LayoutDirectionStore.state()
    }

    // runOnQueue(.main) puts each closure on the main thread, which assumeIsolated states.
    AsyncFunction("saveDirection") {
      (isRTL: Bool, nativeMode: String, reloadCount: Int, reloadKind: String?, reloadBundle: String?) in
      let saved = LayoutDirectionStore.saveDirection(
        isRTL: isRTL,
        nativeMode: nativeMode,
        reloadCount: reloadCount,
        reloadKind: reloadKind,
        reloadBundle: reloadBundle
      )
      if !saved {
        throw SaveFailedException()
      }
      MainActor.assumeIsolated { NativeDirection.apply(nativeMode) }
    }.runOnQueue(.main)

    AsyncFunction("saveNativeMode") { (nativeMode: String) in
      if !LayoutDirectionStore.saveNativeMode(nativeMode) {
        throw SaveFailedException()
      }
      MainActor.assumeIsolated { NativeDirection.apply(nativeMode) }
    }.runOnQueue(.main)

    AsyncFunction("applyNativeMode") { (nativeMode: String) in
      MainActor.assumeIsolated { NativeDirection.apply(nativeMode) }
    }.runOnQueue(.main)

    AsyncFunction("saveReportedFault") { (fault: String) in
      if !LayoutDirectionStore.saveReportedFault(fault) {
        throw SaveFailedException()
      }
    }

    AsyncFunction("clearReloadRecord") {
      if !LayoutDirectionStore.clearReloadRecord() {
        throw SaveFailedException()
      }
    }
  }
}
