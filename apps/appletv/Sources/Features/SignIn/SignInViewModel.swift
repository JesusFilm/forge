import Combine
import Foundation

/// Drives the RFC 8628 device-grant sign-in flow (feat-322).
@MainActor
final class SignInViewModel: ObservableObject {

    struct Waiting: Equatable {
        let userCode: String
        let verificationURI: String
        let verificationURIComplete: String
        let expiresAt: Date
    }

    enum State: Equatable {
        case signedOut
        case requestingCode
        case waiting(Waiting)
        case denied
        case error(String)
        case signedIn
    }

    @Published private(set) var state: State = .signedOut

    private let client = DeviceGrantClient()
    private var flowTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var started = false

    deinit {
        flowTask?.cancel()
        refreshTask?.cancel()
    }

    /// Idempotent entry point, called from the view's onAppear. Deliberately
    /// NOT re-run on tab revisits, and nothing cancels on disappear: an
    /// in-flight poll must survive the user browsing other tabs while their
    /// phone approval lands.
    func start() {
        guard !started else { return }
        started = true
        if let stored = KeychainTokenStore.load() {
            // Optimistic: show signed-in immediately, validate off the UI path.
            state = .signedIn
            validateStoredSession(stored)
        } else {
            beginDeviceFlow()
        }
    }

    func requestNewCode() {
        beginDeviceFlow()
    }

    func signOut() {
        flowTask?.cancel()
        refreshTask?.cancel()
        let stored = KeychainTokenStore.load()
        KeychainTokenStore.clear()
        state = .signedOut
        // Revoking the refresh token kills the whole server-side session; the
        // access token is the fallback when that's all we have. Best-effort by
        // contract — the local wipe above already happened.
        if let token = stored?.refreshToken ?? stored?.accessToken {
            Task { await client.revoke(token: token) }
        }
        beginDeviceFlow()
    }

    // MARK: - Device flow

    private func beginDeviceFlow() {
        flowTask?.cancel()
        state = .requestingCode
        flowTask = Task { [weak self] in
            guard let self else { return }
            guard let session = await self.requestCode() else { return }
            await self.pollLoop(session)
        }
    }

    /// Requests a fresh code + PKCE pair and swaps it into the UI in place.
    /// Returns nil after setting a terminal state (or after cancellation).
    private func requestCode() async -> DeviceGrantSession? {
        let outcome = await client.requestDeviceCode()
        // A cancelled flow (new code requested, sign-out) must not stomp the
        // state its successor now owns.
        guard !Task.isCancelled else { return nil }
        switch outcome {
        case .success(let session):
            state = .waiting(Waiting(
                userCode: session.authorization.userCode,
                verificationURI: session.authorization.verificationURI,
                verificationURIComplete: session.authorization.verificationURIComplete,
                expiresAt: session.authorization.expiresAt))
            return session
        case .failure(let reason):
            state = .error(reason)
            return nil
        }
    }

    private func pollLoop(_ initial: DeviceGrantSession) async {
        var session = initial
        var interval = max(session.authorization.interval, 1)
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(interval))
            guard !Task.isCancelled else { return }

            // Client-side expiry check saves a doomed round-trip; the server's
            // expired_token answer lands in the same replacement path below.
            if Date() >= session.authorization.expiresAt {
                guard let fresh = await requestCode() else { return }
                session = fresh
                interval = max(fresh.authorization.interval, 1)
                continue
            }

            let outcome = await client.pollOnce(session)
            guard !Task.isCancelled else { return }
            switch outcome {
            case .pending, .transient:
                continue
            case .slowDown:
                // RFC 8628 §3.5: cumulative — every slow_down adds 5s for good.
                interval += 5
            case .authorized(let tokens):
                completeSignIn(tokens)
                return
            case .denied:
                state = .denied
                return
            case .expired:
                guard let fresh = await requestCode() else { return }
                session = fresh
                interval = max(fresh.authorization.interval, 1)
            case .failure(let reason):
                state = .error(reason)
                return
            }
        }
    }

    private func completeSignIn(_ tokens: TokenSet) {
        let session = StoredSession(
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            idToken: tokens.idToken,
            accessTokenExpiresAt: tokens.expiresIn.map { Date().addingTimeInterval($0) })
        // Persist before flipping state. If the keychain write fails we still
        // sign in for this run — the next launch simply asks for a code again.
        KeychainTokenStore.save(session)
        state = .signedIn
    }

    // MARK: - Session validation (refresh grant)

    /// Rotates the refresh token on launch. Only a definitive revocation signs
    /// the user out; transient failures leave the session untouched.
    private func validateStoredSession(_ stored: StoredSession) {
        guard let refreshToken = stored.refreshToken else { return }
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            let outcome = await self.client.refresh(refreshToken: refreshToken)
            // A sign-out that raced this refresh must win — a late result must
            // not resurrect a session the user just wiped.
            guard !Task.isCancelled else { return }
            switch outcome {
            case .refreshed(let tokens):
                let next = StoredSession(
                    accessToken: tokens.accessToken,
                    // The server may not rotate; never drop the only refresh token.
                    refreshToken: tokens.refreshToken ?? refreshToken,
                    idToken: tokens.idToken ?? stored.idToken,
                    accessTokenExpiresAt: tokens.expiresIn.map { Date().addingTimeInterval($0) })
                // One atomic keychain upsert: the new refresh token is durable
                // in the same write that discards the old one.
                KeychainTokenStore.save(next)
            case .revoked:
                KeychainTokenStore.clear()
                self.state = .signedOut
                self.beginDeviceFlow()
            case .transient:
                break
            }
        }
    }
}
