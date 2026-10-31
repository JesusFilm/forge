import Foundation
import Darwin

// Host-only Foundation executable; the extension target must not include this test file.

private struct CheckFailure: Error, CustomStringConvertible {
  let description: String
}

private func check(_ condition: @autoclosure () throws -> Bool, _ message: String = "check failed") throws {
  if try !condition() { throw CheckFailure(description: message) }
}

private func rejects(_ expected: TopShelfFeedError? = nil, _ body: () throws -> Void) throws {
  do { try body() } catch {
    if let expected { try check(error as? TopShelfFeedError == expected, "unexpected rejection: \(error)") }
    return
  }
  throw CheckFailure(description: "expected rejection")
}

private func iso(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

private func item(_ id: String = "jesus", title: String = "JESUS", duration: Double = 120,
                  kind: String = "video") -> ShelfItem {
  ShelfItem(id: id, slug: id, title: title, summary: "Captured public metadata",
            imageURL: "https://image.mux.com/unit/thumbnail.jpg", duration: duration, kind: kind)
}

private func feed(_ now: Date, revision: Int = 1, generatedOffset: TimeInterval = -5,
                  ttl: TimeInterval = 3600, concept: String = "spotlight", language: String = "english",
                  items: [ShelfItem]? = nil) -> PublicShelfFeed {
  let generated = now.addingTimeInterval(generatedOffset)
  return PublicShelfFeed(schemaVersion: 1, revision: revision, generatedAt: iso(generated),
                         expiresAt: iso(generated.addingTimeInterval(ttl)), language: language,
                         concept: concept, items: items ?? [item()])
}

private func encoded(_ feed: PublicShelfFeed) throws -> Data {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  return try encoder.encode(feed)
}

private func changed(_ feed: PublicShelfFeed, _ transform: (inout [String: Any]) -> Void) throws -> Data {
  var object = try JSONSerialization.jsonObject(with: encoded(feed)) as! [String: Any]
  transform(&object)
  return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}

private func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("TopShelfFeedTests-" + UUID().uuidString)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func configurationBundle(_ url: String, allowLocal: Bool = false) throws -> (Bundle, URL) {
  let directory = try temporaryDirectory()
  let bundleURL = directory.appendingPathComponent("Configuration.bundle")
  try FileManager.default.createDirectory(at: bundleURL, withIntermediateDirectories: true)
  let info: [String: Any] = ["CFBundleIdentifier": "org.jesusfilm.local.feed-tests." + UUID().uuidString,
                            "CFBundlePackageType": "BNDL", "ForgeTopShelfFeedURL": url,
                            "ForgeTopShelfAllowLocalFeed": allowLocal]
  let data = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
  try data.write(to: bundleURL.appendingPathComponent("Info.plist"))
  guard let bundle = Bundle(url: bundleURL) else { throw CheckFailure(description: "test Bundle unavailable") }
  return (bundle, directory)
}

private final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var result: Result<Data, Error>?
  private var total = 0
  let semaphore = DispatchSemaphore(value: 0)
  func receive(_ value: Result<Data, Error>) {
    lock.lock(); total += 1; result = value; let first = total == 1; lock.unlock()
    if first { semaphore.signal() }
  }
  var count: Int { lock.lock(); defer { lock.unlock() }; return total }
  var value: Result<Data, Error>? { lock.lock(); defer { lock.unlock() }; return result }
}

private final class StubProtocol: URLProtocol, @unchecked Sendable {
  enum Plan {
    case response(Int, String, [Data], Int?)
    case stalled
    case redirect
  }
  private static let lock = NSLock()
  private static var plan: Plan = .stalled
  private static var requests: [URLRequest] = []
  private var stopped = false
  private let stopLock = NSLock()

