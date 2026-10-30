package expo.modules.nativeandroidplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeChoiceConfirmationTest {
  @Test fun aDifferentEditionDoesNotCommitBeforeContinue() {
    val confirmation = NativeChoiceConfirmation()
    assertNull(confirmation.request("thai", "Different version"))
    assertEquals("thai", confirmation.resolve(true))
    assertNull(confirmation.resolve(true))
  }

  @Test fun cancelAndBackDiscardThePendingLanguage() {
    val confirmation = NativeChoiceConfirmation()
    assertNull(confirmation.request("thai", "Different version"))
    assertNull(confirmation.resolve(false))
    assertNull(confirmation.resolve(true))
  }

  @Test fun aSharedEditionDoesNotNeedConfirmation() {
    val confirmation = NativeChoiceConfirmation()
    assertEquals("english", confirmation.request("english", null))
    assertNull(confirmation.resolve(true))
  }

  @Test fun aNewUnconfirmedChoiceReplacesAnEarlierPendingChoice() {
    val confirmation = NativeChoiceConfirmation()
    confirmation.request("thai", "Different version")
    confirmation.request("polish", "Different version")
    assertEquals("polish", confirmation.resolve(true))
  }

}
