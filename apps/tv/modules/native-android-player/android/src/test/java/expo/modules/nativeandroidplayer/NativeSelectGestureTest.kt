package expo.modules.nativeandroidplayer

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeSelectGestureTest {
  @Test fun hiddenSelectTogglesOnceAcrossFocusTransferAndLongHold() {
    for (key in listOf(23, 66, 160)) {
      val gesture = NativeSelectGesture()
      assertEquals(NativeSelectAction.TOGGLE, gesture.handle(key, true, 0, true, false))
      for (repeat in 1..100) {
        assertEquals(NativeSelectAction.CONSUME, gesture.handle(key, true, repeat, false, false))
      }
      assertEquals(NativeSelectAction.CONSUME, gesture.handle(key, false, 0, false, false))
      assertEquals(NativeSelectAction.PASS, gesture.handle(key, true, 0, false, false))
      assertEquals(NativeSelectAction.PASS, gesture.handle(key, false, 0, false, false))
    }
  }

  @Test fun errorRevealsBackWithoutTogglingAndConsumesRelease() {
    val gesture = NativeSelectGesture()
    assertEquals(NativeSelectAction.REVEAL, gesture.handle(66, true, 0, true, true))
    assertEquals(NativeSelectAction.CONSUME, gesture.handle(66, false, 0, false, true))
    assertEquals(NativeSelectAction.PASS, gesture.handle(66, true, 0, false, true))
  }

  @Test fun missingReleaseAndInheritedRepeatsDoNotCreateAnotherToggle() {
    val gesture = NativeSelectGesture()
    assertEquals(NativeSelectAction.CONSUME, gesture.handle(160, true, 4, true, false))
    assertEquals(NativeSelectAction.CONSUME, gesture.handle(160, false, 0, true, false))
    assertEquals(NativeSelectAction.TOGGLE, gesture.handle(160, true, 0, true, false))
    assertEquals(NativeSelectAction.TOGGLE, gesture.handle(160, true, 0, true, false))
    assertEquals(NativeSelectAction.PASS, gesture.handle(66, true, 0, false, false))
  }
}