  static func prepare(_ value: Plan) { lock.lock(); plan = value; requests = []; lock.unlock() }
  static var observed: [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lock.lock(); Self.requests.append(request); let plan = Self.plan; Self.lock.unlock()
    switch plan {
    case .stalled: return
    case .redirect:
      let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                                     headerFields: ["Location": "https://forbidden.invalid/never-follow"])!
      client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://forbidden.invalid/never-follow")!), redirectResponse: response)
    case let .response(status, mime, chunks, length):
      var headers = ["Content-Type": mime, "Set-Cookie": "unit-cookie=must-not-be-stored"]
      if let length { headers["Content-Length"] = String(length) }
      let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      for chunk in chunks {
        stopLock.lock(); let stop = stopped; stopLock.unlock()
        if stop { return }
        client?.urlProtocol(self, didLoad: chunk)
      }
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() { stopLock.lock(); stopped = true; stopLock.unlock() }
}

private var completedRequests: [Counter] = []

private func request(_ plan: StubProtocol.Plan, cancelAfter: TimeInterval? = nil,
                     url: URL = URL(string: "https://feed-tests.invalid/public")!) throws -> (Result<Data, Error>, TimeInterval, [URLRequest]) {
  StubProtocol.prepare(plan)
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubProtocol.self]
  configuration.httpAdditionalHeaders = ["Authorization": "Bearer unit-private", "Cookie": "unit-private-cookie"]
  let counter = Counter()
  completedRequests.append(counter)
  let client = TopShelfFeedRequest(url: url, configuration: configuration, completion: counter.receive)
  let started = ProcessInfo.processInfo.systemUptime
  client.start(); client.start()
  if let cancelAfter {
    DispatchQueue.global().asyncAfter(deadline: .now() + cancelAfter) { client.cancel(); client.cancel() }
  }
  guard counter.semaphore.wait(timeout: .now() + 5) == .success, let result = counter.value else {
    client.cancel(); throw CheckFailure(description: "request exceeded bounded completion wait")
  }
  Thread.sleep(forTimeInterval: 0.03)
  try check(counter.count == 1, "request completed more than once")
  return (result, ProcessInfo.processInfo.systemUptime - started, StubProtocol.observed)
}

@main
private struct TopShelfFeedTests {
  static func main() {
    if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--cache-child" {
      let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
      let revision = Int(CommandLine.arguments[3])!
      do {
        try PublicShelfFeedStore(directory: directory).accept(feed(Date(), revision: revision),
          endpoint: URL(string: "https://feed-tests.invalid/public")!, language: "english", concept: "spotlight")
        exit(0)
      } catch TopShelfFeedError.rollback { exit(2) }
      catch { fputs("child cache error: \(error)\n", stderr); exit(1) }
    }

    var passed = 0
    var failures: [String] = []
    func test(_ name: String, _ body: () throws -> Void) {
      do { try body(); passed += 1; print("PASS \(name)") }
      catch { failures.append(name + ": " + String(describing: error)); print("FAIL \(name): \(error)") }
    }
    let now = Date()
    let endpoint = URL(string: "https://feed-tests.invalid/public")!

    test("valid feed, authoritative empty, snapshot compatibility and freshness") {
      let normal = try PublicShelfFeed.decode(encoded(feed(now)), language: "english", concept: "spotlight", now: now)
      try check(normal.snapshot.items == normal.items && normal.snapshot.generatedAt == normal.generatedAt)
      try check(normal.isFresh(at: now) && !normal.isFresh(at: now.addingTimeInterval(4000)))
      let empty = try PublicShelfFeed.decode(encoded(feed(now, revision: 2, items: [])), language: "english", concept: "spotlight", now: now)
      try check(empty.items.isEmpty && empty.revision == 2)
      let encodedSnapshot = try JSONEncoder().encode(normal.snapshot)
      try check(try JSONDecoder().decode(Snapshot.self, from: encodedSnapshot) == normal.snapshot)
      let legacy = Data("{\"schemaVersion\":1,\"concept\":\"continue\",\"language\":\"english\",\"expiresAt\":\"2030-01-01T00:00:00Z\",\"items\":[]}".utf8)
      try check(try JSONDecoder().decode(Snapshot.self, from: legacy).generatedAt == nil)
    }

