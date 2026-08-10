import SwiftUI

/// WATCH_THEME, ported from `apps/tv/src/components/watch/watchDetailTheme.ts`.
///
/// The native app must read as the SAME product as the React Native one —
/// same near-black ground, same red, same type scale. When a value here
/// drifts from the RN theme, the RN theme wins; this file is a port, not a
/// design.
enum Theme {
    /// NEAR_BLACK — the ground every screen sits on. Never pure black.
    static let background = Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0B / 255)

    /// The WATCH accent (#E1241E) — eyebrows, primary CTAs. Sparingly.
    static let accent = Color(red: 0xE1 / 255, green: 0x24 / 255, blue: 0x1E / 255)

    static let text = Color.white
    static let text82 = Color.white.opacity(0.82)
    static let text62 = Color.white.opacity(0.62)
    static let text50 = Color.white.opacity(0.50)

    /// Frosted-glass pill fill (no real blur on TV — translucent white).
    static let pillFill = Color.white.opacity(0.12)

    /// Card corner radius — 16, matching both design systems' cards.
    static let cardRadius: CGFloat = 16

    /// The red uppercase eyebrow over rail titles ("A 7-DAY VIDEO JOURNEY").
    struct Eyebrow: View {
        let text: String
        var body: some View {
            Text(text.uppercased())
                .font(.system(size: 24, weight: .bold))
                .kerning(2.4)
                .foregroundStyle(Theme.accent)
        }
    }
}

/// The RN app's focus behavior: 1.05x lift + white ring, 180ms. SwiftUI's
/// `.card` button style does a heavier lift with parallax; this custom style
/// matches the RN look instead.
struct WatchCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}

struct WatchFocusModifier: ViewModifier {
    @Environment(\.isFocused) private var isFocused

    func body(content: Content) -> some View {
        content
            .scaleEffect(isFocused ? 1.05 : 1.0)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardRadius)
                    .stroke(Color.white.opacity(isFocused ? 0.9 : 0), lineWidth: 4)
            )
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

extension View {
    func watchFocus() -> some View {
        modifier(WatchFocusModifier())
    }
}
