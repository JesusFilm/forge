import Foundation
import Security

/// What persists across launches. One blob under one keychain item — every
/// save is a single atomic SecItemUpdate, so an access/refresh pair can never
/// tear (half-old, half-new) and the new refresh token is durable in the same
/// write that discards the old one.
struct StoredSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String?
    var idToken: String?
    var accessTokenExpiresAt: Date?
}

enum KeychainTokenStore {
    private static let service = "org.jesusfilm.forgetv.native.auth"
    private static let account = "session"

    @discardableResult
    static func save(_ session: StoredSession) -> Bool {
        guard let data = try? JSONEncoder().encode(session) else { return false }
        // Update-in-place first; never delete-then-add, which has a window
        // where no session exists at all if the process dies in between.
        let status = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var attributes = baseQuery
            attributes[kSecValueData as String] = data
            // AfterFirstUnlock: tvOS has no passcode UX, but the attribute
            // still governs availability right after reboot.
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    static func load() -> StoredSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    static func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
