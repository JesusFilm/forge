import SwiftUI

/// Profile tab: RFC 8628 device sign-in (feat-322), or the signed-in
/// placeholder once tokens are stored.
struct SignInView: View {
    @ObservedObject var model: SignInViewModel

    var body: some View {
        Group {
            switch model.state {
            case .signedOut, .requestingCode:
                loading
            case .waiting(let info):
                WaitingContent(info: info) { model.requestNewCode() }
            case .denied:
                TerminalContent(
                    icon: "hand.raised.fill",
                    title: "Sign-in was declined",
                    message: "The request was denied on the approving device.",
                    buttonTitle: "Get a new code") { model.requestNewCode() }
            case .error(let message):
                TerminalContent(
                    icon: "exclamationmark.triangle.fill",
                    title: "Something went wrong",
                    message: message,
                    buttonTitle: "Try again") { model.requestNewCode() }
            case .signedIn:
                SignedInContent { model.signOut() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { model.start() }
    }

    private var loading: some View {
        VStack(spacing: 24) {
            ProgressView()
            Text("Preparing sign-in…")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Waiting (code + QR)

private struct WaitingContent: View {
    let info: SignInViewModel.Waiting
    let onNewCode: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 96) {
            VStack(alignment: .leading, spacing: 32) {
                Text("Sign in")
                    .font(.system(size: 54, weight: .bold))
                Text("Scan the QR code with your phone — or visit the address under it — then enter this code:")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 620, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(Self.grouped(info.userCode))
                    .font(.system(size: 84, weight: .semibold, design: .monospaced))
                    // Privacy: the digits must never reach the accessibility
                    // tree; a generic label replaces the value outright.
                    .accessibilityLabel("Sign-in code")
                HStack(spacing: 18) {
                    ProgressView()
                    Text("Waiting for approval…")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                Button("Get a new code", action: onNewCode)
                    .buttonStyle(.borderless)
                    .font(.title3)
                    .padding(.top, 8)
            }
            VStack(spacing: 22) {
                QRCard(payload: info.verificationURIComplete)
                Text(Self.displayAddress(info.verificationURI))
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(60)
    }

    /// 10 digits → couch-readable 3-3-4 ("123-456-7890"). Any shape the
    /// contract doesn't promise passes through untouched.
    static func grouped(_ code: String) -> String {
        let digits = code.filter(\.isNumber)
        guard digits.count == 10 else { return code }
        let d = Array(digits)
        return "\(String(d[0..<3]))-\(String(d[3..<6]))-\(String(d[6..<10]))"
    }

    /// Scheme-less, query-less address for the caption. The query is stripped
    /// defensively (even though verification_uri normally has none) because a
    /// verification URI can carry the user code — and the code must not repeat
    /// in the caption.
    static func displayAddress(_ uri: String) -> String {
        var s = uri
        if let cut = s.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            s = String(s[..<cut])
        }
        for scheme in ["https://", "http://"] where s.hasPrefix(scheme) {
            s.removeFirst(scheme.count)
        }
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }
}

private struct QRCard: View {
    let payload: String

    var body: some View {
        Group {
            if let qr = QRCode.image(for: payload) {
                qr
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(1, contentMode: .fit)
                    .frame(width: 340, height: 340)
            } else {
                // Practically unreachable for an https URL; the address caption
                // below still gets the user through.
                Image(systemName: "qrcode")
                    .font(.system(size: 200))
                    .foregroundStyle(.black)
                    .frame(width: 340, height: 340)
            }
        }
        // The white card doubles as the quiet zone QR scanners require.
        .padding(28)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

// MARK: - Terminal states (denied / error)

private struct TerminalContent: View {
    let icon: String
    let title: String
    let message: String
    let buttonTitle: String
    let action: () -> Void

    var body: some View {
        // Native ContentUnavailableView — the same state component Home and
        // Search use, so every screen's terminal states read identically.
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(message)
        } actions: {
            Button(buttonTitle, action: action)
        }
    }
}

// MARK: - Signed in

private struct SignedInContent: View {
    let onSignOut: () -> Void

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 140))
                .foregroundStyle(.secondary)
            Text("Signed in")
                .font(.title.weight(.bold))
            Text("This Apple TV is signed in to Jesus Film.")
                .font(.title3)
                .foregroundStyle(.secondary)
            Button("Sign out", action: onSignOut)
                .buttonStyle(.borderless)
                .font(.title3)
                .padding(.top, 12)
        }
    }
}