    test("public app context ignores item, progress and date rewrites but fences language/style and invalid state") {
      let original = Snapshot(schemaVersion: 1, concept: "collection", language: "english",
                              expiresAt: iso(now.addingTimeInterval(600)), items: [item()])
      let rewrittenItem = ShelfItem(id: "magdalena", slug: "magdalena", title: "Updated app copy", summary: "Updated summary",
                                    imageURL: "https://image.mux.com/different/thumbnail.jpg", duration: 3600, kind: "video", progress: 0.75)
      let rewritten = Snapshot(schemaVersion: 1, concept: "collection", language: "english",
                               expiresAt: iso(now.addingTimeInterval(1200)), generatedAt: iso(now), items: [rewrittenItem])
      let context = TopShelfAppContext(fileExists: true, snapshot: original)
      try check(context == TopShelfAppContext(fileExists: true, snapshot: rewritten))
      try check(context == .valid(language: "english", concept: "collection"))
      for (language, concept) in [("thai", "collection"), ("english", "spotlight"), ("english", "continue")] {
        let different = Snapshot(schemaVersion: 1, concept: concept, language: language,
                                 expiresAt: original.expiresAt, items: original.items)
        try check(context != TopShelfAppContext(fileExists: true, snapshot: different))
      }
      let absent = TopShelfAppContext(fileExists: false, snapshot: nil)
      let malformed = TopShelfAppContext(fileExists: true, snapshot: nil)
      try check(absent == .absent && malformed == .malformed && absent != malformed)
      try check(context != absent && context != malformed)
      try check(TopShelfAppContext(fileExists: false, snapshot: original) == .absent)

      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      let store = PublicShelfFeedStore(directory: directory, now: { now })
      try store.accept(feed(now, revision: 10, concept: "collection", items: []), endpoint: endpoint, language: "english", concept: "collection")
      // An ordinary app catalogue rewrite leaves the public authority/context unchanged.
      try check(context == TopShelfAppContext(fileExists: true, snapshot: rewritten))
      if case let .value(value) = store.cached(endpoint: endpoint, language: "english", concept: "collection") {
        try check(value.revision == 10 && value.items.isEmpty)
      } else { throw CheckFailure(description: "same-context app rewrite lost public tombstone") }
    }

    test("public styles, kinds and genuine short duration; 0 through10 items only") {
      for concept in ["spotlight", "collection", "short", "journey"] {
        let values = (0..<10).map { item("film-\($0)", duration: concept == "journey" ? 0 : 120, kind: concept == "journey" ? "section" : "video") }
        _ = try PublicShelfFeed.decode(encoded(feed(now, concept: concept, items: values)), language: "english", concept: concept, now: now)
      }
      try rejects { _ = try PublicShelfFeed.decode(encoded(feed(now, concept: "continue")), language: "english", concept: "continue", now: now) }
      for wrong in [feed(now, concept: "journey"), feed(now, items: [item(kind: "section")]), feed(now, concept: "short", items: [item(duration: 901)]), feed(now, concept: "short", items: [item(duration: 0)]), feed(now, concept: "journey", items: [item(duration: 1, kind: "section")])] {
        try rejects { _ = try PublicShelfFeed.decode(encoded(wrong), language: wrong.language, concept: wrong.concept, now: now) }
      }
      try rejects { _ = try PublicShelfFeed.decode(encoded(feed(now, items: (0..<11).map { item("id-\($0)") })), language: "english", concept: "spotlight", now: now) }
    }

