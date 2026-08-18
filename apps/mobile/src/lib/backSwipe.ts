// iOS 26 makes the stack back-swipe FULL-WIDTH by default, which claims
// rightward drags on the watch/series scrubber (a JS PanResponder that native
// gesture arbitration cannot see) and dismisses the page mid-scrub.

// gestureResponseDistance rect: only touches with x <= end may start the pop
// (edge-only feel on iOS 26; pre-26 classic edge pop ignores it). Setting
// fullScreenGestureEnabled false instead KILLS all back-swipe on iOS 26.
export const BACK_SWIPE_RESPONSE_DISTANCE = { end: 24 } as const
