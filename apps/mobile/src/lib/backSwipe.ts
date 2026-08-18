// iOS 26 makes the stack back-swipe FULL-WIDTH by default, which claims
// rightward drags on the JS-PanResponder seek bar and dismisses the page
// mid-scrub. A JS responder can never outrace it: the native recognizer claims
// the touch at delivery, before JS runs.

// The fix splits the screen instead of racing: the pop owns this left strip,
// and the scrubber declines touches that start inside it. One constant feeds
// both halves so they cannot disagree.
export const BACK_SWIPE_EDGE_WIDTH = 24

// gestureResponseDistance rect: only a touch with x <= end may start the pop
// (edge-only on iOS 26; pre-26 classic edge pop ignores it). Setting
// fullScreenGestureEnabled false instead KILLS all back-swipe on iOS 26.
export const BACK_SWIPE_RESPONSE_DISTANCE = {
  end: BACK_SWIPE_EDGE_WIDTH,
} as const