    test("unknown/private/progress keys, duplicates, identifiers and HTTPS media rejected") {
      let normal = feed(now)
      for key in ["viewerToken", "sessionToken", "requestId", "capability", "unexpected"] {
        try rejects { _ = try PublicShelfFeed.decode(changed(normal) { $0[key] = "private" }, language: "english", concept: "spotlight", now: now) }
      }
      for key in ["progress", "capability", "playAction"] {
        let data = try changed(normal) { object in
          var items = object["items"] as! [[String: Any]]; items[0][key] = NSNull(); object["items"] = items
        }
        try rejects { _ = try PublicShelfFeed.decode(data, language: "english", concept: "spotlight", now: now) }
      }
      try rejects { _ = try PublicShelfFeed.decode(encoded(feed(now, items: [item(), item()])), language: "english", concept: "spotlight", now: now) }
      let trailingNewline = try changed(normal) { object in var items = object["items"] as! [[String: Any]]; items[0]["slug"] = "jesus\n"; object["items"] = items }
      try rejects { _ = try PublicShelfFeed.decode(trailingNewline, language: "english", concept: "spotlight", now: now) }
      for change in ["slug": "../profile", "imageURL": "http://example.invalid/a.jpg", "previewURL": "https://user:pass@example.invalid/a.m3u8"] {
        let data = try changed(normal) { object in var items = object["items"] as! [[String: Any]]; items[0][change.key] = change.value; object["items"] = items }
        try rejects { _ = try PublicShelfFeed.decode(data, language: "english", concept: "spotlight", now: now) }
      }
    }

    test("UTF16 limits and decoded body bound") {
      let boundary = item(title: String(repeating: "😀", count: 100))
      _ = try PublicShelfFeed.decode(encoded(feed(now, items: [boundary])), language: "english", concept: "spotlight", now: now)
      try rejects { _ = try PublicShelfFeed.decode(encoded(feed(now, items: [item(title: String(repeating: "😀", count: 101))])), language: "english", concept: "spotlight", now: now) }
      let longSummary = try changed(feed(now)) { object in var items = object["items"] as! [[String: Any]]; items[0]["summary"] = String(repeating: "😀", count: 251); object["items"] = items }
      try rejects { _ = try PublicShelfFeed.decode(longSummary, language: "english", concept: "spotlight", now: now) }
      try rejects(.bodyTooLarge) { _ = try PublicShelfFeed.decode(Data(repeating: 32, count: 65_537), language: "english", concept: "spotlight", now: now) }
      let largeItems = (0..<5).map { index in
        ShelfItem(id: "long-\(index)", slug: "long-\(index)", title: String(repeating: "漢", count: 200),
                  summary: String(repeating: "漢", count: 500),
                  imageURL: "https://image.mux.com/" + String(repeating: "漢", count: 1900), duration: 120, kind: "video",
                  previewURL: "https://stream.mux.com/" + String(repeating: "漢", count: 1900))
      }
      let large = feed(now, items: largeItems)
      try check(try encoded(large).count > 65_536)
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      try rejects(.bodyTooLarge) { try PublicShelfFeedStore(directory: directory, now: { now }).accept(large, endpoint: endpoint, language: "english", concept: "spotlight") }
    }

    test("schema, safe revision, context and dates") {
      for key in ["schemaVersion", "revision"] {
        for value in key == "revision" ? [-1, 9_007_199_254_740_992] : [0, 2] {
          try rejects { _ = try PublicShelfFeed.decode(changed(feed(now)) { $0[key] = value }, language: "english", concept: "spotlight", now: now) }
        }
      }
      _ = try PublicShelfFeed.decode(encoded(feed(now, revision: 9_007_199_254_740_991)), language: "english", concept: "spotlight", now: now)
      try rejects(.contextMismatch) { _ = try PublicShelfFeed.decode(encoded(feed(now)), language: "thai", concept: "spotlight", now: now) }
      try rejects(.contextMismatch) { _ = try PublicShelfFeed.decode(encoded(feed(now)), language: "english", concept: "collection", now: now) }
      for wrong in [feed(now, generatedOffset: 61), feed(now, generatedOffset: -120, ttl: 60), feed(now, ttl: 0), feed(now, ttl: 86_401)] {
        try rejects(.invalidDates) { _ = try PublicShelfFeed.decode(encoded(wrong), language: "english", concept: "spotlight", now: now) }
      }
      let invalidNumber = String(data: try encoded(feed(now)), encoding: .utf8)!.replacingOccurrences(of: "\"duration\":120", with: "\"duration\":1e309")
      try rejects { _ = try PublicShelfFeed.decode(Data(invalidNumber.utf8), language: "english", concept: "spotlight", now: now) }
    }

