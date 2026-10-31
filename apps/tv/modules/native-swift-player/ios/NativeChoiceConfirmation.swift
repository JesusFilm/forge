// Shared by native option UI and standalone lifecycle tests. Requesting a
// different-cut choice must not emit a selection before the viewer accepts it.
struct NativeChoiceConfirmation {
  private var pendingId: String?

  mutating func request(id: String, message: String?) -> String? {
    pendingId = message?.isEmpty == false ? id : nil
    return pendingId == nil ? id : nil
  }

  mutating func resolve(accepted: Bool) -> String? {
    let id = pendingId
    pendingId = nil
    return accepted ? id : nil
  }
}
