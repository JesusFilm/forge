// react-native-tvos ships the D-pad `nextFocus*` props only inside a
// `declare module 'react-native'` block (types/public/ReactNativeTVTypes.d.ts)
// that does NOT merge into the `ViewProps` interface our build resolves
// (Libraries/Components/View/ViewPropTypes.d.ts) — so the props are missing
// from View/Pressable types, even though Pressable forwards them to its host
// View at runtime (Pressable.js: `nextFocusUp={tagForComponentOrHandle(...)}`,
// which accepts a node handle OR a component instance).
//
// Re-augment `ViewProps` locally so the directional next-focus props are
// type-valid app-wide. A component instance (e.g. a Pressable/View captured
// via ref-as-state) is a valid destination, the same shape MissionSection
// already passes to `TVFocusGuideView`'s `destinations`.
import "react-native"

declare module "react-native" {
  interface ViewProps {
    nextFocusUp?: number | View | null | undefined
    nextFocusDown?: number | View | null | undefined
    nextFocusLeft?: number | View | null | undefined
    nextFocusRight?: number | View | null | undefined
  }
}
