import ExpoModulesCore
import Foundation
import TVServices

public final class TopShelfModule: Module {
  private static let snapshotQueue = DispatchQueue(label: "org.jesusfilm.watch.top-shelf")

  private func snapshotURL() throws -> URL {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "ForgeTopShelfAppGroup") as? String,
          let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw NSError(domain: "WatchTopShelf", code: 1)
    }
    let cache = directory.appendingPathComponent("Library/Caches", isDirectory: true)
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    return cache.appendingPathComponent("top-shelf.json")
  }

  public func definition() -> ModuleDefinition {
    Name("TopShelf")
    AsyncFunction("writeSnapshot") { (json: String) -> Bool in
      let data = Data(json.utf8)
      guard data.count <= 65536,
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["schemaVersion"] as? Int == 1,
            let items = object["items"] as? [[String: Any]],
            items.count <= 10 else { throw NSError(domain: "WatchTopShelf", code: 2) }
      let url = try self.snapshotURL()
      if (try? Data(contentsOf: url)) == data { return false }
      try data.write(to: url, options: .atomic)
      TVTopShelfContentProvider.topShelfContentDidChange()
      return true
    }.runOnQueue(Self.snapshotQueue)
    AsyncFunction("clearSnapshot") {
      let url = try self.snapshotURL()
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
        TVTopShelfContentProvider.topShelfContentDidChange()
      }
    }.runOnQueue(Self.snapshotQueue)
  }
}
