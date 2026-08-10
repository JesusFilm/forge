import SwiftUI

/// The floating pill top bar, ported from the RN app's HomeTopBar: icon
/// buttons for search and profile, a labeled chip for the active section,
/// all in one translucent capsule centered at the top.
///
/// Replaces the system TabView chrome — the native tab bar reads as a
/// different product, and looking like the SAME product is this app's bar.
enum TopBarSection: Hashable {
    case home
    case search
    case profile
}

struct TopBar: View {
    @Binding var section: TopBarSection

    var body: some View {
        HStack(spacing: 8) {
            item(.search, icon: "magnifyingglass", label: "Search")
            item(.home, icon: "house.fill", label: "Home")
            item(.profile, icon: "person.fill", label: "Profile")
        }
        .padding(6)
        .background(Theme.pillFill, in: Capsule())
        .frame(maxWidth: .infinity)
    }

    private func item(_ target: TopBarSection, icon: String, label: String) -> some View {
        TopBarButton(
            isActive: section == target,
            icon: icon,
            label: label
        ) {
            section = target
        }
    }
}

/// One pill item. Mirrors the RN bar's behavior: the ACTIVE section shows its
/// label in a white chip; inactive sections are icon-only. Focus fills the
/// item white with near-black ink (the WATCH invert-on-focus rule) rather
/// than scaling — a scaled capsule inside a capsule reads as a glitch.
private struct TopBarButton: View {
    let isActive: Bool
    let icon: String
    let label: String
    let action: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                if isActive {
                    Text(label)
                        .font(.system(size: 26, weight: .semibold))
                }
            }
            .foregroundStyle(ink)
            .padding(.horizontal, isActive ? 26 : 18)
            .padding(.vertical, 12)
            .background(fill, in: Capsule())
        }
        .buttonStyle(WatchCardButtonStyle())
        .focused($focused)
        .animation(.easeOut(duration: 0.18), value: focused)
    }

    private var fill: Color {
        if focused { return .white }
        if isActive { return .white.opacity(0.92) }
        return .clear
    }

    private var ink: Color {
        (focused || isActive) ? Theme.background : Theme.text82
    }
}