    test("endpoint configuration is opt-in, HTTPS-safe and host HTTP guard cannot be bypassed") {
      for value in ["", "file:///tmp/feed", "https://user:pass@feed-tests.invalid/public", "https://feed-tests.invalid/public?old=1", "https://feed-tests.invalid/public#fragment", "https://feed-tests.invalid/" + String(repeating: "a", count: 2050), "http://127.0.0.1:8098/public", "http://127.0.0.1.evil.invalid/public"] {
        let (bundle, directory) = try configurationBundle(value, allowLocal: true); defer { try? FileManager.default.removeItem(at: directory) }
        try check(TopShelfFeedConfiguration(bundle: bundle) == nil, "unsafe endpoint accepted on host")
      }
      let (bundle, directory) = try configurationBundle(endpoint.absoluteString); defer { try? FileManager.default.removeItem(at: directory) }
      guard let config = TopShelfFeedConfiguration(bundle: bundle), let url = config.requestURL(language: "english", concept: "collection") else { throw CheckFailure(description: "valid configuration rejected") }
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
      try check(query == [URLQueryItem(name: "language", value: "english"), URLQueryItem(name: "concept", value: "collection")])
      try check(config.requestURL(language: "../private", concept: "spotlight") == nil && config.requestURL(language: "english", concept: "continue") == nil)
    }

