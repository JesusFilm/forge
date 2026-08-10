import CryptoKit
import Foundation
import Security

// MARK: - PKCE (RFC 7636)

/// Verifier/challenge pair. A fresh pair is minted for every device-code
/// request — the verifier only ever travels to the token endpoint, proving the
/// poller is the same client that started the flow.
struct PKCE {
    let verifier: String
    let challenge: String

    static func generate() -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            // SecRandomCopyBytes failing is effectively unheard of on-device;
            // fall back to the system CSPRNG rather than aborting sign-in.
            bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        }
        let verifier = base64URL(Data(bytes))
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        return PKCE(verifier: verifier, challenge: challenge)
    }

    /// base64url without padding (RFC 7636 §4.1/4.2).
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - Value types

struct DeviceAuthorization {
    let deviceCode: String
    let userCode: String
    let verificationURI: String
    let verificationURIComplete: String
    /// Absolute deadline, stamped at response receipt so callers never
    /// re-derive it from a stale `expires_in`.
    let expiresAt: Date
    let interval: TimeInterval
}

/// Everything the poll loop needs: the server's grant plus the PKCE verifier
/// that must accompany every token request for this specific code.
struct DeviceGrantSession {
    let authorization: DeviceAuthorization
    let codeVerifier: String
}

struct TokenSet {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiresIn: TimeInterval?
}

// MARK: - Outcomes
// OAuth-level results are data, never thrown — the public API of this client
// cannot throw at all; transport errors are folded into the enums.

enum DeviceCodeRequestOutcome {
    case success(DeviceGrantSession)
    case failure(reason: String)
}

enum DevicePollOutcome {
    case authorized(TokenSet)
    /// authorization_pending — keep polling at the current interval.
    case pending
    /// slow_down — caller adds 5s to its interval, cumulatively (RFC 8628 §3.5).
    case slowDown
    /// access_denied — terminal for this code.
    case denied
    /// expired_token — the code is dead; request a fresh one in place.
    case expired
    /// Network blip or 5xx/429 mid-poll. Keep polling: an approval may be in
    /// flight on the phone, and code expiry bounds the loop anyway.
    case transient
    case failure(reason: String)
}

enum RefreshOutcome {
    case refreshed(TokenSet)
    /// Session definitively revoked server-side — the caller wipes local state.
    case revoked
    /// 5xx/429/network/unknown — keep the session; wiping on an ambiguous error
    /// would sign every TV out during a bad deploy.
    case transient
}

// MARK: - Client

/// Transport for the feat-322 device grant against apps/auth. Pure — no UI,
/// no persistence; the view model owns state and the keychain.
struct DeviceGrantClient {
    var baseURL = Config.authBaseURL
    var clientID = Config.deviceClientID

    func requestDeviceCode() async -> DeviceCodeRequestOutcome {
        let pkce = PKCE.generate()
        let body = [
            "client_id": clientID,
            "code_challenge": pkce.challenge,
            "code_challenge_method": "S256",
        ]
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await post("api/auth/device/code", json: body)
        } catch {
            return .failure(reason: "Couldn't reach the sign-in service. Check the network connection and try again.")
        }
        guard http.statusCode == 200 else {
            let detail = Self.oauthErrorCode(in: data).map { " (\($0))" } ?? ""
            return .failure(reason: "The sign-in service refused the request\(detail).")
        }
        guard let wire = try? JSONDecoder().decode(DeviceCodeWire.self, from: data) else {
            return .failure(reason: "The sign-in service returned an unexpected response.")
        }
        let authorization = DeviceAuthorization(
            deviceCode: wire.deviceCode,
            userCode: wire.userCode,
            verificationURI: wire.verificationUri,
            verificationURIComplete: wire.verificationUriComplete,
            expiresAt: Date().addingTimeInterval(wire.expiresIn),
            interval: wire.interval ?? 5)
        return .success(DeviceGrantSession(authorization: authorization, codeVerifier: pkce.verifier))
    }

    func pollOnce(_ session: DeviceGrantSession) async -> DevicePollOutcome {
        let body = [
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": session.authorization.deviceCode,
            "client_id": clientID,
            "code_verifier": session.codeVerifier,
        ]
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await post("api/auth/device/token", json: body)
        } catch {
            return .transient
        }
        if http.statusCode == 200 {
            guard let wire = try? JSONDecoder().decode(TokenWire.self, from: data) else {
                // The device code is single-use; a malformed 200 after
                // redemption cannot be recovered by re-polling.
                return .failure(reason: "The sign-in service returned an unexpected response.")
            }
            return .authorized(wire.tokenSet)
        }
        guard let code = Self.oauthErrorCode(in: data) else {
            // A proxy 502/503 or rate-limit has no OAuth body — treat like a
            // network blip rather than killing an in-progress approval.
            return http.statusCode >= 500 || http.statusCode == 429
                ? .transient
                : .failure(reason: "Sign-in failed (HTTP \(http.statusCode)).")
        }
        switch code {
        case "authorization_pending": return .pending
        case "slow_down": return .slowDown
        case "access_denied": return .denied
        case "expired_token": return .expired
        default: return .failure(reason: "Sign-in failed (\(code)).")
        }
    }

    func refresh(refreshToken: String) async -> RefreshOutcome {
        // Form-encoded on purpose: the standard OAuth endpoints 415 on JSON.
        let fields = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refreshToken),
            ("client_id", clientID),
        ]
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await post("api/auth/oauth2/token", form: fields)
        } catch {
            return .transient
        }
        if http.statusCode == 200 {
            guard let wire = try? JSONDecoder().decode(TokenWire.self, from: data) else {
                return .transient
            }
            return .refreshed(wire.tokenSet)
        }
        // "invalid_token" is this server's real revocation literal;
        // invalid_grant / invalid_client are the RFC 6749 spellings. Anything
        // else keeps the session.
        if let code = Self.oauthErrorCode(in: data),
           ["invalid_token", "invalid_grant", "invalid_client"].contains(code) {
            return .revoked
        }
        return .transient
    }

    /// Best-effort by contract: the caller's local wipe happens regardless of
    /// whether this round-trip succeeds.
    func revoke(token: String) async {
        let fields = [("token", token), ("client_id", clientID)]
        _ = try? await post("api/auth/oauth2/revoke", form: fields)
    }

    // MARK: - Transport

    private func post(_ path: String, json body: [String: String]) async throws -> (Data, HTTPURLResponse) {
        var request = makeRequest(path)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func post(_ path: String, form fields: [(String, String)]) async throws -> (Data, HTTPURLResponse) {
        var request = makeRequest(path)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(Self.formEncode(fields).utf8)
        return try await send(request)
    }

    private func makeRequest(_ path: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }

    /// ASCII-only unreserved set (RFC 3986). CharacterSet.alphanumerics would
    /// pass non-ASCII letters through unencoded, and query-style encoding would
    /// leave `+` intact — tokens can contain both classes of trouble.
    private static let formAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func formEncode(_ fields: [(String, String)]) -> String {
        fields
            .map { key, value in
                let k = key.addingPercentEncoding(withAllowedCharacters: formAllowed) ?? key
                let v = value.addingPercentEncoding(withAllowedCharacters: formAllowed) ?? value
                return "\(k)=\(v)"
            }
            .joined(separator: "&")
    }

    private static func oauthErrorCode(in data: Data) -> String? {
        (try? JSONDecoder().decode(OAuthErrorWire.self, from: data))?.error
    }
}

// MARK: - Wire shapes

private struct DeviceCodeWire: Decodable {
    let deviceCode: String
    let userCode: String
    let verificationUri: String
    let verificationUriComplete: String
    let expiresIn: TimeInterval
    let interval: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationUri = "verification_uri"
        case verificationUriComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }
}

private struct TokenWire: Decodable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expiresIn: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case expiresIn = "expires_in"
    }

    var tokenSet: TokenSet {
        TokenSet(accessToken: accessToken, refreshToken: refreshToken, idToken: idToken, expiresIn: expiresIn)
    }
}

private struct OAuthErrorWire: Decodable {
    let error: String
}