    test("separate cache ownership, contexts, corruption recovery and strict cache keys") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      let privateURL = directory.appendingPathComponent("top-shelf.json"), sentinel = Data("real-app-owned-snapshot-unit-sentinel".utf8)
      try sentinel.write(to: privateURL); let modification = try privateURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
      let store = PublicShelfFeedStore(directory: directory, now: { now })
      if case .absent = store.cached(endpoint: endpoint, language: "english", concept: "spotlight") {} else { throw CheckFailure(description: "expected absent") }
      try store.accept(feed(now), endpoint: endpoint, language: "english", concept: "spotlight")
      if case .absent = store.cached(endpoint: endpoint, language: "thai", concept: "spotlight") {} else { throw CheckFailure(description: "expected context isolation") }
      let publicURL = store.cacheURL(endpoint: endpoint, language: "english", concept: "spotlight")
      var record = try JSONSerialization.jsonObject(with: Data(contentsOf: publicURL)) as! [String: Any]
      var publicFeed = record["feed"] as! [String: Any]; publicFeed["viewerToken"] = "unit-private"; record["feed"] = publicFeed
      try JSONSerialization.data(withJSONObject: record).write(to: publicURL)
      if case .invalid = store.cached(endpoint: endpoint, language: "english", concept: "spotlight") {} else { throw CheckFailure(description: "private cache key accepted") }
      try store.accept(feed(now, revision: 2), endpoint: endpoint, language: "english", concept: "spotlight")
      try check(try Data(contentsOf: privateURL) == sentinel)
      try check(try privateURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate == modification)
      try check((try FileManager.default.attributesOfItem(atPath: publicURL.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    }

    test("style, language and endpoint round trips retain tombstones and revision fences after expiry") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      var clock = now
      let store = PublicShelfFeedStore(directory: directory, now: { clock })
      let otherEndpoint = URL(string: "https://feed-tests.invalid/other-public")!
      try store.accept(feed(clock, revision: 10, ttl: 60, concept: "collection", items: []), endpoint: endpoint, language: "english", concept: "collection")
      try store.accept(feed(clock, revision: 1), endpoint: endpoint, language: "english", concept: "spotlight")
      try store.accept(feed(clock, revision: 1, concept: "collection", language: "thai"), endpoint: endpoint, language: "thai", concept: "collection")
      try store.accept(feed(clock, revision: 1, concept: "collection"), endpoint: otherEndpoint, language: "english", concept: "collection")
      let urls = [(endpoint, "english", "collection"), (endpoint, "english", "spotlight"), (endpoint, "thai", "collection"), (otherEndpoint, "english", "collection")]
        .map { store.cacheURL(endpoint: $0.0, language: $0.1, concept: $0.2) }
      try check(Set(urls).count == 4)
      for url in urls {
        let name = url.deletingLastPathComponent().lastPathComponent
        try check(name.count == 72 && name.hasPrefix("context-") && !name.contains("english") && !name.contains("feed-tests"))
      }
      clock = clock.addingTimeInterval(120)
      if case let .value(value) = store.cached(endpoint: endpoint, language: "english", concept: "collection") {
        try check(value.revision == 10 && value.items.isEmpty && !value.isFresh(at: clock))
      } else { throw CheckFailure(description: "context round trip erased the expired authoritative tombstone") }
      try rejects(.rollback) { try store.accept(feed(clock, revision: 1, concept: "collection"), endpoint: endpoint, language: "english", concept: "collection") }
      try rejects(.conflictingRevision) { try store.accept(feed(clock, revision: 10, concept: "collection"), endpoint: endpoint, language: "english", concept: "collection") }
      for (requestEndpoint, language, concept) in [(endpoint, "english", "spotlight"), (endpoint, "thai", "collection"), (otherEndpoint, "english", "collection")] {
        if case let .value(value) = store.cached(endpoint: requestEndpoint, language: language, concept: concept) {
          try check(value.revision == 1 && !value.items.isEmpty)
        } else { throw CheckFailure(description: "one public context replaced another") }
      }
    }

    test("store rejects query-bearing or credentialed endpoint contexts without creating files") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      let store = PublicShelfFeedStore(directory: directory, now: { now })
      for value in ["https://feed-tests.invalid/public?language=english", "https://user:pass@feed-tests.invalid/public", "https://feed-tests.invalid/public#fragment"] {
        let invalid = URL(string: value)!
        if case .invalid = store.cached(endpoint: invalid, language: "english", concept: "spotlight") {} else { throw CheckFailure(description: "invalid context lookup accepted") }
        try rejects(.invalidConfiguration) { try store.accept(feed(now), endpoint: invalid, language: "english", concept: "spotlight") }
      }
      try check(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    }

    test("rollback and equal-revision conflict rejected; same content can renew using newer generation") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      let store = PublicShelfFeedStore(directory: directory, now: { now })
      let initial = feed(now, revision: 5, generatedOffset: -10)
      try store.accept(initial, endpoint: endpoint, language: "english", concept: "spotlight")
      try rejects(.rollback) { try store.accept(feed(now, revision: 4), endpoint: endpoint, language: "english", concept: "spotlight") }
      try rejects(.conflictingRevision) { try store.accept(feed(now, revision: 5, items: [item(title: "Changed")]), endpoint: endpoint, language: "english", concept: "spotlight") }
      let renewed = feed(now, revision: 5, generatedOffset: -1)
      try check(try store.accept(renewed, endpoint: endpoint, language: "english", concept: "spotlight") == renewed)
      try check(try store.accept(initial, endpoint: endpoint, language: "english", concept: "spotlight") == renewed)
    }

    test("expired accepted empty cache retains high-water mark and tombstone") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      var clock = now
      let store = PublicShelfFeedStore(directory: directory, now: { clock })
      try store.accept(feed(clock, revision: 8, ttl: 60, items: []), endpoint: endpoint, language: "english", concept: "spotlight")
      clock = clock.addingTimeInterval(120)
      if case let .value(value) = store.cached(endpoint: endpoint, language: "english", concept: "spotlight") {
        try check(value.items.isEmpty && !value.isFresh(at: clock))
      } else { throw CheckFailure(description: "expired tombstone was discarded") }
      try rejects(.rollback) { try store.accept(feed(clock, revision: 7), endpoint: endpoint, language: "english", concept: "spotlight") }
      try rejects(.conflictingRevision) { try store.accept(feed(clock, revision: 8), endpoint: endpoint, language: "english", concept: "spotlight") }
      try store.accept(feed(clock, revision: 9), endpoint: endpoint, language: "english", concept: "spotlight")
    }

    test("feed that expires before the locked write is rejected without creating public content") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      var calls = 0
      let store = PublicShelfFeedStore(directory: directory, now: {
        calls += 1
        return calls == 1 ? now : now.addingTimeInterval(4000)
      })
      try rejects(.invalidDates) { try store.accept(feed(now), endpoint: endpoint, language: "english", concept: "spotlight") }
      try check(!FileManager.default.fileExists(atPath: store.cacheURL(endpoint: endpoint, language: "english", concept: "spotlight").path))
    }

    test("flock transaction preserves highest revision across real concurrent processes") {
      let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
      let store = PublicShelfFeedStore(directory: directory)
      try store.accept(feed(Date()), endpoint: endpoint, language: "english", concept: "spotlight")
      var processes: [Process] = []
      for revision in [2, 9, 4, 7, 3, 6] {
        let child = Process(); child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        child.arguments = ["--cache-child", directory.path, String(revision)]
        child.standardOutput = Pipe(); child.standardError = Pipe(); try child.run(); processes.append(child)
      }
      for child in processes { child.waitUntilExit(); try check([0, 2].contains(child.terminationStatus), "child failed") }
      if case let .value(value) = store.cached(endpoint: endpoint, language: "english", concept: "spotlight") { try check(value.revision == 9) }
      else { throw CheckFailure(description: "concurrent cache invalid") }
    }

    test("HTTPS URLProtocol success, credential-free headers, client marker and exactly-once") {
      let expected = Data("{\"local\":true}".utf8)
      let (result, _, requests) = try request(.response(200, "application/json", [expected], expected.count))
      try check(try result.get() == expected && requests.count == 1)
      try check(requests[0].value(forHTTPHeaderField: "Authorization") == nil && requests[0].value(forHTTPHeaderField: "Cookie") == nil)
      try check(requests[0].value(forHTTPHeaderField: "X-Top-Shelf-Client") == "native-extension")
    }

    test("known and streamed oversized bodies, MIME/status errors and unsafe direct URL fail closed") {
      for plan in [StubProtocol.Plan.response(200, "application/json", [], 65_537), .response(200, "application/json", [Data(repeating: 32, count: 32_768), Data(repeating: 32, count: 32_768), Data([32])], nil), .response(503, "application/json", [], nil), .response(200, "text/plain", [Data("no".utf8)], nil)] {
        let (result, _, _) = try request(plan); try rejects { _ = try result.get() }
      }
      let (invalid, _, requests) = try request(.stalled, url: URL(string: "https://user:pass@feed-tests.invalid/public")!)
      try rejects(.invalidConfiguration) { _ = try invalid.get() }; try check(requests.isEmpty)
      let (wrongQuery, _, wrongRequests) = try request(.stalled, url: URL(string: "https://feed-tests.invalid/public?concept=continue")!)
      try rejects(.invalidConfiguration) { _ = try wrongQuery.get() }; try check(wrongRequests.isEmpty)
    }

    test("redirect is denied before any redirected request") {
      let (result, _, requests) = try request(.redirect)
      try rejects { _ = try result.get() }
      try check(requests.count == 1 && requests[0].url!.host == "feed-tests.invalid")
    }

    test("cancel before/during start completes once and late timer cannot replay completion") {
      let (result, elapsed, _) = try request(.stalled, cancelAfter: 0.03)
      try rejects(.cancelled) { _ = try result.get() }; try check(elapsed < 1)
      let counter = Counter(); completedRequests.append(counter)
      let client = TopShelfFeedRequest(url: endpoint, completion: counter.receive)
      client.cancel(); client.start(); client.cancel()
      try check(counter.semaphore.wait(timeout: .now() + 1) == .success && counter.count == 1)
    }

    test("whole-wall deadline finishes stalled URLProtocol within bounded time") {
      let (result, elapsed, _) = try request(.stalled)
      try rejects { _ = try result.get() }
      try check(elapsed >= 2.5 && elapsed < 4.5, "unexpected deadline: \(elapsed)")
      try check(completedRequests.allSatisfy { $0.count == 1 }, "late callback completed a request twice")
    }

    print("RESULT passed=\(passed) failed=\(failures.count)")
    if !failures.isEmpty { exit(1) }
  }
}
